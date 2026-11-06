# The lab workflow and the hand-offs between the apps

**Status:** v1.1, 2026-11-06. This is the cross-repository contract for how a
sample travels through the four applications. Each repository's own plan
points here for the hand-offs and keeps its internal design to itself:
`laicpmsdb/docs/DATABASE_ARCHITECTURE_PLAN.md` section 8,
`grainatlas/ARCHITECTURE_PLAN.md` section 7, `UPbRPy/docs/lab_workflow_integration.md`,
and `ARCHITECTURE_PLAN.md` here (decision 10, phases 3 and 4). Change this
page first, bump the version line, then the app plans.

Changed in v1.1: results appear in the Review tab with plots linked both ways to Images.

## 1. The workflow

```text
 register samples ─> mount & polish ─> image (CL, BSE) ─> place spots ─> laser session
   laicpmsdb          laicpmsdb        grainatlas         grainatlas     instrument + Qtegra
                                                                              │
       results ◀── submit ◀── reduce locally ◀── open from database ◀── upload session
      laicpmsdb      UPbRPy Studio   UPbRPy Studio     UPbRPy Studio       laicpmsdb
         │
         └─ shown on the images (grainatlas), the timeline (laicpmsdb) and Home / Review (UPb Studio)
```

| Stage | Where | Record created | Hand-off out |
| --- | --- | --- | --- |
| 0. Register samples | laicpmsdb (SESAR/IGSN sheet import or form) | `sample` | sample names used in spot names |
| 1. Mount and polish | laicpmsdb mount page | `mount`, `mount_slot` (which sample sits where) | mount id |
| 2. Image | Home’s **Upload image set** opens the SEM package or `.grainatlas` project in grainatlas; stitch, correct, segment, scale | grainatlas project (local folder) **published** to laicpmsdb as an *atlas bundle* attached to the mount | `atlas://` project id; grain rows |
| 3. Place spots | grainatlas, with the mount's sample names | `physical_spot` rows in laicpmsdb (spot sync) with `atlas_project_id`, `atlas_spot_id` | laser spot list (registered to the laser stage) |
| 4. Laser session | instrument; Qtegra per-spot export with the spot name as the acquisition label | nothing yet | the export folder |
| 5. Upload | Home’s **Upload LA-ICP-MS session** opens laicpmsdb ingest (also UI drag-drop, or the command) | `session`, `acquisition` (matched to `physical_spot` by label), raw assets, sweep Parquet | "Reduce in UPbRPy Studio" |
| 6. Open from database | UPbRPy Studio in **database mode**: fetches the *session bundle* over HTTP and opens it as a project | local project cache with `.upbr` carrying its `origin` | |
| 7. Reduce | UPbRPy Studio, locally, exactly as standalone | `.upbr`, reduction bundle on disk | "Submit to database" |
| 8. Submit | Studio posts the *reduction bundle* | `reduction_run`, `selection_window`, `scalar_result` (+ uncertainties), derived sweep Parquet, attachments | run id back to Studio |
| 9. Results | laicpmsdb: results per acquisition, spot, grain, sample, session; preferred run per session; Table S1 | | shown in grainatlas's spot panel, UPb Studio's Home and Review tab (plots with clicks both ways to the images) |

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
  Qtegra labels; laicpmsdb matches `acquisition.label` to `physical_spot.label`
  within the mount on ingest. UPbRPy splits the sample from the label at
  `sep` (`_` today, configurable) so the pattern's separator between sample
  and the rest must be the session's `sep`; the session manifest carries it.
- **Reference materials** keep their library names (`NIST612`, `91500`, …)
  as spot names so UPbRPy's archive matching works unchanged.
- The session key (`Apatite_demo`) stays the human name; the UUID is the
  link.

## 3. The bundles

### 3.1 Atlas bundle (grainatlas → laicpmsdb), one per published project

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

laicpmsdb stores it as an attachment set of the mount (`object_type=mount`)
and serves it read-only at `/atlas/projects/<project_id>/…`. grainatlas,
hosted or standalone, opens a published project from a server URL and can
re-publish a new version (append-only; the mount keeps the latest as
current). The raw SEM package is **not** uploaded; it stays on lab storage,
and `atlas.json` records its content hash and its path on the NAS layout.

### 3.2 Session bundle (laicpmsdb → UPbRPy Studio)

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

### 3.3 Reduction bundle (UPbRPy Studio → laicpmsdb)

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
2. UPb Studio resolves `upbr://` to the installed Studio and launches it with
   `upbrpy-gui --open "upbr://…"`; a standalone laicpmsdb in a browser hands
   the same link to the OS, which opens Studio directly (scheme registered by
   Studio's own installer on macOS and Windows).
3. Studio fetches the session bundle, opens it, and shows the database
   origin in the title. Without a code or a stored token it asks the user to
   sign in (password, or ORCID through the system browser returning to
   `upbr://auth/callback?code=…`).
4. **Submit to database** posts the reduction bundle to the origin server and
   records the run id in the `.upbr`. **Mark as preferred** is done in
   laicpmsdb, or from Studio through `POST /v1/sessions/{id}/runs/{run}/prefer`.
5. Standalone users see the same two menu items disabled with a one-line
   explanation; nothing else differs.

## 5. Results as attributes

- laicpmsdb stores every reduced quantity as `scalar_result` rows keyed by
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
| `laicpmsdb://acquisition/<id>`, `session/<id>`, `sample/<id>`, `mount/<id>`, `search?label=` | Sessions tab routes |
| `laicpmsdb://ingest?path=…` (desktop) | the ingest dialog with the folder prefilled |
| `grainatlas://project/<id>/spot/<id>` | Images tab; the project from the recent list, else from `server/atlas/projects/<id>/` |
| `upbr://session/<id>?server=&code=` | launch Studio in database mode |
| `upbr://run/<id>?server=` | Studio opens the project of that run from its cache or re-fetches the bundle |

## 7. What each repository implements

| Repository | Work |
| --- | --- |
| laicpmsdb | session bundle export; reduction import; prefer; results read endpoints; handoff code; atlas bundle upload, storage and `/atlas/projects/` serving; mount page with the atlas view; UI ingest |
| grainatlas | publish and open atlas bundles; spot sync over the bridge token; results overlay in the spot panel; laser-stage registration and spot list export |
| UPbRPy | `upbr://` scheme and `--open` of URLs and `.upbr`; the `[database]` extra with the client; database mode in Studio (open, submit, prefer); `origin` in `.upbr` and the manifest; `hash_inputs=True`; `session_manifest.toml` support |
| UPb Studio | identity (phase 3) including the handoff code; `upbr://` launch; Home status of sessions and runs |

Dependencies: laicpmsdb's endpoints are specified here precisely enough for
the three clients to be built in parallel against them; integration is
tested end to end with the fixture session `Apatite_demo` (plan section 8
of laicpmsdb) and the grainatlas fixture mount.
