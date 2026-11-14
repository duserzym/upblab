#!/usr/bin/env node
// Quick check (`make quick`): run only the tests the changed files can affect,
// in parallel, Playwright in Chromium only. Meant for every small change; the
// full check (`make check`) runs everything before a build or a risky change.
//
// Changed files: uncommitted changes plus untracked files, or, with
// `--base <ref>`, everything that differs from that ref (e.g. origin/main).
// `--dry-run` prints the plan without running it.
//
// Changes the quick check refuses to cover (it says so and suggests the full
// check): the bridge protocol, module hosting and the Rust host, storage and
// settings carry-over, the Playwright fake host, and build or config files.

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
const base = baseIndex >= 0 ? args[baseIndex + 1] : null;
const dryRun = args.includes('--dry-run');

/** Source areas and the Playwright specs that exercise them. First match wins per file. */
export const SPEC_MAP = [
  [/^ui\/src\/(routes\/Review|components\/review\/|components\/ReviewDock|lib\/(review|plot|geochem|concordia|sample-filter|contained-popover|contain))/, ['review.spec.ts', 'layout.spec.ts', 'openers.spec.ts']],
  [/^ui\/src\/(routes\/Home|components\/home\/|lib\/(home|overview))/, ['home.spec.ts', 'home-sections.spec.ts']],
  [/^ui\/src\/(routes\/Images|components\/(ModuleSurface|Atlas)|lib\/(atlas-|incoming|presentation|spot-actions))/, ['atlas-sync.spec.ts', 'openers.spec.ts']],
  [/^ui\/src\/(routes\/Reduce|components\/StudioGuidance|lib\/(apps|app-watch|reduce-status|shell|links|opener))/, ['openers.spec.ts']],
  [/^ui\/src\/(routes\/Settings|lib\/theme|tokens\.css|app\.css)/, ['theme.spec.ts', 'sizes.spec.ts']],
  [/^ui\/src\/(components\/(UpdatesPanel|CheckUpdatesButton)|lib\/(updater|updates|versions))/, ['updates.spec.ts', 'check-updates.spec.ts']],
  [/^ui\/src\/(routes\/Account|components\/AccountDialog|lib\/(people|identity))/, ['people-tab.spec.ts', 'sizes.spec.ts']],
  [/^ui\/src\/(components\/UploadCard|lib\/(upload|drop|wizard))/, ['upload.spec.ts']],
  [/^ui\/src\/(components\/(LocalStatusPanel|FirstRun)|lib\/(localService|server-url))/, ['local-startup.spec.ts']],
  [/^ui\/src\/lib\/overlays/, ['overlap.spec.ts']],
  // Anything else under ui/src: the screen-size walk covers every tab.
  [/^ui\/src\//, ['sizes.spec.ts']],
];

/** Changes that need the full check: contracts, hosting, storage, test harness, build config. */
export const FULL_ONLY = [
  /^bridge\/src\/protocol\.ts$/,
  /^src-tauri\/(src\/(bridge|modules|files|local_service)|tauri\.conf|capabilities)/,
  /^ui\/src\/lib\/(settings|platform|identity)\.svelte\.ts$|^ui\/src\/lib\/(settings|platform)\.ts$/,
  /^ui\/tests\/(fake-tauri|review-helpers|problems)\.ts$|^ui\/tests\/fixtures\//,
  /^(ui\/)?(package\.json|pnpm-lock\.yaml|vite\.config\.ts|playwright\.config\.ts|tsconfig\.json)$/,
  /^modules\.lock\.json$|^scripts\/fetch-modules/,
];

export function plan(files) {
  const specs = new Set(), related = [], notes = [];
  let svelteCheck = false, bridge = false, scripts = false, rust = false;
  const full = files.filter(f => FULL_ONLY.some(re => re.test(f)));
  for (const f of files) {
    if (/^ui\/tests\/.*\.spec\.ts$/.test(f)) specs.add(path.basename(f));
    if (/^ui\/src\/.*\.(ts|svelte)$/.test(f)) { related.push(f.slice(3)); svelteCheck = true; }
    if (/^ui\/src\//.test(f)) { const hit = SPEC_MAP.find(([re]) => re.test(f)); if (hit) hit[1].forEach(s => specs.add(s)); }
    if (/^bridge\//.test(f)) bridge = true;
    if (/^scripts\//.test(f)) scripts = true;
    if (/^src-tauri\/(src|Cargo)/.test(f)) rust = true;
  }
  if (bridge) { svelteCheck = true; notes.push('bridge changed: bridge tests and svelte-check run'); }
  return { specs: [...specs].sort(), related, svelteCheck, bridge, scripts, rust, full };
}

function changedFiles() {
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const files = base
    ? git('diff', '--name-only', `${base}...HEAD`).concat(git('diff', '--name-only', 'HEAD'))
    : git('diff', '--name-only', 'HEAD');
  return [...new Set(files.concat(git('ls-files', '--others', '--exclude-standard')))].sort();
}

function run(label, cmd, cmdArgs, cwd) {
  return new Promise(resolve => {
    const start = Date.now();
    const child = spawn(cmd, cmdArgs, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => {
      const secs = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`${code === 0 ? 'ok  ' : 'FAIL'} ${label} (${secs} s)`);
      if (code !== 0) console.log(out.split('\n').slice(-40).join('\n'));
      resolve(code === 0);
    });
  });
}

async function main() {
  const files = changedFiles();
  const p = plan(files);
  console.log(`Quick check: ${files.length} changed file(s)${base ? ` since ${base}` : ''}.`);
  if (p.full.length) {
    console.log(`These changes need the full check (make check): ${p.full.join(', ')}`);
  }
  const jobs = [];
  const ui = path.join(root, 'ui');
  if (p.related.length) jobs.push(['vitest (related)', 'pnpm', ['exec', 'vitest', 'related', '--run', '--passWithNoTests', ...p.related], ui]);
  if (p.svelteCheck) jobs.push(['svelte-check', 'pnpm', ['exec', 'svelte-check', '--tsconfig', './tsconfig.json', '--threshold', 'error'], ui]);
  if (p.bridge) jobs.push(['bridge build + tests', 'sh', ['-c', 'pnpm --filter @lab/bridge build && pnpm --filter @lab/bridge test'], root]);
  if (p.scripts) jobs.push(['scripts tests', 'sh', ['-c', 'node --test scripts/*.test.mjs'], root]);
  if (p.rust) jobs.push(['cargo test', 'cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml'], root]);
  const playwright = p.specs.length
    ? ['playwright (chromium)', 'pnpm', ['exec', 'playwright', 'test', '--project=chromium', '--reporter=dot', ...p.specs.map(s => `tests/${s}`)], ui]
    : null;
  for (const [label, cmd, a] of [...jobs, ...(playwright ? [playwright] : [])]) console.log(`  ${label}: ${cmd} ${a.join(' ')}`);
  if (!jobs.length && !playwright) { console.log('Nothing to test for these files.'); return; }
  if (dryRun) return;
  const start = Date.now();
  // Unit checks and Playwright run side by side; Playwright reuses one dev server.
  const results = await Promise.all([...jobs, ...(playwright ? [playwright] : [])].map(([l, c, a, d]) => run(l, c, a, d)));
  console.log(`Quick check ${results.every(Boolean) ? 'passed' : 'FAILED'} in ${((Date.now() - start) / 1000).toFixed(1)} s.`);
  if (p.full.length) console.log('Run the full check (make check) before building or installing.');
  process.exitCode = results.every(Boolean) ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
