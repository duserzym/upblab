# Review tab: results in the context of the images

**Status:** plan, 2026-11-06. Yiming's direction the same day: UPb Studio links
the pipeline and does no reduction; raw LA-ICP-MS data and grainatlas image
sets are uploaded from it; after spot placement and UPbRPy reduction the user
comes back to it and reviews each grain's results next to its SEM images and
spots, clicking from a plot point to the spot in the registered CL image and
back. This page records what exists, the gaps, and the design. It changes
`docs/WORKFLOW.md` stage 9 (results) and `ARCHITECTURE_PLAN.md` section 4.3.

## 1. What exists (audit at upbstudio 410c551, laicpmsdb 2cde680, grainatlas eb31692)

### The shell has no reduction

Searched `ui/src`, `src-tauri/src` and `bridge/src` for decay constants,
ratios, Concordia, weighted means, MSWD, baseline or down-hole code: none.
The only UPbRPy path is `src-tauri/src/studio.rs`, which finds UPbRPy Studio
and launches it with a `upbr://` link. The Review tab keeps it that way: it
reads values a reduction run already stored in laicpmsdb and plots them. The
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
Sessions (`laicpmsdb://ingest?path=` on the desktop). The files reach the
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

### Results in laicpmsdb (`service/apps/results/api.py`, `docs/workflow_api.md`)

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
2. No lookup from a grainatlas spot id to the laicpmsdb spot and its
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
  every single-spot selection; `open('laicpmsdb://…')` links.
- No message from the shell to a module after load (other than the
  open-files nudge), so no "focus this spot" without a reload, and no grain
  focus at all.

### Local data on 2026-11-06

The local laicpmsdb (`:8000`, data root `~/laicpmsdb`) has VISIT-2026 with
mounts Demo_S_150X, Mount_S_150X, Mount_XS_150X, 461 physical spots
with atlas ids (grainatlas projects in `2026_visit/SEM_grainatlas/`), and
sessions Zircon_demoA_Run1 (232 acquisitions) and Run2 (324), plus the
demo sessions. **No reduction run has been submitted and no atlas is
published.** The walkthrough therefore runs on a scratch copy of that
database and data root, with Run1 reduced headlessly by
`laicpmsdb/scripts/reduce_session_bundle.py` (UPbRPy defaults, not Yiming's
reviewed reduction) and imported there.

## 2. Design

### 2.1 Review tab (shell, `ui/src/routes/Review.svelte`)

A fifth tab between Sessions and Reduce: Home, Images, Sessions, **Review**,
Reduce (`Ctrl/⌘ 1–5`).

- **Scope picker** (top): a session or a mount, and the run (preferred by
  default; any complete run of the session selectable; a mount scope uses each
  session's preferred run, as laicpmsdb does).
- **Left, samples and grains:** samples, grains under them, spots under the
  grains; each spot row has a badge (preferred date ± 2σ, coloured by pass or
  flags; grey when not measured; reference materials grouped apart). Filter
  box. Unknowns only by default, reference materials on a toggle.
- **Centre, plots** (uPlot, as laicpmsdb's `TracePlot`/`OverlayPlot`):
  - *Concordia*: Wetherill (207Pb/235U vs 206Pb/238U, `err_corr`) and
    Tera-Wasserburg (238U/206Pb vs 207Pb/206Pb, `tw_rho`), 2σ ellipses from
    stored values, coloured by sample, Concordia curve with age ticks.
  - *Geochemistry*: any two numeric result columns on x and y (default U vs
    Th/U, log axes optional); *REE pattern*: chondrite-normalised La…Lu per
    spot (the normalising values are a constant table, shown in the legend).
  - *Depth profile*: one spot's sweep-level ratios from the run's derived
    depth profile (new laicpmsdb endpoint), against sweep time or depth.
  Click a point to select its spot; the selected spot is drawn on top with a
  ring; the others dim.
- **Right, spot details:** label, sample, grain, mount, session, acquisition
  time, preferred date and method with 2σ, key ratios, U, Th, Th/U,
  discordance, flags, run (preferred or not, pipeline version), links: *Show
  in images* (`focus-spot`), *Raw sweeps in Sessions*
  (`laicpmsdb://acquisition/<id>`), *Open run in Studio* (`upbr://run/<id>`).
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

- `project`, `spot`: grainatlas project and spot ids (laicpmsdb
  `atlas_project_id`, `atlas_spot_id`). `grain`: the grain label as laicpmsdb
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

### 2.5 laicpmsdb (minimal, its own commit)

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
and ends with **Review this session** / **Review this mount** once laicpmsdb
has it.

## 3. Checks

Playwright at 1440 × 900 and 1280 × 800 in Chromium and WebKit for Home, the
Review tab (fake laicpmsdb replies), and the split view; bridge unit tests for
v3 in both transports; laicpmsdb pytest for the new endpoints; grainatlas
Playwright for `focus-spot` and `lab.spot.selected` through the web shell.
Then the Tauri app against the scratch laicpmsdb with Run1 and the demo
or second project: concordia point to the spot in the CL image, and back.
Screenshots in `docs/screenshots/`.
