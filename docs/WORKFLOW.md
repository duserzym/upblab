# The lab workflow and the hand-offs between the apps

**Status:** v1.4, 2026-11-25. This is the cross-repository contract for how a
sample travels through the four applications. Each repository's own plan
points here for the hand-offs and keeps its internal design to itself:
`upbdb/docs/DATABASE_ARCHITECTURE_PLAN.md` section 8,
`grainatlas/ARCHITECTURE_PLAN.md` section 7, `UPbRPy/docs/lab_workflow_integration.md`,
and `ARCHITECTURE_PLAN.md` here (decision 10, phases 3 and 4). Change this
page first, bump the version line, then the app plans.

Changed in v1.1: results appear in the Review tab with plots linked both ways to the images.

Changed in v1.2: UPb Lab is the upload and review portal; edits open the
standalone apps in context (section 4a).

Changed in v1.3: UPb Lab has no Images tab. Uploads and edits go to
standalone grainatlas; Review shows the images read-only; grainatlas and
Studio leave a notice file when they change the database (section 4a).

Changed in v1.4: Home’s **Laser log** hands one Chromium `.lase` file to
UPbDB for upload and tying to the day’s sessions. Session cards show a tied
log and whether it has laser times.

## 1. The workflow

```text
 register samples ─> mount & polish ─> image (CL, BSE) ─> place spots ─> laser session
   UPbDB             UPbDB            grainatlas         grainatlas     instrument + Qtegra
                                                                              │
       results ◀── submit ◀── reduce locally ◀── open from database ◀── upload session
      UPbDB          UPbRPy Studio   UPbRPy Studio     UPbRPy Studio       UPbDB
         │
         └─ shown on the images (grainatlas), the timeline (UPbDB) and Home / Review (UPb Lab)
```

| Stage | Where | Record created | Hand-off out |
| --- | --- | --- | --- |
| 0. Register samples | UPbDB (SESAR/IGSN sheet import or form) | `sample` | sample names used in spot names |
| 1. Mount and polish | UPbDB mount page | `mount`, `mount_slot` (which sample sits where) | mount id |
| 2. Image | Home’s **Upload image set** hands the SEM package, `.grainatlas` folder or `.gaproj` file to standalone grainatlas (web: the hosted build in a new tab); stitch, correct, segment, scale | grainatlas project (local folder) **published** to UPbDB as an *atlas bundle* attached to the mount | `atlas://` project id; grain rows |
| 3. Place spots | grainatlas, with the mount's sample names | `physical_spot` rows in UPbDB (spot sync) with `atlas_project_id`, `atlas_spot_id` | laser spot list (registered to the laser stage) |
| 4. Laser session | instrument; Qtegra per-spot export with the spot name as the acquisition label; Home’s **Laser log** uploads the Chromium `.lase` record to UPbDB | `laser_log` with its scans and firings; after the tie, `session_laser_log` and `acquisition_laser_link` per acquisition. A log of placed scans only keeps settings and stage positions without laser times | the export folder; the `.lase` file, tied in UPbDB's tie dialog |
| 5. Upload | Home’s **Upload LA-ICP-MS session** opens UPbDB ingest (also UI drag-drop, or the command) | `session`, `acquisition` (matched to `physical_spot` by label), raw assets, sweep Parquet | "Reduce in UPbRPy Studio" |
| 6. Open from database | UPbRPy Studio in **database mode**: fetches the *session bundle* over HTTP and opens it as a project | local project cache with `.upbr` carrying its `origin` | |
| 7. Reduce | UPbRPy Studio, locally, exactly as standalone | `.upbr`, reduction bundle on disk | "Submit to database" |
| 8. Submit | Studio posts the *reduction bundle* | `reduction_run`, `selection_window`, `scalar_result` (+ uncertainties), derived sweep Parquet, attachments | run id back to Studio |
| 9. Results | UPbDB: results per acquisition, spot, grain, sample, session; preferred run per session; Table S1 | | shown in grainatlas's spot panel, UPb Lab's Home and Review tab (plots with clicks both ways to the images) |

Two guarantees shape every hand-off:

1. **Files are the boundary.** Every exchange is a documented bundle that
   also works as plain files: the session bundle, the atlas bundle, the
   reduction bundle. Database mode only moves those bundles over HTTP. A
   person without the database can hand the same files to someone with it.
2. **Standalone stays first class.** grainatlas and UPbRPy Studio work with
   no server and no sign-in; the database features are additive (an optional
   dependency extra in UPbRPy, a settings entry in grainatlas) and never on
   the standalone path.

## 2. Identities and names

- Every record has a UUIDv7 (`sample`, `mount`, `grain`, `physical_spot`,
  `session`, `acquisition`, `reduction_run`, grainatlas project and spot).
- **A spot name is the acquisition label.** grainatlas generates names from
  the pattern `{sample}-{grain}-{n}`; the laser operator uses them as the
  Qtegra labels; UPbDB matches `acquisition.label` to `physical_spot.label`
  within the mount on ingest. UPbRPy splits the sample from the label at
  `sep` (`_` today, configurable) so the pattern's separator between sample
  and the rest must be the session's `sep`; the session manifest carries it.
- **Reference materials** keep their library names (`NIST612`, `91500`, …)
  as spot names so UPbRPy's archive matching works unchanged.
- The session key (`Apatite_demo`) stays the human name; the UUID is the
  link.

## 3. The bundles

### 3.1 Atlas bundle (grainatlas → UPbDB), one per published project

```text
<project_id>.atlas/
  atlas.json          format "grainatlas-atlas", version 1, project id, name, mount_id,
                      opened-from (package, area, loose), scale (µm/px), areas, tile size,
                      pyramid levels, sha256 of every file below, grainatlas version
  pyramid/<area>/<z>/<x>_<y>.webp     the corrected mosaic as a tiled pyramid (lossless or q≥90)
  grains.geojson      grain outlines in mosaic µm, with grain labels and ids
  spots.json          the spot export document (same as POST /v1/mounts/{id}/spots)
  scalebars.json      per-grain scale bar choices
  project.json        the grainatlas project file (parameters, never pixels), for re-editing
```

UPbDB stores it as an attachment set of the mount (`object_type=mount`)
and serves it read-only at `/atlas/projects/<project_id>/…`. grainatlas,
hosted or standalone, opens a published project from a server URL and can
re-publish a new version (append-only; the mount keeps the latest as
current). The raw SEM package is **not** uploaded; it stays on lab storage,
and `atlas.json` records its content hash and its path on the NAS layout.

### 3.2 Session bundle (UPbDB → UPbRPy Studio)

`GET /v1/sessions/{id}/export/upbrpy` returns a zip of:

```text
<session_key>/
  raw/                      original Qtegra CSVs, original filenames, byte-identical
  session_manifest.toml     [session] id, key, instrument, method, operator, sep,
                            [samples] alias map, [reference_materials] plan,
                            [[acquisition]] label, acquisition_id, spot_id, grain_id,
                            sample_id, started_at, sha256, kind
  <session_key>.upbr        project: paths.source_directory.relative = "raw",
                            pipeline.config pre-filled from the method and RM plan,
                            origin { server, session_id, export_sha256, exported_at }
  README.md
```

Studio opens the folder as a project and keeps it in its cache
(`~/UPbRPy/sessions/<session_key>/`). The same zip is what a standalone user
receives by email from a database user, and Studio opens it identically.

### 3.3 Reduction bundle (UPbRPy Studio → UPbDB)

What `export_reduction_bundle` writes today, with `hash_inputs=True`:
`reduction_manifest.json` (software and Python version, platform, config,
input files with sha256, `reference_library_version`, `metadata.origin` echoing
the session bundle's origin), `selection_windows.csv`, `spot_mean_results.csv`,
`depth_profile_results.csv`, the publication workbook and CSVs, the replay
notebook, and the `.upbr`. Zipped and posted to
`POST /v1/sessions/{id}/runs/import` (multipart). The response carries the
`reduction_run` id, counts, and the quarantine report (unknown metrics go to
`pending_metric`, never dropped). Runs are append-only; a resubmission is a
new run that may name the one it supersedes.

## 4. Launching Studio from the database

1. On a session page, **Reduce in UPbRPy Studio** is the link
   `upbr://session/<session_id>?server=<base url>&code=<one-time code>`.
   The code comes from `POST /v1/auth/handoff` (signed-in user; 5-minute,
   single-use) and is exchanged by Studio at `POST /v1/auth/exchange` (which
   exists for the ORCID flow) for a bearer token stored in the OS keychain.
2. UPb Lab resolves `upbr://` to the installed Studio and launches it with
   `upbrpy-gui --open "upbr://…"`; a standalone UPbDB in a browser hands
   the same link to the OS, which opens Studio directly (scheme registered by
   Studio's own installer on macOS and Windows).
3. Studio fetches the session bundle, opens it, and shows the database
   origin in the title. Without a code or a stored token it asks the user to
   sign in (password, or ORCID through the system browser returning to
   `upbr://auth/callback?code=…`).
4. **Submit to database** posts the reduction bundle to the origin server and
   records the run id in the `.upbr`. **Mark as preferred** is done in
   UPbDB, or from Studio through `POST /v1/sessions/{id}/runs/{run}/prefer`.
5. Standalone users see the same two menu items disabled with a one-line
   explanation; nothing else differs.

## 4a. Opening the apps from UPb Lab

Decision of 2026-11-13: UPb Lab uploads and reviews; image, spot and grain
edits happen in standalone grainatlas, reductions and raw sweeps in UPbRPy
Studio, each opened in context and syncing to UPbDB. The shell still
links the pipeline and never reduces.

1. **Edit in grainatlas** (Review, with a spot selected; Home, on a mount
   card) launches grainatlas with `--project <atlas project> --server
   --code [--spot <atlas spot> | --grain <atlas grain>]`. grainatlas opens
   the mount signed in, as its own tab, and focuses the object; a project
   already open is switched to, not opened twice.
2. **Open in Studio** (Review; Home, on a session card) launches Studio with
   `upbr://run/<id>` or `upbr://session/<id>` plus `acquisition=<id>` and
   `via=upblab`. Studio opens at that analysis with its raw sweep shown; an
   open project is raised, not fetched again.
3. Coming back: the database is the channel. After a sync or publish,
   standalone grainatlas leaves `inbox/atlas-synced/<mount>.json` in UPb
   Lab's data folder; after a submit Studio leaves
   `inbox/run-submitted/<session>.json`. UPb Lab reads them every 5 s while
   visible and rereads the database. As a fallback it rereads the atlas
   revision and the session's runs on focus and every 60 s while visible,
   for each app it opened in the last two hours and for Review's current
   scope, refreshing Review and Home with the selection kept. After a
   submission from a `via=upblab` project Studio also opens
   `upbdb://run/<id>`, which shows that run in Review.
4. **Upload image set** (Home, or image folders dropped on the window)
   hands the paths to standalone grainatlas, which opens each as a mount
   tab; segmenting and publishing happen there (decision of 2026-11-14,
   which removed UPb Lab's Images tab).

5. **Laser log** (Home, or one `.lase` opened or dropped on the window)
   hands the file through `open-files` to UPbDB’s Laser logs upload form.
   The user checks lab and time zone before uploading. A new or duplicate
   upload opens the log’s tie dialog. Session cards open the session’s Laser
   section through the session page.

Arguments, links and notice files are specified in `docs/deep-links.md`
(Openers; Notices from the standalone apps).
Older apps ignore the additions and open the mount, session or run.

## 5. Results as attributes

- UPbDB stores every reduced quantity as `scalar_result` rows keyed by
  `(reduction_run, acquisition, metric)` with uncertainties, under the
  metric dictionary (`MetricDefinition`): ratios, dates, concentrations,
  Th/U, QC flags. Depth profiles are derived sweep Parquet.
- The **preferred run** of a session defines the values shown by default
  everywhere; any run remains inspectable.
- Read endpoints for the other apps:
  `GET /v1/acquisitions/{id}/results?run=preferred|<id>`,
  `GET /v1/sessions/{id}/results` (table, CSV or Arrow),
  `GET /v1/mounts/{id}/results` (per spot: preferred date and 2σ, key ratios,
  concentrations, flags; what grainatlas's spot panel shows), and
  `GET /v1/samples/{id}/results` across sessions.
- Table S1 and SESAR exports are generated from these rows.

## 6. Links

| Link | Resolves to |
| --- | --- |
| `upbdb://acquisition/<id>`, `session/<id>`, `sample/<id>`, `mount/<id>`, `search?label=` | Sessions tab routes |
| `upbdb://ingest?path=…` (desktop) | the ingest dialog with the folder prefilled |
| `grainatlas://project/<id>/spot/<id>` | standalone grainatlas on that project and spot (desktop); the hosted build in a new tab (web) |
| `upbr://session/<id>?server=&code=` | launch Studio in database mode |
| `upbr://run/<id>?server=` | Studio opens the project of that run from its cache or re-fetches the bundle |
| `upbr://session/<id>` or `run/<id>` with `&acquisition=<id>&via=upblab` | the same, at one analysis with its raw sweep (section 4a) |
| `upbdb://run/<id>` | UPb Lab Review on that run's session and run (Studio, after a submission) |

## 7. What each repository implements

| Repository | Work |
| --- | --- |
| UPbDB | session bundle export; reduction import; prefer; results read endpoints; handoff code; atlas bundle upload, storage and `/atlas/projects/` serving; mount page with the atlas view; UI ingest |
| grainatlas | publish and open atlas bundles; spot sync over the bridge token; results overlay in the spot panel; laser-stage registration and spot list export |
| UPbRPy | `upbr://` scheme and `--open` of URLs and `.upbr`; the `[database]` extra with the client; database mode in Studio (open, submit, prefer); `origin` in `.upbr` and the manifest; `hash_inputs=True`; `session_manifest.toml` support |
| UPb Lab | identity (phase 3) including the handoff code; `upbr://` launch; Home status of sessions and runs |

Dependencies: UPbDB's endpoints are specified here precisely enough for
the three clients to be built in parallel against them; integration is
tested end to end with the fixture session `Apatite_demo` (plan section 8
of UPbDB) and the grainatlas fixture mount.
