# Review tab: results in the context of the images

**Status:** plan, 2026-11-06. Yiming's direction the same day: UPb Lab links
the pipeline and does no reduction; raw LA-ICP-MS data and grainatlas image
sets are uploaded from it; after spot placement and UPbRPy reduction the user
comes back to it and reviews each grain's results next to its SEM images and
spots, clicking from a plot point to the spot in the registered CL image and
back. This page records what exists, the gaps, and the design. It changes
`docs/WORKFLOW.md` stage 9 (results) and `ARCHITECTURE_PLAN.md` section 4.3.

## 1. What exists (audit at upbstudio 410c551, UPbDB 2cde680, grainatlas eb31692)

### The shell has no reduction

Searched `ui/src`, `src-tauri/src` and `bridge/src` for decay constants,
ratios, Concordia, weighted means, MSWD, baseline or down-hole code: none.
The only UPbRPy path is `src-tauri/src/studio.rs`, which finds UPbRPy Studio
and launches it with a `upbr://` link. The Review tab keeps it that way: it
reads values a reduction run already stored in UPbDB and plots them. The
one piece of arithmetic it does is drawing reference lines (the Concordia
curve from the standard decay constants, and the 2σ ellipse of a point from
its stored uncertainties and error correlation), which is display, not
reduction. It has no reduction settings, no selection windows, no
re-calculation.

### Upload (Home)

Home has **Open folder…** / **Open files…** (desktop: the native dialog;
web: file inputs) and accepts drops anywhere on the window. `ui/src/lib/drop.ts`
decides by content: TM4000 packages, area folders, images and `.grainatlas`
project folders go to Images; Qtegra export folders, zips and CSVs go to
Sessions (`upbdb://ingest?path=` on the desktop). The files reach the
module through `@lab/bridge` `open-files` (protocol v2). Home shows one status
line for the last opened set and the module's outcome
(`grainatlas.files.opened`, `lab.open-files.seen`). There is no explicit
"upload a session" or "upload an image set" action, no progress beyond that
line, and no step after the upload (nothing leads to the results).

grainatlas, hosted, refuses `kind: 'project'` (a `.grainatlas` folder) with a
hint: the wasm core cannot open one. The project folder holds `project.json`
and `spots.json` but no pixels (`mosaic/` is empty); `project.json` records the
SEM package it came from (`package.path`). Hosted grainatlas opens the package
and then the project's `project.json` on its Open screen.

### Results in UPbDB (`service/apps/results/api.py`, `docs/workflow_api.md`)

| Endpoint | Gives | Carries spot links |
| --- | --- | --- |
| `GET /v1/sessions` | sessions | |
| `GET /v1/sessions/{id}/reductions` | runs, `is_preferred_for_session`, `result_count` | |
| `GET /v1/sessions/{id}/results?run=preferred\|latest\|<id>` | one row per acquisition: `acquisition_id, label, kind, sample_id, sample_name, spot_id, atlas_spot_id, run_id` then every UPbRPy column (ratios, `_2e`, `err_corr`, `tw_rho`, dates, `preferred_date*`, concentrations, `Th/U`, `disc%`, `automatic_flags`) | `spot_id`, `atlas_spot_id`; **no** `atlas_project_id`, grain or mount |
| `GET /v1/acquisitions/{id}/results?run=…` | one acquisition's values per run | none |
| `GET /v1/mounts/{id}/results` | per (spot, acquisition): `spot_id, atlas_spot_id, atlas_project_id, label, grain_label`, session, run, preferred date and 2σ, key ratios, U/Th/Pb, Th/U, discordance, flags | yes; preferred run only, a summary rather than every column |
| `GET /v1/samples/{id}/results` | rows across sessions | `spot_id`, `atlas_spot_id` |
| `GET /v1/acquisitions/{id}/sweeps?quantity=y` | raw counts per channel per sweep | |
| `GET /v1/mounts`, `/v1/mounts/{id}` | mounts, slots, samples | |

Gaps:

1. No query by physical spot or grain (all runs of one spot across sessions;
   all spots of one grain).
2. No lookup from a grainatlas spot id to the UPbDB spot and its
   acquisitions, which the reverse click needs when the spot is not in the
   loaded table.
3. Session result rows lack `atlas_project_id`, `grain_id`, `grain_label` and
   `mount_id`, so a session view cannot open the right grainatlas project.
4. The run's depth profile (`depth_profile_results.csv`, stored at import as a
   derived Parquet `SweepDataset`) has no read endpoint. The shell must not
   compute ratios from raw sweeps (that is reduction), so the depth-profile
   plot needs one.

### grainatlas through the bridge (`ui/src/App.svelte`, `ui/src/lib/deeplink.ts`, `actions.ts`, `remote.ts`)

- In: only at page load, `?project=<id>&spot=<id>` (a saved project from the
  recent list; waits on the Open screen for its package) or
  `?server=<base>&project=<id>&spot=<id>` (the published atlas, read-only).
  Both select the spot and centre the canvas on it (`app.focusSpot`). A new
  request means reloading the webview, which loses the open project.
- In: `open-files` (packages, areas, images).
- Out: `notify({type: 'grainatlas.spot.selected', project, spot, name})` on
  every single-spot selection; `open('upbdb://…')` links.
- No message from the shell to a module after load (other than the
  open-files nudge), so no "focus this spot" without a reload, and no grain
  focus at all.

### Local data on 2026-11-06

The local UPbDB (`:8000`, data root `~/upbdb`) has VISIT-2026 with
mounts Demo_S_150X, Mount_S_150X, Mount_XS_150X, 461 physical spots
with atlas ids (grainatlas projects in `2026_visit/SEM_grainatlas/`), and
sessions Zircon_demoA_Run1 (232 acquisitions) and Run2 (324), plus the
demo sessions. **No reduction run has been submitted and no atlas is
published.** The walkthrough therefore runs on a scratch copy of that
database and data root, with Run1 reduced headlessly by
`upbdb/scripts/reduce_session_bundle.py` (UPbRPy defaults, not Yiming's
reviewed reduction) and imported there.

## 2. Design

### 2.1 Review tab (shell, `ui/src/routes/Review.svelte`)

A fifth tab between Sessions and Reduce: Home, Images, Sessions, **Review**,
Reduce (`Ctrl/⌘ 1–5`).

- **Scope picker** (top): a session or a mount, and the run (preferred by
  default; any complete run of the session selectable; a mount scope uses each
  session's preferred run, as UPbDB does).
- **Left, samples and grains:** samples, grains under them, spots under the
  grains; each spot row has a badge (preferred date ± 2σ, coloured by pass or
  flags; grey when not measured; reference materials grouped apart). Filter
  box. Unknowns only by default, reference materials on a toggle.
- **Centre, plots** (uPlot, as UPbDB's `TracePlot`/`OverlayPlot`):
  - *Concordia*: Wetherill (207Pb/235U vs 206Pb/238U, `err_corr`) and
    Tera-Wasserburg (238U/206Pb vs 207Pb/206Pb, `tw_rho`), 2σ ellipses from
    stored values, coloured by sample, Concordia curve with age ticks.
  - *Geochemistry*: any two numeric result columns on x and y (default U vs
    Th/U, log axes optional); *REE pattern*: chondrite-normalised La…Lu per
    spot (the normalising values are a constant table, shown in the legend).
  - *Depth profile*: one spot's sweep-level ratios from the run's derived
    depth profile (new UPbDB endpoint), against sweep time or depth.
  Click a point to select its spot; the selected spot is drawn on top with a
  ring; the others dim.
- **Right, spot details:** label, sample, grain, mount, session, acquisition
  time, preferred date and method with 2σ, key ratios, U, Th, Th/U,
  discordance, flags, run (preferred or not, pipeline version), links: *Show
  in images* (`focus-spot`), *Raw sweeps in Sessions*
  (`upbdb://acquisition/<id>`), *Open run in Studio* (`upbr://run/<id>`).
- **Read-only.** No settings that change a value; the plot options are view
  options only.

### 2.2 Review and Images side by side

At a window width of 1440 CSS px or more a **Side by side** toggle in the
Review tab shows Review on the left and the Images module on the right (the
same grainatlas webview or iframe, moved, never a second copy, so the open
project survives). Below 1440 px, or with the toggle off, a click switches to
the Images tab, and grainatlas's selection comes back to Review the next time
it is shown. The choice is remembered in settings. At 1280 × 800 the split is
not offered.

### 2.3 `@lab/bridge` protocol v3

Adds shell-to-module commands. Everything older keeps working: a v3 module on
an older shell gets no commands; an older module ignores them.

```ts
import { onCommand, notify, SHELL_EVENTS } from '@lab/bridge';
onCommand((cmd) => {
  // { type: 'focus-spot', project, spot, flash?: true }
  // { type: 'focus-grain', project, grain, spot?: <atlas spot id in it>, flash?: true }
});
notify({ type: SHELL_EVENTS.spotSelected /* 'lab.spot.selected' */, project, spot, name, grain, via: 'user' | 'shell' });
```

- `project`, `spot`: grainatlas project and spot ids (UPbDB
  `atlas_project_id`, `atlas_spot_id`). `grain`: the grain label as UPbDB
  stores it (`<area_id>/<grain_number>`, what grainatlas sends), or a
  grainatlas grain id.
- Desktop: the host keeps the latest command per module webview and
  dispatches `lab-bridge:command` on its `window`; the bridge takes it with
  `bridge_take_command`. A command sent before the module loaded is delivered
  when it registers `onCommand`.
- Web: the shell posts `{tag: 'lab-bridge', v: 3, push: 'command', command}`
  to the module iframe (origin-checked like the rest).
- Out: `lab.spot.selected` replaces `grainatlas.spot.selected`; the shell
  accepts both. `via: 'shell'` marks a selection made because of a
  `focus-spot`, so the Review tab does not answer it.

### 2.4 grainatlas hooks (minimal, its own commit)

- `onCommand` when hosted: `focus-spot` opens the project if it is not the
  open one (a published atlas through `?server=`'s route, else the saved
  project from the recent list, as a deep link does), selects the spot,
  centres the canvas, flashes it; `focus-grain` does the same for a grain.
- `lab.spot.selected` on spot selection (spot panel or canvas), with `grain`
  and `via`.
- Hosted, a `.grainatlas` project folder offered through `open-files` is no
  longer refused: its `project.json` waits for its package (named on the Open
  screen), as a deep link waits, and is applied when the package opens.
- Standalone behaviour unchanged.

### 2.5 UPbDB (minimal, its own commit)

- `GET /v1/spots/{spot_id}/results?run=preferred|latest|all` (all
  acquisitions of the physical spot across sessions, full value columns),
  also reachable by grainatlas id as `GET /v1/spots/by-atlas/{atlas_spot_id}/results`.
- `GET /v1/grains/{grain_id}/results` (every spot of the grain).
- Session, sample and spot result rows gain `atlas_project_id`, `grain_id`,
  `grain_label`, `mount_id` (additive columns at the end of the fixed set).
- `GET /v1/acquisitions/{id}/depth-profile?run=…`: that acquisition's rows of
  the run's derived depth profile as JSON columns.

### 2.6 Upload path (Home)

Two explicit cards next to Open: **Upload LA-ICP-MS session** (Rich CSV,
per-spot folder, or both; goes to Sessions' ingest with the files) and
**Upload image set** (SEM package or `.grainatlas` project; goes to Images,
then offers to publish the atlas to the mount from grainatlas). Each shows
progress (files listed and read, taken by the module, the module's outcome)
and ends with **Review this session** / **Review this mount** once UPbDB
has it.

## 3. Checks

Playwright at 1440 × 900 and 1280 × 800 in Chromium and WebKit for Home, the
Review tab (fake UPbDB replies), and the split view; bridge unit tests for
v3 in both transports; UPbDB pytest for the new endpoints; grainatlas
Playwright for `focus-spot` and `lab.spot.selected` through the web shell.
Then the Tauri app against the scratch UPbDB with Run1 and the demo
or second project: concordia point to the spot in the CL image, and back.

## 4. Walkthrough with the lab-visit data, 2026-11-06

Desktop app (`cargo tauri dev`, macOS) against a scratch copy of the local
UPbDB: the VISIT-2026 database and data root copied, served on
`127.0.0.1:8001`; Yiming's own database on `:8000` was not touched.
Zircon_demoA_Run1 and Run2 were reduced headlessly with
`upbdb/scripts/reduce_session_bundle.py` (UPbRPy defaults and automatic
windows, not the reviewed reductions still open in UPbRPy Studio) and
imported; Run1's run was marked preferred, Run2's left as the newest
non-preferred run. The Demo_S_150X atlas was built from the TM4000
package and the saved `Demo_S_150X.grainatlas/project.json` with
grainatlas's own wasm core (as its Publish button does) and published to the
Demo_S_150X mount: all 234 spots matched the existing physical spots
unchanged.

1. Review opened on the last scope; Run2 showed "Newest run, not
   preferred". Scope Demo_S_150X (mount): 9 samples, Concordia around
   1000 to 1200 Ma.
2. Click on the discordant SampleA_S_157 ellipse (side by side, 1480 px):
   grainatlas opened the published atlas read-only from the server, switched
   to area SampleA, selected and centred SampleA_S_157 and flashed it; it reported
   `lab.spot.selected` with `via: shell` and Review did not answer.
3. A spot picked in grainatlas's spot list (SampleA_S_145, later SampleB_S_120) was
   selected in Review: tree scrolled to it, details and plot ring updated; the
   values agree with grainatlas's spot panel.
4. Depth profile of SampleA_S_145: stored 206Pb/238U and 207Pb/206Pb dates per
   sweep with 2se bands.
   Geochemistry U against Th/U, and the CI-normalised REE patterns.
5. Window at 1280 × 800: three columns, no side-by-side toggle.
   Double-click on SampleB_S_123 switched to Images centred on that spot;
   SampleB_S_122 clicked on the canvas there was selected in Review when its tab
   was shown again.

Fixed during the walkthrough: axes followed the whole Concordia curve and
every ellipse (one poorly measured spot squashed the rest); the axis label
formatter threw on uPlot's null ticks; log axes drew every minor gridline;
unmeasured spots added an empty "No sample" legend entry; a hover box stayed
when the pointer left for the native Images webview; detail values printed
six significant figures and no space before ±; the selected point was lost
inside dense clusters.

Not covered: the web delivery against a real server (Playwright covers it
with fixtures), Windows, a session whose spots are on a mount with no
published atlas (grainatlas then waits on its Open screen for the package,
which was exercised only by grainatlas's Playwright spec), and grainatlas's
own layout in a 740 px half window (its top bar and right panel are clipped;
grainatlas's to fix).

## Mount name and region summary (2026-11-21)

Review’s SEM images title names the mount open in the viewer, followed by up
to two unknown sample names and a count of the rest. Its tooltip includes all
loaded sample and standard names. The selected spot’s mount is the fallback
when the viewer has not reported a known project. The mount label is a button
that opens a whole-mount summary in Spot metadata.

Clicking the mount title, an area or a sample region in GrainAtlas’s inset
moves the image view there and opens the corresponding summary. It counts
distinct grains and physical spots, analysed spots and grains with TIMS
fractions; lists the LA-ICP-MS sessions newest first and up to 20 fractions;
and offers Review session, Review this mount, Close and Back to the previous
spot. Picking a spot or changing scope clears the summary. This is a read-only
view, including View as mode.

The summary uses the current mount rows or one cached, revalidated mount
results read, plus the existing bounded TIMS fraction reader. It makes no
per-spot or per-session reads. Area and sample membership comes from the
viewer’s atlas spot ids; a sample with no matching ids falls back to its
stored sample name and says so. UPbDB’s additive `session_started_at`,
`sample_id` and `sample_name` fields are optional. Session dates fall back to
the loaded session list, and unavailable dates and TIMS endpoints are stated.
