# ADR-0004: Mirror mode: every lab app keeps a local copy and syncs

- **Status:** proposed (2026-11-18), cross-app: UPb Lab, UPbRPy Studio,
  GrainAtlas, with server work in UPbDB. Open questions for the owner at the end.
- **Context:** the lab server (`upb-host`) went offline the night before a demo
  (2026-11-17, about 23:40Z). UPb Lab showed "Sessions 0"; GrainAtlas waited
  about a minute on every server call; Studio could not open a database
  session. The owner's direction: "the apps offline-online both safety design
  should be like google drive mirror image option---keep an offline copy always
  while sync with the database ... offline edits when online be synced when
  connection re-establishes."
- **Related:** UPbDB ADR-0009 (lists, ETags, batch revision lookup), ADR-0010
  (Idempotency-Key on every write), GrainAtlas `docs/quiet-sync.md`, UPb Lab's
  read cache (`src-tauri/src/read_cache.rs`, 2026-11-18), the standby-host
  proposal (separate).

## What exists on 2026-11-18

| App | Reads offline | Edits offline | Sync later |
| --- | --- | --- | --- |
| UPb Lab | What it viewed before, per account and server (read cache, ETag revalidation, banner with "as of") | None (the shell only reads; edits happen in the hosted pages and the other apps) | n/a |
| GrainAtlas | Local projects and the stored copy of a package; not published atlases (atlas.json and project.json are not kept) | Yes: drafts with pending elements | Yes: quiet sync, `pending_request` with its Idempotency-Key, backoff, bulk and old-copy guards |
| UPbRPy Studio | Session bundles in `~/UPbRPy/sessions`, `.upbr` projects | Yes, locally | No: submit fails with a dialog; retry is manual |

## Decision

Each app keeps a **mirror**: a local copy of the signed-in account's data that
the app reads from first. The server is the sync partner, not a requirement for
working. Edits are written locally first and leave through a durable **outbox**.

### 1. Reads come from the mirror

- Every read is answered from the mirror at once, then revalidated in the
  background with `If-None-Match` (ADR-0009 ETags). A 304 costs no body.
- The app tracks changes with a **per-account change cursor** (section 5):
  "what changed since cursor C that I can see", so a full re-download is never
  needed after the first fill.
- Screens never wait on the network to show what the mirror has.

### 2. What is mirrored (scope and size)

| Tier | Default | What |
| --- | --- | --- |
| Metadata | Always | Every session, mount, sample, project, run summary, grain, spot and result row the account can see (rows, not files) |
| Own heavy files | Always | Atlas tiles and sweeps for mounts and sessions the account owns or can edit |
| Recent heavy files | Automatic, LRU | Tiles and sweeps of anything else opened in the last 30 days |
| Pinned | On request | "Keep offline" on a mount or session (like Drive's "Available offline"): kept regardless of age |

- Settings shows disk use per tier and a budget (default 20 GB). Over budget,
  only the Recent tier is evicted; own and pinned data are never evicted
  silently. If they alone exceed the budget, the app says so and asks.
- **Literal "mirror everything" (Drive's mirror option)** is offered as a
  switch. Today it costs about 4.6 GB for the whole lab: database rows about
  275 MB, raw files (atlas tiles and sweeps, including older atlas versions)
  3.6 GB, derived files 0.7 GB (measured on the 2026-11-17 21:49Z copy). It is
  cheap now and grows with every mount; at many labs it must stay a choice.
  Recommendation: default to the tiers above for everyone, and to "mirror
  everything" for lab staff on the lab's own computers.

### 3. Edits: local first, durable outbox

- An edit is applied to the mirror and appended to the outbox in one local
  transaction. The outbox entry holds the action, its exact request body, the
  base revision it was made against and a fresh `Idempotency-Key` (ADR-0010),
  fixed before the first send and reused on every retry, including after a
  restart. (GrainAtlas's `pending_request` already works this way; it becomes
  the shared pattern.)
- The outbox is sent in order per object, in the background, whenever the
  server is reachable: backoff 5 s doubling to 5 min with jitter; wake on
  network change and window focus; one request in flight per object.
- 5xx and timeouts retry; 409 `idempotency_in_progress` waits `Retry-After`;
  a definitive 4xx (refused, no access) stops that entry and shows it under
  "Needs your attention" with the reason; it is never dropped silently.
- Studio: submit, mark preferred and sample assignment become outbox actions.
  A reduction submitted offline shows "Saved, will send when the server is back".
- UPb Lab: the hosted UPbDB pages stay online-only until they run on the
  mirror; their buttons say so when offline instead of failing.

### 4. Conflicts

- Changes that do not overlap merge automatically (GrainAtlas's three-way
  merge, field by field).
- **Registered data is never overwritten silently.** Spots, sample
  assignments, labels and spot-to-analysis links: a conflict asks in plain
  words, with the recommended choice first ("Keep the database copy
  (recommended)" / "Use mine").
- Guards kept from GrainAtlas: bulk removals (more than 5 registered spots)
  need a person's choice; a copy that opens with registered elements missing
  from its synced base is treated as old ("This copy is older than the shared
  project"), and automatic sync stops until the person chooses.
- The server's revision check stays the final arbiter: a stale base is refused
  (409) and becomes a merge, never a blind overwrite.

### 5. Server needs (UPbDB ADR-0011, proposed 2026-11-18)

The server side is UPbDB's ADR-0011 "change feed and standby", building on
ADR-0009 and ADR-0010. In short:

1. **Change feed** `GET /v1/changes?after=&limit=` with `X-Next-Cursor`, read
   from a change log that stores the transaction id and returns only rows
   below the oldest running transaction, so a later commit never hides an
   earlier one. Children (acquisitions; grains, spots, atlases) bump their
   parent's `revision` and are reported as the parent; the client then reads
   the details or the mount's own `/changes?since=`.
2. **Revisions** on projects, samples, sessions and mounts (only mounts have
   one today).
3. **Access changes are not tombstones.** Each account has an
   `access_epoch`; when grants, memberships, roles or base permissions change,
   the feed answers `X-Resync: access` and the client reconciles once (paged
   lists with ETags plus the batch revision lookup), dropping what it can no
   longer see. Tombstones are for real deletes only, kept at least 90 days. A
   cursor older than that, or older than a restore, gets 410
   `cursor_expired` and the same reconcile.
4. **Writes:** `Idempotency-Key` (ADR-0010) and `If-Match: <revision>`; a
   stale replay gets 409 with the current object and becomes a merge
   (section 4).
5. **Files by hash** `/v1/files/<sha256>`: visibility-checked (404 when the
   hash belongs only to invisible objects), `private, immutable`, Range.
6. **Server identity and standby:** `GET /v1/server` returns `dataset_id`
   (the same on primary and standby), `role: primary|standby`, `as_of` and
   `primary_url`. Mirrors are keyed by `dataset_id` (not URL), so they stay
   valid across a failover. A standby refuses writes with 409
   `read_only_standby` and `X-UPbDB-Offline-Copy`; clients send the outbox
   only when `role` is `primary`.

Server build order (UPbDB): ADR-0009 keyset `limit`/`after` on sessions and
mounts first (UPb Lab already sends them), then other lists, ETags and the
batch lookup; ADR-0010 with `If-Match`; ADR-0011 revisions, change log, feed,
tombstones and access epoch; files by hash; standby (`/v1/server` fields first,
then read-only mode in code, then replication).

### 6. Accounts and protection on disk

- Mirrors are kept per account and server
  (`<app data>/mirror/<dataset id>/<account id>/`, keyed by the server URL until `/v1/server` reports `dataset_id`). Another account signing
  in at the same server gets its own folder and never reads another's.
- **Sign-out keeps the mirror** but hides it. If the outbox is not empty,
  sign-out warns ("3 changes have not reached the server yet. Sign out anyway?
  They will be sent the next time you sign in.") and never discards them.
- A mirror is deleted only by an explicit "Remove offline copy" (with the
  outbox count shown), or by the app's uninstall.
- On disk: folders 0700 and files 0600 under the user's own Library folder,
  no tokens in the mirror (tokens stay in the OS keychain), FileVault or
  BitLocker as the disk-level protection. Shared lab computers should use one
  OS account per person; an encrypted mirror (key in the keychain) is a later
  option if a lab needs it.
- This replaces the 2026-11-17 decision to clear caches on sign-out.

### 7. Status words (same in every app)

Saved · Syncing… · Up to date · Offline, will sync later · Needs your
attention. A read-only standby or offline copy adds "Read-only copy". The
details (cursor, revision, outbox entries, raw errors) live behind the chip.

## Migration (grow, do not replace)

1. **UPb Lab tiles** (first heavy-file item, found 2026-11-18): Review's SEM
   images come from the built-in GrainAtlas viewer and are not saved, so they
   are blank whenever the server is unreachable even though Home and Review
   data show. Save `atlas.json`, `project.json` and the viewed tiles by
   SHA-256 with the metadata, and bundle a GrainAtlas module that has the
   image cache (`f0f2dba` or later).
2. **UPb Lab** (now): the read cache already has the mirror layout per account
   and server; it becomes the metadata tier when the change feed exists (the
   prefetch list becomes "follow the feed"). Add heavy files through a local
   file store keyed by SHA-256, shared with the Images tab.
3. **GrainAtlas**: drafts and quiet sync are the outbox; the IndexedDB image
   cache (keyed by atlas.json SHA-256) becomes the heavy-file tier; add keeping
   atlas.json and project.json so published atlases open offline.
4. **Studio**: the session cache (`~/UPbRPy/sessions`) is the heavy tier for
   sessions; submit retry (calibration-panel session) becomes an outbox with
   a stored body and key; `upbr://session/<id>` falls back to the cached bundle
   when the server is unreachable (`find_cached_session` exists, unused).
5. **UPbDB**: ADR-0011 (section 5).
6. A shared spec (`docs/mirror-contract.md` in UPb Lab, next to WORKFLOW.md)
   with the outbox entry format, status words and conflict prompts, so the
   three apps behave the same.

## Build order

1. UPbDB: ADR-0009 paging and ETags, ADR-0010 with If-Match, ADR-0011 feed, then files by hash and the standby role.
2. Studio: outbox for submit and preferred run; offline fallback for
   `upbr://session` links.
3. GrainAtlas: keep atlas.json and project.json; pin "Keep offline".
4. UPb Lab: follow the change feed; heavy-file store; disk budget in Settings;
   sign-out outbox warning (once it has writes).
5. Standby host (separate proposal) once the feed exists.

## Consequences

- The apps work through outages and slow relays, and opening anything is
  instant from the mirror.
- Disk use grows; the budget and tiers keep it bounded; own and pinned data are
  never evicted silently.
- The server must support the feed and tombstones before mirrors can stay
  correct cheaply; until then the apps revalidate what they show (today's
  behaviour).
- Two copies of the truth exist at any moment; conflicts become a designed
  path instead of an error.

## Questions for the owner

1. Default scope: the tiers above for everyone, with "mirror everything" for
   lab staff on lab computers? Or literally everything for everyone while the
   lab is this small (about 4.6 GB today)?
2. Default disk budget: 20 GB?
3. Conflict on registered data: is "Keep the database copy (recommended)" the
   right default, or should the most recent edit be recommended?
4. Shared lab computers: one OS account per person, or an encrypted mirror?
5. (from UPbDB ADR-0011) Tombstone retention: 90 days or longer? Standby: a
   live replica or a nightly copy?
6. Should offline edits to sample assignments and preferred runs be allowed in
   Studio and UPb Lab (queued), or stay online-only until the server's change
   feed exists?
