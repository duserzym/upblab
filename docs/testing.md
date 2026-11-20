# Testing and build times

Two tiers. Measured on the owner's 14-core Mac, 2026-11-13.

## Quick check, on every change: `make quick`

`scripts/quick-check.mjs` looks at the uncommitted and untracked files (or,
with `node scripts/quick-check.mjs --base origin/main`, everything since that
ref) and runs only what they can affect, side by side:

- vitest `related` for changed `ui/src` files, and svelte-check;
- the Playwright specs mapped to the changed area (`SPEC_MAP` in the script;
  an unmapped `ui/src` file runs `sizes.spec.ts`), Chromium only;
- bridge build and tests when `bridge/` changed, `cargo test` when
  `src-tauri/` changed, the script tests when `scripts/` changed;
- nothing for docs.

`--dry-run` prints the plan. Typical time: 15 to 30 s; one Review-area change
runs 84 Playwright tests in about 20 s.

The quick check says so, and asks for the full check, when a change touches
something it cannot judge from the area alone (`FULL_ONLY` in the script):
the bridge protocol, module hosting and the Rust host's bridge, modules,
files and local service code, settings/platform/identity carry-over, the
Playwright fake host and fixtures, and build or test configuration.

## Full check, before a build or install: `make check` (same as `make test`)

Everything: bridge build and tests, the 582 UI unit tests and svelte-check,
the script tests, the Rust tests and all Playwright specs in Chromium and
WebKit. Run it before building or installing, and after any change to the
bridge contract, module hosting, the viewer presentation (it must not write),
storage or settings carry-over, or anything that can write to UPbDB.
Those tests are never left out of the full check.

| Step | Before | After |
| --- | --- | --- |
| bridge build + 46 tests | 4.4 s | same |
| 582 vitest tests | 2.3 s | same |
| svelte-check | 8.1 s | same |
| web build (`vite build`) | 2.1 s | same |
| Rust tests, no change / one file / cold | 3 / 10 / 69 s | same |
| Playwright, 401 tests | 133 s | 60 s |
| `make check` with a warm Rust target | about 150 s | 74 s |

What made Playwright faster: a real bug (the Reduce tab re-ran its loading
effect in a loop, freezing the page for about 12 s in Chromium and costing the
theme spec 26 s per test), workers at 80 % of the cores instead of half, and a
controllable clock instead of a 5.1 s sleep in the updates spec. A production
preview server instead of the dev server was tried and was slower (78 s), and
some tests rely on development-port behaviour, so the dev server stays.
Playwright reuses a dev server already running on port 1431.

`pnpm docs-screenshots` writes invented-data PNGs to `docs/images/` in Light and Dark at 1440 × 900 and 1280 × 800; Images uses Review’s maximised SEM panel, and Sessions uses `../upbdb/ui/dist` (skipped if that build is absent).

What stays slow: the WebKit half of Playwright (about half the run) and the
Review and atlas-sync specs, which drive many real screens.

## Concordia performance benchmark

Run `CONCORDIA_PERF=1 pnpm --filter upbstudio-ui exec playwright test -c playwright.perf.config.ts`.
That config builds the UI and serves the production build on port 1432: the
dev server's Svelte development runtime (stack capture on every state write)
would dominate the frame times. The spec uses CSS locators for the same reason:
Playwright's label and role queries scan every spot button inside the page.
It is skipped in normal e2e runs. The fixture generates seeded, invented zircon
results for 800 and 2000 spots across five samples. Set `CONCORDIA_PERF_N=800,2000`
to override the counts (each must be at least 41). Both browser projects use
1440 × 900 and exercise Wetherill and Tera-Wasserburg diagrams.

For pan, wheel zoom, hover, tree selection, diagram switches and sample toggles,
the console table reports frame count, median, p95 and maximum frame interval
in ms, frames over 33 ms, and wall time. Selection also reports input-to-one-frame
latency; switches and toggles report input-to-two-frame latency (median and
maximum). Chromium adds long-task count/duration and CDP deltas for task,
script, layout and style duration in ms, plus layout and style counts. WebKit
omits those fields. Raw frame intervals and action latencies are saved alongside
the summaries in `ui/test-results/concordia-perf-<browser>.json`, keyed by spot
count, diagram and scenario. Wall times include Playwright input delivery and
frame waits; these are diagnostic measurements without pass/fail speed limits.

For before/after comparisons, append `--workers=1` so browser projects do not
compete, keep the same machine and browser versions, and copy the JSON files
outside `test-results` before the next run (Playwright clears that directory).
Run the same command after optimisation. The supervisor runs this benchmark;
it requires the Playwright browsers and permission to bind the dev-server port.

## Release build

| Step | Time |
| --- | --- |
| web build (`beforeBuildCommand`) | 2 s |
| Rust release, cold (fresh target) | 142 s |
| Rust release, one file changed | 77 s |
| bundling `.app` and `.dmg` | a few seconds |

Installs build each app in a fresh checkout. On the owner's request
(2026-11-14) local macOS release builds keep one shared Cargo target,
`~/Library/Caches/lab-builds/upblab-target`, set by `RELEASE_TARGET` in the
Makefile, so a fresh checkout reuses the compiled dependencies: about 65 s
saved per UPb Lab build, about 3 GB of disk kept between installs.

- `make build` writes the `.app` and `.dmg` under
  `~/Library/Caches/lab-builds/upblab-target/release/bundle/`. Copy the `.app`
  to `/Applications` and delete it there, as before.
- `make clean-build` (after a major update) keeps the shared target and prints
  its size; `make clean-release-cache` removes it, only when asked.
- `make build RELEASE_TARGET=` builds into `src-tauri/target` as before.
  GitHub Actions always does.
- Cargo locks the target, so two builds at once wait for each other instead
  of corrupting it.

`[profile.release]` uses thin LTO with 16 codegen units (owner's choice,
2026-11-14) instead of full LTO with one unit. With the kept target a
one-file rebuild drops from 77 s to 22 s; a cold build is unchanged (149 s);
the binary grows from 99.4 MB to 105.6 MB (6 %).

The grainatlas module is copied from grainatlas's own `ui/dist` by
`scripts/fetch-modules.mjs`; rebuilding that dist is grainatlas's step and is
needed only when its commit changed (`ui/public/modules/manifest.json`
records the commit it was copied from).

## Candidates for the owner to decide (not changed)

- `ui/tests/home.spec.ts` "screenshot home": saves a picture and asserts
  nothing; it could run only when `SCREENSHOTS_DIR` is set, as the updates
  screenshots do.
- `ui/tests/theme.spec.ts` walks every tab at three sizes in both schemes and
  both browsers, and `sizes.spec.ts` walks the same tabs at the same sizes.
  The theme walk checks theme delivery, the size walk checks fit; they overlap
  only in the overflow check.

## Offline mode checks

The focused host tests are `cargo test --manifest-path src-tauri/Cargo.toml
read_cache --jobs 1` and the same command with `local_sessions`. HTTP tests use
the auth fake-server helper and need permission to bind localhost; disk-only
cache and manifest tests do not. The UI modules have adjacent Vitest tests.
`ui/tests/offline.spec.ts` covers saved Home rows, retries, Settings, local
Studio opens and the Sessions/People note, with screenshots at 1440 × 900 and
1280 × 800 in each configured browser. The supervisor runs Playwright.

A comparison with the previous Home loader used 5000 invented sessions and
5000 invented mounts, 500 cards per inventory, and 1 ms mocked latency per
read. Before: 1502 reads, 149 ms. After: 62 reads, 8 ms, before idle prefetch.
The new loader bounds its detail scope to 20 sessions and 20 mounts; other
rows retain list summaries and show unavailable details. Lists request
`limit=500` and load another cursor page only on demand. Runtime logs include
Home read count/time and prefetch fetched/unchanged/failed counts and time.
These mocked timings do not measure a real server or disk-cache throughput.

## Oversight scope (ADR-0007 step 4)

`ui/tests/oversight.spec.ts` uses invented people and records with fake Tauri and
mocked `/v1/` routes. It covers combined narrowing filters, cursor paging and
owner labels, view-as with the caller's token, a persistent read-only banner,
disabled write controls, Exit, late replies from the previous scope, per-operation
on-behalf confirmation and header resend, and module oversight reads/events.
The layout cases cover 1280 × 800 and 1440 × 900 in light and dark; the supervisor
runs them in Chromium and WebKit.

The shell's `identity.get` scopes every data read. In-memory lists and Review
results clear when scope changes; persisted reads include the entire query
(including `as`) in their cache key. The web cache retains per-scope ETags and
clears on account, server and scope changes. Idle offline prefetch does not run
in view-as. Browser data transfers use a 4 s connection timeout and a 30 s stall
timeout that resets when bytes arrive, with no total transfer deadline.

Home uses the API's batched session and atlas summaries. Missing summaries stay
unavailable instead of triggering per-row detail requests. An explicit detail
refresh still reads that one object. Samples, projects and directories load one
500-row cursor page at a time and expose Show more or More controls.
List revalidation preserves richer run details from an explicit submission
refresh until the listed run count or preferred-run identity changes.

A local mocked comparison on 2026-11-18 supplied 3000 sessions and 3000 mounts,
returning the first 500 of each: the previous overview made 1502 reads in
5.49 ms; the new overview made 2 reads in 0.61 ms. These are local mock times,
not network latency, and exclude the existing idle offline-prefetch job.
`overview.test.ts` and `records.test.ts` retain large-list request-count checks.

Directory, sample and project pages use the same 60 s freshness window as Home.
Returning to Home keeps already loaded cursor pages; explicit Refresh bypasses
the window. Failed directories retain their diagnostic for the same window;
Retry bypasses it. Revalidation still goes through `identity.get`, retaining ETags and
`If-None-Match` in the desktop and web backends. Account, server or view-as changes
clear the list scope. `identity-web.test.ts` checks a directory's 304 response
preserves both its rows and next cursor.

The round 1 directory reactivation check supplies 3000 invented rows, returns
500 at a time and activates six Home lists twice. Without freshness caching it
makes 12 reads; with caching it makes 6. `records.test.ts` prints elapsed mock
times for both cases. Browser timing and Home → Review → Home request counts
remain for the supervisor's Playwright run. `incoming.test.ts` uses real
structured cloning to check oversight pushes on module load, change and reload.

Round 1 retains summary-only Home reads. The `home-sections.spec.ts:134` atlas
filter and `openers.spec.ts:115`, `:132`, `:194` and `:331` keep their behavior
assertions; their shared fixtures now include the server's atlas and preferred-run
list summaries. Fresh reduction-session fixtures explicitly have no preferred
run. `home.spec.ts:105` now expects one list-provided thumbnail instead of a
two-area manifest preview; `:174` waits for that one tile's failed response.
The thumbnail fixture uses the pyramid URL returned by the list contract.
`openers.spec.ts:177` keeps its version assertion and exercises the app fix that
retains the submitted version when Home loads. Size, refresh-speed and oversight
expectations are unchanged. The supervisor verifies these with Playwright.
