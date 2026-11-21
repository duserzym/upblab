# AGENTS.md: rules for coding agents in upbstudio

UPb Studio is the Tauri 2 shell of an open-source LA-ICP-MS U-Pb workflow:
Rust host in `src-tauri/`, Svelte 5 + TypeScript shell page in `ui/` (runs in
Tauri and as a web page at `/desk/`), and `@lab/bridge` in `bridge/`, the
small API the hosted modules (grainatlas in the Images tab, UPbDB in the
Sessions tab) use to talk to the shell. The owner is Yiming Zhang (they/them).
A supervising Claude session writes the briefs, audits every diff, runs the
browser and app checks and makes the commits.

## Hard rules

1. **Never commit, tag, push, or create remotes or releases.** Leave the work
   in the working tree.
2. **The shell does no data reduction.** It links the modules and shows what
   UPbDB stores. No ratio, date, weighted mean or concentration is
   calculated here; plots read stored values. Drawing reference lines (the
   Concordia curve, an ellipse from a stored value, its 2σ and its error
   correlation) is allowed. Review's geochemistry plots may also do display
   arithmetic on stored concentrations: chondrite normalisation with the CI
   values in `ui/src/lib/concordia.ts`, quotients of two stored values
   (U/Yb, (Sm/La)N), Eu/Eu* and Ce/Ce* by the formulas in UPbRPy
   `docs/export_table_spec.md` section 2.7, and the sum of REE + Y. A stored
   column with the same meaning always wins, derived axes say "from stored
   ppm", and they carry no uncertainty. Thermometers, dates, uncertainties
   and anything needing model parameters are read only when stored.
3. **No real data in the repository.** Fixtures are small and invented; never
   copy files from `~/upbdb`, `~/My Drive…` or other repositories' data.
4. **CI stays quiet.** Workflows run only on `v*` tags and
   `workflow_dispatch`. Never add push or pull-request triggers.
5. **The theme follows the system by default (Light and Dark on request); every screen fits 1440 x 900 and 1280 x 800**
   CSS px in Chromium and WebKit (`docs/ux-conventions.md`, rule 7). Pages
   scroll inside the window, never sideways. Use the design tokens in
   `ui/src/tokens.css` (copied from UPbDB `ui/src/app.css`) and the
   existing classes (`glass`, `panel`, `btn`, `stack`, …) instead of new ones.
6. **The bridge stays backward compatible.** `bridge/src/protocol.ts` only
   ever adds operations; the shell answers every older version and a newer
   module on an older shell degrades silently.
7. Other repositories (`../grainatlas`, `../upbdb`, `../UPbRPy`) are
   read-only unless the brief says otherwise.

## Commands

```bash
make quick     # quick check: only what the changed files affect (docs/testing.md)
make check     # full check: everything, before a build/install or a risky change
pnpm --filter @lab/bridge build && pnpm --filter @lab/bridge test   # bridge
pnpm --filter upbstudio-ui test                                     # vitest + svelte-check
pnpm --filter upbstudio-ui build                                    # ui/dist
cargo test --manifest-path src-tauri/Cargo.toml                      # Rust host
```

Playwright (`make e2e`, `ui/tests/*.spec.ts`) needs browsers; you cannot run
it, the supervisor does. Write or update the spec files when the brief asks.
`ui/tests/fake-tauri.ts` fakes the desktop host for page tests.

## Style

- TypeScript strict, Svelte 5 runes, small modules under `ui/src/lib/` with a
  vitest file next to each (`*.test.ts`).
- Rust: `cargo fmt`, clippy-clean, unit tests in the same file.
- Prose in docs: plain sentences, no marketing, no emoji, numbers with units.
- Say in your final message what you did not finish or could not verify.

## Performance and scale (server calls)

The lab database is built for many users and very large datasets (millions of
grains, acquisitions and spots) reached over slow networks. Every call this app
makes to it follows these rules:

- **Page, never fetch everything.** Request lists with `limit` and follow the
  `X-Next-Cursor` cursor; show the first page at once and load more on demand.
- **Revalidate, do not re-download.** Keep the `ETag` of each list or detail
  and send `If-None-Match`; a 304 means the cached copy is current. Cache per
  account and server, and clear it on sign-out.
- **Never block the interface on a download.** Fetch progressively, show what
  has arrived, and keep the app usable while the rest loads.
- **Time out on stalls, not on size.** Use a short connect timeout and a stall
  timeout without data; never a short cap on the whole transfer. Accept gzip.
- **No request per row.** Ask for a batch or a summary the server provides;
  if one is missing, say so instead of looping over items.
- **Errors say what happened**: the status and a short excerpt of the reply,
  never only a library message.
- **Measure** request count and time before and after a change that touches
  server calls, and test with a large mocked list (thousands of rows).

## UPb Mobile parity

UPb Mobile (`../upbmobile`, private) is UPb Lab on the iPhone and iPad, view
and control only. Every change to what desktop UPb Lab shows or lets people
do must be reflected there, in the same piece of work:

- update the parity table in upbmobile `ROADMAP.md` (the row for the feature,
  its priority and the UPbDB API behind it), and the app itself once the
  screen exists; or
- when the mobile side cannot be done now, add a dated entry to upbmobile
  `SYNC_BACKLOG.md` naming the UPb Lab commit, what changed and what the
  phone should show.

Mobile parity is read-only: a desktop feature that edits, uploads, reduces or
changes access appears on the phone as a view of its result (or "Desktop
only"), never as an edit. The supervisor commits the upbmobile change in that
repository; Codex in this repository only notes it in its final message.

## After a major update

Rust and PyInstaller builds fill the disk quickly. Once the work is pushed and
any app built from it is installed in `/Applications` and smoke-tested:

1. Note free space (`df -h /`).
2. Run `make clean-build`. It removes `src-tauri/target/` (Rust and Tauri builds, `.app` and `.dmg` bundles). It keeps `bridge/dist` (grainatlas builds against it), `ui/dist`, `ui/public/modules` and `node_modules` (`make clean` removes those too). It stops if a build
   is still writing there, and prints free space before and after. It also
   keeps the shared release target `~/Library/Caches/lab-builds/upblab-target`
   (about 3 GB, kept on the owner's request so installs are faster;
   `docs/testing.md`). Delete the `.app` left in its `release/bundle/` after
   copying it out; remove the whole cache (`make clean-release-cache`) only
   when the owner asks.
3. Remove the worktrees and build checkouts you created for this work
   (`git worktree remove`, then `git branch -d` for merged branches).
4. Keep installed apps and review artifacts (screenshots, previews, print
   files, COMMIT notes in `~/Github/lab-builds`). Never touch another
   session's worktree, scratchpad or running build, project data or
   databases.
5. Report free space before and after.
