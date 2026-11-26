# TIMS chemistry

The TIMS tab follows Reduce. CmdOrCtrl+5 opens it on desktop or the web.
Review's Open batch button and `upbdb://tims/batch/<id>` open a chemistry batch.
The route stays mounted across top-level tab switches.
Opening the same batch from Review returns to Batches even after visiting another
TIMS section. Opening a batch also selects its lab when that lab is loaded.

Batches has Rows, Calendar and Lanes views. The choice is remembered per viewer
and server with the guided-workflow preference mechanism, including an in-memory
fallback when browser storage is blocked. Capsule set, inclusive start dates and
fraction status apply automatically after 300 ms and are remembered per account
and server, outside the URL. There is no Apply filters button.

Rows requests 200 batches at a time with `order=-started_on`; Load more batches
follows the opaque cursor. Each row opens the batch and shows its capsule set and
code, friendly start date (ISO date in the tooltip), samples, stored spike progress,
state, analyst and recipe. Samples truncate with all names in the tooltip. A row
keeps the accessible name “Krogh · 2026-11-06”; its accessible description includes
the state. Column header buttons sort by start date or capsule set and expose
`aria-sort`. Opposite date order, set sorting and older-server date sorting operate
on loaded rows, with a note while another page remains. States are Complete when
`completed_at` is stored, Ready to complete when all nonzero capsules are ready,
Empty for zero capsules, In progress otherwise, and Open without counts.

Calendar shows a Monday–Sunday month grid with Today and month navigation.
It requests the intersection of the month and selected start-date filters, publishes
each cursor page immediately and stops after ten pages with a “Showing first n”
notice. Two chips fit in each day; “+n more” opens a keyboard-accessible dialog.
Escape closes it and restores focus. Calendar months are cached for the session
(up to 24 queries), partitioned by viewer and filters. Account, server, oversight,
lab and batch-save changes clear that cache.

Lanes shows the loaded active capsule-set catalog, including free sets. Load more
set choices extends that catalog. Each batch spans its stored start and completion
dates, or today while open. Inclusive overlapping ranges stack in separate tracks.
Weeks and Months change the drawing scale; Earlier and Later extend the initial
window (eight weeks before today through four weeks after) by four weeks. The
label column stays fixed as the time axis scrolls inside its container. Requests
use `active_after` and `started_before`, plus the shared filters, publish each page
and stop after ten pages. These date positions and states are display logic only.

All views use `identity.get` through the current server target. In This computer
mode that target is the local UPbDB service, including a read-only mirror. The
normal ETag cache, cached desktop replies and offline-copy banner remain in use.
Older servers and mirrors can omit every summary field: catalog names are reused,
samples and spike progress show a dash, and completion/start dates still draw
calendar chips and lanes. Missing counts mean Open unless completion is stored.
When rows lack the new summary fields, date sorting falls back to loaded rows.
For lanes, such a reply triggers a second scan with `started_after` 120 days before
the window (or the stricter user filter); older open batches may be absent, and
the view says so. No list view requests batch details or account names per row.

New batch forms use active capsule sets and mineral-specific active recipes. On a five-position
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

Grain thumbnails in capsule positions (28–60 px wells), the capsule inspector (104 px) and
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

Except for lab column protocols and spike weighing, existing-record changes
are saved durably in the account-and-server-scoped outbox before transmission. Pending bodies overlay the last GET and say “Saved here,
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

New servers provide a stable descending start-date cursor and optional batch-list
summaries. Old servers keep their id cursor. Batch replies store snapshot steps;
a recipe name falls back to the current catalog when the server omits it. History currently returns attribution and action
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

Loose-grain sources show their sample-local label in the puck and capsule
record. They have no mount, linked LA spot or GrainAtlas image. **Replace
grain** and **Refine in GrainAtlas** are disabled for these sources because
the picker and editor support mounted GrainAtlas grains only. Older servers
that omit loose-grain fields keep the existing source display.

At 1440 × 900, 1280 × 800 and 1024 × 640 px the capsule bench keeps three
columns: capsule puck board, capsule record, and a shared workspace for the
GrainAtlas picker, Batch steps or Step × capsule matrix. Review & complete
uses the picker column. The board scales from 300 px to 400 px at widths of
at least 1280 px and stays 160 px below that, without moving above the inspector. Capsule forms and the picker scroll inside their own panels; their action bars stay
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

## Guided capsule setup and required spike weighing

The in-flow setup rail follows Batch & capsule set, Grains, Spike, Chemistry,
then Review & complete. Select a step directly or use Back. Next incomplete
wraps through capsules missing the current item. Capsules and chemistry steps
remain directly selectable. The current guided step is saved per viewer, server
and batch, with guarded local storage and an in-memory fallback. Browsing never
writes chemistry records.

The batch header starts with the text-link breadcrumb **‹ Batches**, whose
accessible name remains **Back to batches**. The capsule-set title stands beside
an English calendar date such as **6 Nov 2026**, with the stored ISO date in its
title. Neutral metadata chips show the analyst, recipe name and, for a fixed
single lab, the lab name. When only the current recipe name is available, its
provenance appears in **About the recipe name**, an info tooltip reachable by
hover, focus, click or Enter; Escape closes it. **No recipe** has no info button.

The **Capsules | Steps | Matrix** segmented control is a **Batch views**
radiogroup. Its radio names and titles are **Capsules**, **Batch steps** and
**Step × capsule matrix**. Left/Right wrap through the views, Home/End select
the ends, and Tab reaches the selected radio. Icon buttons keep the names
**Refresh batch**, **Edit batch** (or **Cancel edit**) and **History**. History
opens over the bench without changing its size or its request behaviour.

The 54 px workflow stepper has short labels **Setup**, **Grains**, **Spike**,
**Chemistry** and **Review**. Each button names the full guided step and its
second line. Setup says **Done** with a capsule set, date and operator, otherwise
**Check**. Grains counts against all positions; Spike and Review use the
existing readiness totals. Chemistry counts each live mapped capsule with at
least one record on a non-spike step, once, against live capsules. It says
**Not started** without non-spike steps, **In progress** without fraction step
records, otherwise **n of m recorded**. Counts reflect records already returned
by the server; no analytical values or extra requests are introduced.
Completed counts get a check mark; the selected guided step takes precedence,
uses a filled accent circle and has `aria-current="step"`. Its hint is in the
full title and accessible description. **Back** and **Next incomplete** sit at
the right. The plain **Next** button is removed; select the next step instead.

A multi-lab selector and Load more labs remain above the header when needed.
The batch list and other TIMS sections retain their lab row. The status element
has no height while empty; errors and completion messages remain visible.
Notes, pending saves, read-only reasons and the edit form may add height.
For the single-lab fixture, the header has a 16 px breadcrumb, 32 px title row,
4 px internal gap and 12 px vertical padding. With the 54 px stepper and two
6 px gaps, the expected chrome above the bench is 130 px at 1440 × 900 and
1280 × 800 px, within the 138 px budget. Rows use integer heights to preserve
WebKit's puck sizing. Below 1100 px the title and controls wrap onto separate
rows. Browser measurements in both engines remain for the supervisor.
The bench fills the remaining module height. There is no bottom chemistry rail.
Shared control props and keyboard behaviour are documented in
[UX conventions](ux-conventions.md#control-shapes-2026-11-25).

All three bench columns stay mounted, including the empty inspector and closed
picker. The third column is labelled **Batch workspace** and shows **Grain
selection**, **Step timeline** or **Capsule record matrix**. The steps and matrix
scroll within that full-height column. Batch-step selection sits above the step
editor so all controls fit the picker width. Opening GrainAtlas or Replace grain
from the inspector selects Capsules; from Review it also returns to Grains.
Chemistry guidance points to Batch steps.
The inspector keeps exactly 48 % of (bench width − 196 px). With two 8 px gaps
and a minimum picker width of 345 px, the board gets the remaining width,
clamped between 300 px and 400 px: about 383 px at 1440 × 900 and 300 px at
1280 × 800 px. Below 1280 px the board track is 160 px and each other track gets
half the remaining width after 16 px of gaps. These tracks depend only on
available width; view switches do not move the board or inspector.

The board centres one puck, pairs two, places three in a triangle with Puck 3
centred below Pucks 1 and 2, and wraps larger sets in rows of two. Below
1280 px the pucks form one scrolling column. Wells use the existing clockwise
position order. Each label has its own fixed 44 × 37 px box (42 px wide for
the two six-hole centre labels): a bold 11 px
capsule name on a 13 px line, 10 px grain/spike marks on an 11 px line, and a
reserved third 13 px line for an 11 px loose-grain name. Captions use 12 px text
within a separate 18 px row. Longer capsule and loose-grain names use ellipsis
and full titles. The rendered system font is measured for loose-grain names:
short labels such as LG-7 stay inside the well without truncation; names wider
than its inner space appear on the reserved third line instead. This cannot
change the footprint. On macOS, K15 bold at 11 px measures 20.9 px, and
G ✓ S ✓ at 10 px measures 40.4 px; the browser checks the actual font too.

Five-hole pucks put the top three labels above their wells and the lower two
below. The upper side labels move outward enough to clear the top label and
well. Their horizontal extent stays within the disc width at both target
sizes, so external labels do not reduce the disc diameter. Ring radius remains
1.05 times well size and disc diameter remains 3.65 times well size. Four- and
six-hole rings widen as needed to clear the fixed labels; six-hole pucks keep
two labels side by side in the centre, with a minimum footprint that still fits
the narrow board track. More than six positions use grid cells with labels
beneath their wells.

The board measures its available area on resize and chooses the largest well
size from 28 px to 60 px that fits all puck footprints. The three five-hole
fixture pucks have approximately 182 px discs and 49.9 px wells at 1440 × 900,
and 140.5 px discs and 38.5 px wells at 1280 × 800. They fit without board
scrolling. Larger sets keep 28 px wells and scroll when necessary. The
selection hint and geometry-error message share a permanent status line;
selection, guidance, view switches and image arrival cannot resize or move the
pucks. The board keeps a 1 px sizing margin for fractional browser measurements.
The inspector, picker, review, steps and matrix scroll internally. Status slots
inside the inspector and action rows reserve their height. Disclosure and
capsule changes preserve panel scroll; long rows truncate inside fixed boxes,
with full labels in titles.

Readiness from batch detail is authoritative when supplied. On older servers,
the pure client fallback lists active fractions in the capsule map. A grain is
ready with a live source or an explicit TIMS-only or Lab blank preparation. A
spike is ready with a pinned version and positive mass at a batch spike step.
Only a missing spike prevents completion; lost capsules and those dissolved
during CA are exempt. Grains and chemistry are shown for checking. Totals count
capsules, grain, spike, ready and pending. Empty positions are incomplete for
Grains navigation, but are excluded from Spike and Review counts and navigation.
Capsule marks show grain and spike independently. Chemistry statuses from spiked
through measured require a spike addition; server `spike_required` rejections
are explained in the capsule status slot.

The required spike card accepts direct mass in g or the session bottle before
and after readings. Bottle starts continue from the most recent reading for
that bottle. Choose active solutions and current registered versions; Show
older versions exposes superseded calibrations with a warning. Withdrawn
versions are never offered as choices. An already pinned historical version
remains readable. Composition starts collapsed. Readability defaults to the
viewer's last successfully saved value (initially 0.00001 g). Analyst defaults
to the signed-in account, with a name override. The weighing timestamp is
entered in UTC and defaults to the current time.

The tracer card displays only the server's stored `tracer` rows while the
saved weighing is unchanged. An unsaved weighing or a response without tracer
rows says “Save the weighing to see the server's tracer calculation.” Stored
moles and their stored 1σ uncertainties are scaled to nmol or pmol for display;
missing uncertainty says “± not given”. The TIMS formatter controls significant
figures, with Full precision available and exact mol values in row titles.
The shell calculates no tracer amounts or uncertainties.

Spike saves require the reachable server so stale edits can be resolved in the
card. Every PUT carries `expected_updated_at` (null for a new addition), plus
the exact version, weighing metadata and bottle readings. A `spike_changed`
409 preserves the draft and shows both entries. Keep mine updates the expected
revision only after explicit comparison; a separate Save submits the draft.
Take server's loads the current server entry. Retry keys persist for unchanged
payloads. History is fetched only when opened, 50 rows per page, from
`/v1/fractions/{fraction_id}/spikes/history`; a 404 from an older server hides the list.

Review & complete lists each capsule's missing items. Complete batch is disabled
until every remaining capsule has a spike, with the exemptions above. The
server's `/complete` validation can still refuse with per-capsule missing items
after another analyst changes the batch. Refresh
after correcting them. Completed batches show who completed them and when;
Reopen batch explicitly re-enables editing. Older servers without completion
endpoints show a compatibility message. New detail fields are optional.

`ui/tests/tims-guided.spec.ts` covers guidance, next incomplete, weighing,
calculations, conflict comparison, required-spike errors, completion and reopen.
`ui/tests/ui-controls.spec.ts` covers header radio keyboard navigation, workflow
names and current state, recipe info and named action icons in both themes.
The shared `ui/tests/tims-layout.ts` helper measures the three permanent column
regions before and after clicks, accepting at most 2 px displacement in each
dimension and 1 px for wells, including Capsules → Batch steps → matrix →
Capsules switches. It checks the bench bottom within 4 px of the module bottom
at 1440 × 900, 1280 × 800 and 1024 × 640, in both themes. At the two larger
sizes it checks at most 138 px of single-lab chrome, minimum discs of 170 px and
140 px respectively, fixed font-size floors and real text widths. Rendered
well/label/caption collision checks accompany the pure layout proofs. A mocked 3000-row history list took 0.1 ms for two 50-row page requests;
browsing history made zero requests before and after this change. This measures
client overhead rather than network latency.
