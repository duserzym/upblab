# TIMS chemistry

The TIMS tab follows Reduce. CmdOrCtrl+5 opens it on desktop or the web.
Review's Open batch button and `upbdb://tims/batch/<id>` open a chemistry batch.
The route stays mounted across top-level tab switches.
Opening the same batch from Review returns to Batches even after visiting another
TIMS section. Opening a batch also selects its lab when that lab is loaded.

Batches lists one page at a time. Capsule set, inclusive start dates and fraction
status are remembered per account and server, outside the URL. New batch forms
use active capsule sets and mineral-specific active recipes. The batch page
shows stored chemistry, a capsule grid, sources, step records and spike additions.
Selecting a capsule opens a drawer inside the grid. The step-by-capsule matrix
shows effective values and opens the corresponding capsule record. Status changes
are explicit; chemistry writes do not change fraction status.

Grain thumbnails in capsule cells (72 px), the capsule drawer (180 px) and
Review's TIMS fractions (120 px) show the published SEM image clipped to the
stored segmented polygon. They preserve the grain's aspect ratio in a square,
leave 10 % padding around its bounding box, and draw a thin outline above the
image. The source LA spot is a circle at its stored position and diameter, or
a dot when no diameter is recorded. No image pixels or analytical values are
calculated. Missing publication, polygon, area or failed loads retain the
outline or neutral placeholder; the SVG title explains the reason.

Cells render before images arrive. IntersectionObserver defers offscreen cells;
visible crops load progressively after batch detail and mount elements. A shared
queue permits at most six SVG tile loads at once. Crops use the coarsest pyramid
level whose grain bounding box supplies the display size times devicePixelRatio,
or full resolution when the source is smaller. Only tiles intersecting the
grain bounding box are requested. Tiles use GrainAtlas's `col_row.webp` naming,
the atlas tile size, area-local positive-right/positive-down coordinates and
`(coordinate_um - origin_um) / (um_per_px * level.scale)` mapping. Area selection
uses the element's `area_id`, matching the atlas area's `id`.

There is one shared mount-elements read per distinct source mount (ETag
revalidation on Refresh batch), one atlas listing per mount for its 12 h access
grant, and one immutable atlas.json per project version. The grant is renewed
just before expiry or after a 401/403 metadata response. SVG image error events
hide the HTTP status, so a tile failure also renews that shared grant once and
retries before falling back. URLs carry `version` and signed read-only `access`;
the browser's immutable cache serves repeats. Tiles are SVG image loads, with no
canvas or CORS fetch. Metadata uses a 4 s connect timeout and 30 s without bytes;
native image networking handles tile transfers. Metadata and geometry caches
clear on sign-out, account, server or view changes.

Offline, previously seen tiles can display from the browser cache while the
listing and manifest remain available. Unseen or unavailable tiles fall back to
outlines. The desktop read cache does not cover images; there is no persistent
desktop tile cache. Browser cache retention and renewed access URLs can limit
offline image availability.

Sources use stored
mount and grain labels first. Missing mount labels use one cached detail read
per distinct mount; grain and spot names use the same elements already read
for outlines. Missing names are described in words; ids remain in tooltips.
Operators use the stored name, the matching signed-in account, or one shared,
bounded account-directory page when visible. That name cache clears on sign-out
or an account, server or view change.

Recipes and capsule sets can be maintained without Django admin. New recipes
and Reset to guidebook defaults fill a draft for review before saving. Defaults
follow UPbDB `service/apps/tims/seed.py` and its typed method defaults. The BSU-IGL
action lists missing sets in a confirmation and creates them with separate keys.
Load the remaining capsule-set pages before checking defaults. Existing names,
codes and inactive sets are kept; an occupied code is not overwritten.

Spikes browses visible registered solutions, subfractions and versions. Choosing
a version shows its composition, uncertainty information, source and locator
before Apply. Withdrawn versions cannot be chosen. Non-current versions have a
warning, including any warning returned with a spike addition. Bottle differences
come from the server. Members may edit private version status and notes; public
versions require a superuser. Creating spikes and versions is not included.

Existing-record changes are saved durably in the account-and-server-scoped outbox
before transmission. Pending bodies overlay the last GET and say “Saved here,
not sent yet”. The indicator opens a list with the server reason, Retry and
Discard. Definitive refusals stop that object's queue. A 401 waits for the same
account to sign in again, including token renewal without a sign-out. Transient
failures retry with backoff. Retries keep the exact body and Idempotency-Key.
Signing out hides that account's queue; it never sends under another account.
View as uses the shell's read-only reason and disables writes.
Unrelated outbox deliveries do not revalidate chemistry panels. A batch save
revalidates its detail; a fraction save also revalidates Review's fraction list.
Replies are checked against their original account, server, lab and form before
changing a draft, showing an error or navigating. Closing a form invalidates its
pending replies. An earlier online action cannot replace a newer action's retry key.

New batches, new steps, step deletion, new recipes, new capsule sets, BSU defaults,
pick-note preview and import require a reachable writable server. Pick notes can
be pasted or opened from a Markdown or text file. Preview shows resolved lines,
refusals, normalisations and proposed batches. Import requires a second explicit
confirmation and retains its key across retries. Any refused selected line
disables import. A 409 refused plan replaces the preview with the server's plan.

The current server pages batches by ascending id, so newest-first sorting applies
to loaded batches only. Global date ordering needs a server cursor ordered by
start date. Batch replies store snapshot steps but no snapshot name; a current
recipe name is labelled as such. History currently returns attribution and action
without before/after payloads. The tab displays changed values if supplied and
otherwise says that the server did not supply them; it makes no per-row requests.

API reads use identity's existing per-account ETag cache; signed immutable atlas
metadata and tiles use the shared metadata cache and browser cache. Lists have limit and
cursor parameters and Load more controls. Lab permissions also load progressively
with the lab choices. The 5000-source mocked request test
compares three outline requests with six outline-and-label requests for three
mounts without labels, and checks progressive publication. Supplied source labels
require no additional detail reads. Image tests compare three former element
reads with nine metadata reads (three elements, three listings, three manifests)
for both 15 and 5000 grains on three mounts. The invented cell geometry uses
three distinct tile URLs across those mounts. Tests log request counts and mock
elapsed times, cover token renewal, and check the six-tile queue. Five thousand operator labels share one
bounded account request. Browser acceptance
coverage lives in `ui/tests/tims.spec.ts` and `ui/tests/tims-review.spec.ts` (Chromium
and WebKit). The client and Review details remain in [tims-client.md](tims-client.md).
