# Shell performance plan

## Completed startup and theme changes

In This computer mode, Home and Images no longer start PostgreSQL and the
database service automatically. Opening Sessions or Review starts them once.
An upload already routes through Sessions. Review destroys its plot instances
while hidden, retaining diagram and axis choices for when it is shown again.
Resize observers are disconnected while hidden. Explicit Stop and startup failures
remain stopped until the user chooses a manual start or retry. A regression
spec checks startup from both Home and Images and prevents duplicate starts
when switching database tabs.

Theme publication now sets the native main window theme as well as the shell
and hosted modules. This addresses the previously light title bar in dark
mode. Native compilation passed; a visual check of the native title bar is
still required.

Validation passed 237 UI unit tests, Svelte checks, 85 Rust tests (two existing
ignored tests), the UI build and 120 Chromium/WebKit browser tests. The
workspace bridge checks passed 33 tests and module-pinning checks passed 17. The
local grainatlas module was refreshed from the audited build for integration
checks. The resulting aggregate memory savings have not been measured in a
native This computer session.

Both newly preferred real-data runs passed live Chromium and WebKit checks:
activate a plotted result, open the linked image spot, click another image
spot and observe its matching Review selection. All 391 linked spots also
passed API result identity/value checks. Dense Concordia points overlap;
keyboard activation or the list gives exact selection. Native desktop
interaction and the native title bar still need a visual check.

## Remaining work

1. Define an explicit idle shutdown setting for the local database; do not
   stop it during a reduction or upload.
2. Add a backward-compatible bridge operation for releasing hidden module
   caches, with document preservation and restoration tests before webview
   destruction is considered.
3. Keep module creation lazy. Measure whether a shared WebKit process pool
   offers a real benefit without weakening isolation or file access rules.

The earlier Home baseline was about 96 MB and a 235–242 ms first window.
An empty Images module added about 260 MB. These are baseline measurements,
not measured outcomes of this change.

## UPb Lab measurement, 2026-11-06

The shell is now named UPb Lab and its repository is `upblab`. The executable,
app identifier and settings keys retain their existing `upbstudio` names. A fresh native Home check in
Lab server mode with no connected server measured 94.9 MiB physical footprint,
including the shell and its new WebKit GPU, Networking and WebContent helpers.
The short 20-second idle CPU sample was 0.05 percent. No local PostgreSQL or
service was launched by this measurement. Loaded Review and Images footprints
have not been remeasured inside the shell; the large Chromium image-project
measurement in grainatlas's notes is a separate browser workload.

The renamed shell passed 237 UI units, 33 bridge tests, 17 module-pinning
tests, 85 Rust tests (two existing ignored), 120 Chromium/WebKit checks,
Svelte checks, and the macOS app build. The new bundle's display name is
UPb Lab, its identifier remains `edu.umn.upbstudio`, and its ad hoc signature
passed verification. The Windows installer was not rebuilt on this Mac.

## Round 2 measurement, 2026-11-10

Release build of 82ceb97 on an M4 Pro (24 GB) with isolated settings,
`UPBSTUDIO_VAULT=memory` (no keychain), Lab server mode pointed at a copy of
the lab database served on a spare port. Physical footprint of the shell and
the WebKit helpers it started. No shell code changed in this round; ac55758
(Home pills) landed afterwards and was not measured separately.

| workload | 2026-11-06 | 2026-11-10 |
| --- | --- | --- |
| first window | 235-242 ms | 219-271 ms |
| Home, idle | 96 MB | 91-93 MB, idle CPU 0.0-0.05 % |
| Images and Sessions both created (Images waiting for its package, Sessions at sign-in) | Images alone +260 MB | 427 MB: shell 90, three WebContent 75 + 61 + 27, GPU 154 |
| Images with four apatite projects as tabs, all stitched (the grainatlas web build in Chromium, the same wasm workers the Images tab runs) | one project 3,990 MB (Demo_S_150X) | 1.45 GB after one tab, 2.5 GB after two, 4.5 GB after three, 6.7 GB after four; 6.69 GB after switching through every tab and area and 30 s idle |

The second row was reached without clicking: the shell started on Images with
a project path, then a second launch with a Qtegra CSV path was forwarded by
the single-instance plugin and opened Sessions.

The four-tab Images figure is the largest remaining cost of the shell. Each
grainatlas tab owns a wasm worker whose memory keeps its stitch high-water
mark (about 1.5-2.2 GB per apatite project) for as long as the tab exists;
freeing Rust buffers inside the worker does not return it. The grainatlas
desktop app now shares one image budget across tabs, but that cannot apply
to wasm workers. Options, all needing design: terminate the worker of a
hidden tab and rebuild it from the package and project when shown again
(30-66 s of re-stitching per tab today), stitch in a short-lived worker and
hand only the base pyramid to the tab's worker, or one worker shared by all
tabs. Item 2 of the remaining work above (releasing hidden modules' caches)
would not reach this memory.
