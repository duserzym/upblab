# TIMS chemistry

The TIMS tab follows Reduce. CmdOrCtrl+5 opens it on desktop or the web.
Review's Open batch button and `upbdb://tims/batch/<id>` open a chemistry batch.
The route stays mounted across top-level tab switches.
Opening the same batch from Review returns to Batches even after visiting another
TIMS section. Opening a batch also selects its lab when that lab is loaded.

Batches lists one page at a time. Capsule set, inclusive start dates and fraction
status are remembered per account and server, outside the URL. New batch forms
use active capsule sets and mineral-specific active recipes. On a five-position
puck, numbering starts at the front left and proceeds clockwise to the front
right. The top view shows the centre stem hole and the notch facing front
between the first and last positions on each puck. See the
[Boise State shop drawing](https://www.boisestate.edu/earth-isotope/labshare/design-instructions-shop-drawings/).

Select an empty capsule and choose **GrainAtlas**. Choose a mount and click
a grain image. All registered associated LA spots are selected by default.
Loading the capsule creates one fraction with the selected sources in one
request. In an occupied capsule, **Browse GrainAtlas** links an additional source.
UPbDB accepts one source per request on an existing fraction. The picker
pages searchable mount lists, reuses the selected mount's element snapshot
and shows grain thumbnails progressively. UPbDB supplies elements as a single
mount snapshot rather than a paged grain list.

Grain choices lead with their registered spot names, followed by the grain label.
Use **Spot, grain or sample** to filter the open mount in memory, and **Sample**
to narrow it further. Separators and case do not matter: `195`, `S 195`,
`S_195` and `ZZ01_S_195` find the same invented spot. Numbers match whole
number tokens, ignoring leading zeros; `195` does not match `1950`.

Press Enter or **Find spot** with a sample name or a full spot name to look
across mounts. UPbDB searches mount labels and sample names; the picker checks
up to five candidate mounts and reuses cached elements. A unique complete
match opens its mount and selects its sample. Several matches appear as mount
choices with their matching spot names. For more candidates, narrow the manual
mount filter with **Find mount**. Typing alone never requests mounts or elements.
Linked spot names lead capsule source lines and Review fraction cards, and full
names appear in capsule-position accessible labels and tooltips.

For an unmounted sample, register it in UPbDB with its project and metadata.
In an empty capsule, choose **TIMS only**, search by sample name or IGSN and
select the registered record. This list includes all registered samples except
those whose **Material** is **Lab blank** (ignoring case and surrounding spaces).
The sample's **Purpose** does not affect the list.
Choose the mineral and assign the fraction to the capsule. UPb Lab creates
the fraction with an empty source list and displays its TIMS-only preparation.

For process blanks, register a reusable sample for the lab or project with
**Lab blank** in **Material** and include “blank” in the sample name. Choose
**Lab blank** on an empty capsule and select that sample. Each assignment
creates a separate fraction and opens Spiking when the batch has a Spiking
step. Use the usual bottle readings and comments. The blank consumes spike
in the same bottle sequence as the other capsules in the session.

Sample registration uses UPbDB's staff admin form. The capsule assignment
uses the existing fraction API, with the preparation stored alongside fraction
notes. The API requires a registered sample for both kinds of source-free
fraction.

Select an occupied capsule and choose a step in the side panel to view or
edit its date, parameters, skipped state, outcome and notes. Batch defaults
can be overridden per capsule. The matrix opens the corresponding capsule
record. Chemistry writes leave the explicit fraction status alone.

Open **Batch steps** and edit **Spiking** to log the session date. Choose each
registered spike version and enter the beginning weight of its bottle. In a
capsule's **Spiking** pane, choose the bottle, check its composition and enter
the full bottle weight in grams after dispensing. Record entries in weighing
order. Each bottle carries its last ending weight forward as the next starting
weight within that batch session. The capsule records both readings and their
difference. Use **Spike comment** to record missed drops, uncertain retained
amounts or other observations alongside the balance readings.

Use **Add another spike entry** when you return to a capsule. The first repeat
may require an online connection to create a linked step. Each addition has
its own readings and comment. Once a later entry uses a reading as its starting
weight, the earlier entry remains available for comment edits. Create a new
Spiking step in **Batch steps** for a separate session.

UPbDB stores each addition's registered version, measured loss, balance
readings, comment and creation time. The session's bottle starts are saved in
its step notes. A future lab-wide usage view can group the additions by
registered bottle and apply supervisor access on the server.

Use **Column protocol** within **Column chemistry** to view the lab's saved
protocol for the selected U–Pb scheme. UPbDB holds one protocol per lab and
scheme (HCl anion or HBr-HCl), including its title, text, attribution, source URL,
revision and last updated time. No guidebook text is bundled in this public
repository. Without a lab protocol, including on older servers without this
endpoint, the panel links to the
[Boise State U-Th-Pb Lab Guidebook](https://www.boisestate.edu/earth-isotope/labshare/laboratory-handbooks/)
in the system browser.

**Recipes → Lab column protocols** lists both schemes. Lab owners and
superusers can create or edit a protocol; other members see it read-only.
**History** shows the protocol's versioned server history. Saves require a
reachable writable server and include the revision loaded by the editor; they
never enter the outbox. If someone saved a newer revision, reload it before
editing again. View as remains read-only.

The displayed text uses this order: capsule copy, batch-step copy, lab protocol,
then reference link only. A capsule using a different scheme skips the batch
copy and uses that scheme's lab protocol. **Add protocol copy** starts from the
inherited text, or empty text when no saved text exists. Save a copy in the
batch-step or capsule notes with the usual save action. **Use inherited
protocol** removes that layer's copy and returns to the next layer.

Lab protocols and saved copies can be printed. Lab text prints its stored
attribution; edited copies use that attribution with “edited copy” appended,
or the existing guidebook attribution when none was stored. Recipes also shows
the lab protocol read-only within each column step. Lab protocol lists share
one bounded read per lab, including across capsule panels, and reuse identity's
account-and-server-scoped ETag cache and desktop offline mirror. After saving,
the list is revalidated so the saved protocol can be viewed and printed offline.

Grain thumbnails in capsule positions (36 px), the capsule inspector (104 px) and
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

Spikes has a compact solution list and a detail view, with the published master
calibration selected first when present. Current calibrations appear first;
earlier versions are disclosed on request. Composition tables show reference
precision, uncertainties and provenance, with Full precision for stored numbers.
Version details are reused within the current lab and identity scope. Status and
notes editing remains in a separate disclosure: members may edit private
versions, and public versions require a superuser. The batch spike picker uses
the same tables before Apply; withdrawn versions cannot be applied. Non-current
versions carry a warning, including any warning returned with a spike addition.
Bottle differences come from the server. Creating spikes and versions is not included.

Except for lab column protocols, existing-record changes are saved durably in
the account-and-server-scoped outbox before transmission. Pending bodies overlay the last GET and say “Saved here,
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

An assigned source offers **Replace grain**. The picker names the source being
replaced, shows whether the sample will change, and accepts an optional reason.
The server keeps the old source as a replaced record. For a different sample,
it either moves the capsule, chemistry and spikes to a new fraction or explains
why replacement is blocked. Source history shows the viewer, date and reason;
a new fraction also names the fraction it replaces. Older servers report that
Replace grain is unavailable. Like source add and retire, replacement requires
an online connection and keeps one idempotency key across retries. Queued
chemistry edits continue to say “Saved here, not sent yet”.

At 1440 × 900 and 1280 × 800 px the open capsule bench has three columns:
compact puck map, capsule record, and GrainAtlas picker. At 1024 × 640 px the
map sits above the record on the left, with the picker beside them. Capsule
forms and the picker scroll inside their own panels; their action bars stay
visible. The grain gallery also scrolls independently. **Previous** and
**Next capsule** follow capsule positions in puck order.

An empty capsule opens the picker directly. Mount, sample filter and search
carry forward to the next capsule. These preferences are held in memory and
viewer-local storage under server, account and batch keys. Mount and sample
stay after assignment; the grain search text is cleared after a successful
assignment. **Change mount** opens an in-flow searchable list. It filters loaded
labels, sample names and projects without making requests while typing.
The last five mounts appear under Recent, then mounts are grouped by project
or sample. Rows show magnification, sample and grain counts and sample names.
Arrow keys, Home, End, Enter and Escape navigate the list. **Load more mounts**
pages the server list; **Find mount** submits a server search. No mount detail
request is made for a list row.

**Refine in GrainAtlas** opens the standalone editor at the source's project
and spot, or grain when there is no spot. On the web it uses the configured
hosted editor. UPb Lab checks the mount's content revision on return and every
20 s while visible for 10 minutes. A changed revision refreshes that mount's
elements, image metadata, capsule labels and puck outlines, and says “Updated
from GrainAtlas”. Missing revisions on older servers cannot prove a change;
use Refresh batch there. UPb Lab never edits registered grains or spots or
adds capsule fields to their sync hashes.

The hosted GrainAtlas URL parser currently reads spot targets but not grain
targets. Grain-only centring on the web needs that parser and its selection
path to accept the grain parameter. The desktop launch parser already accepts
spot and grain arguments; the installed app still needs a smoke test.
