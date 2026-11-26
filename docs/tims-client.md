# TIMS client

The [TIMS tab](tims.md) builds on this client and outbox.

`tims-api.ts` follows UPbDB ADR-0015. The server decides permissions and
validates chemistry. This client displays stored chemistry and does no reduction.

List methods return the first page and `more()`. Cursors are opaque query values;
filters survive paging. An old account's page cannot continue under a new account.
`mountFractions()` requests pages with `limit=500`, publishes each page through its
progress callback, and stops at 10000 fractions per mount. Its `showing` sentence
must remain visible when `truncated` is true. Review makes one such traversal per
distinct mount and reads batch details only for the selected spot's distinct batches.
All reads use identity's existing account-scoped cache and ETag revalidation.

Existing-record edit methods return a durable outbox entry. Batch children share
`batch:<id>` as their object key, preserving step/order/record write order. The
outbox persists the exact body and key before sending. Its `subscribe()` callback
runs after successful delivery and durable removal; an owning view should then
revalidate its GET. Review does this in App. Use `overlayBatch()` against the last
GET and pending entries to show local fields and “Saved here, not sent yet”.
A stopped edit remains in the overlay and under “Needs your attention”; later
edits of that object wait for Retry or Discard.

For a creation, retirement, source write or step deletion, construct the returned
online form once for that exact input. Bind button availability and its explanation
to `disabledReason`. Retain the form across a manual retry. Construct a new form
when its input changes. It snapshots the body and idempotency key, and refuses to
send under another account or server. The TIMS tab supplies these online creation controls.

`timsRights.canEdit(labId, objectKey?)` only controls presentation. Pass the object
key to include a server refusal in that decision; display `recordReason(objectKey)`.
View-as is read-only. Definitive 403 outbox responses persist their server sentence;
online record operations also register 403 refusals. A server refusal always wins.

The current batch response includes full spike versions for recorded additions.
A planned spike default without an addition may lack those details. Review says
that the version details are unavailable in that batch reply; it does not issue a
request for every step or invent a version name, composition or current status.

The invented large-list test checks 5000 fractions over ten mocked pages and
publishes each page. The join test builds one index and performs 5000 indexed joins.
Review's request tests check one fraction list per distinct mount, batch detail
reuse and revalidation. Before this milestone, Review made no TIMS requests. Normal
TIMS cost is now one paged mount traversal plus one GET per distinct selected batch;
there is no request per spot. Mock timing messages are available from the two tests.

`ui/tests/tims-review.spec.ts` covers the two viewport sizes, light and dark themes,
chemistry overrides and outcomes, tree badges, combined filters, and the source
grain/spot opener. A supervisor must run it; it was not run in the coding sandbox.


Batch list views use `limit=200` and `order=-started_on`. The query order is
`limit`, optional `after` cursor, `lab`, selected filters in the order
`capsule_set`, `started_after`, `started_before`, `status`, optional `active_after`,
then `order`. Empty filters are omitted. For the fixed date 2026-11-25 and lab
`synthetic-lab`, with no filters, exact first-page paths are:

- Rows: `/v1/tims/batches?limit=200&lab=synthetic-lab&order=-started_on`
- Calendar: `/v1/tims/batches?limit=200&lab=synthetic-lab&started_after=2026-11-01&started_before=2026-11-30&order=-started_on`
- Lanes: `/v1/tims/batches?limit=200&lab=synthetic-lab&started_before=2026-12-23&active_after=2026-09-30&order=-started_on`
- Older-server lane fallback: `/v1/tims/batches?limit=200&lab=synthetic-lab&started_after=2026-06-02&started_before=2026-12-23&active_after=2026-09-30&order=-started_on`

`after=<opaque cursor>` follows `limit` on subsequent pages. Calendar intersects
start filters with the visible month. Lanes keeps user start filters, adds the
active window, and uses the 120-day fallback only when summary fields are absent.
Both automatic traversals publish each page, stop on navigation and stop after ten
pages. Calendar session snapshots are bounded to 24 query keys and cleared on
source/lab changes and batch saves. Normal reads still pass through identity's
account/server-scoped ETag handling; retry forces a read rather than a session hit.
Rows load further pages only on demand. All rendering joins use the loaded catalogs
and list summaries, with no batch-detail or account lookup for a list row.

Before this change the first list request returned up to 500 rows. It now returns
up to 200; both take one request, and 500 rows now require three on-demand requests.
`tims-api.test.ts` times both paths against the same 500-row mock (one local run:
0.05 ms before, 0.11 ms after; these are mock transport times, not network latency).
`tims-batch-pages.test.ts` measures the bounded traversal of 2000 invented rows
(ten mocked list reads, zero detail reads) and logs elapsed time. The browser scale
spec reports request count and rendering time for 500 rows; the supervisor runs it.
The historical 500-row fixture key remains alongside the new exact 200-row key.
