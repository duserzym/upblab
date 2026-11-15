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

What stays slow: the WebKit half of Playwright (about half the run) and the
Review and atlas-sync specs, which drive many real screens.

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
