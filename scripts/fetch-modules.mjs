#!/usr/bin/env node
// Install the module builds pinned in modules.lock.json into
// ui/public/modules/<name>/ and write ui/public/modules/manifest.json, which
// the shell reads to decide what the Images tab can show.
//
// Per web module:
//   url + sha256   download the release archive (.tar.gz, .tgz or .zip),
//                  verify its SHA-256 against the lock, extract it
//   local          copy a development build (path relative to the lock file)
//                  and record a tree hash; used when there is no url yet, or
//                  with --prefer local. When the build lies in a git checkout,
//                  its HEAD commit and whether the checkout had uncommitted
//                  changes are recorded too (`commit`, `dirty`).
//
// Per service (`"kind": "service"`, the laicpmsdb service bundle of ADR-0003):
//   platforms.<platform>.url + sha256
//                  download the archive for the build platform (macos-arm64,
//                  windows-x64), verify it, and unpack it into `out` (relative
//                  to the lock file; its README.md is kept). Without a url for
//                  the platform, `out` is emptied and the build is "Lab server
//                  only"; `local` is never copied (development builds run it
//                  in place, see docs/service-bundle-contract.md section 7).
//
// Usage: node scripts/fetch-modules.mjs [--prefer local|release] [--strict] [--platform macos-arm64]
//                                       [--lock modules.lock.json] [--out ui/public/modules]
// Without --strict a module whose source is missing is skipped with a warning,
// so a fresh clone (and CI) still builds; the Images tab then shows its placeholder.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const NAME = /^[a-z][a-z0-9-]{0,63}$/;

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/** Hash of a directory: sorted `path\0sha256(content)\n` lines, independent of OS and mtimes. */
export function treeHash(dir) {
  const h = createHash('sha256');
  for (const rel of walk(dir).sort()) h.update(`${rel}\0${sha256(fs.readFileSync(path.join(dir, rel)))}\n`);
  return h.digest('hex');
}

async function download(url) {
  const u = new URL(url);
  if (u.protocol === 'file:') return fs.readFileSync(fileURLToPath(u));
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`unsupported URL ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** bsdtar: on Windows the System32 one, not a GNU tar from Git that reads `C:` as a host name. */
export function tarCommand() {
  if (process.platform !== 'win32') return 'tar';
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
}

function extract(archive, dest) {
  // bsdtar ships with macOS and Windows 10+, and reads .tar.gz and .zip alike.
  // It refuses absolute paths and `..` members unless -P is given.
  const r = spawnSync(tarCommand(), ['-xf', archive, '-C', dest], { stdio: 'pipe' });
  if (r.status !== 0) throw new Error(`tar failed: ${r.stderr?.toString() || r.error}`);
  // Archives made with a top-level folder: lift its contents.
  const entries = fs.readdirSync(dest);
  if (entries.length === 1 && fs.statSync(path.join(dest, entries[0])).isDirectory()) {
    const inner = path.join(dest, entries[0]);
    for (const e of fs.readdirSync(inner)) fs.renameSync(path.join(inner, e), path.join(dest, e));
    fs.rmdirSync(inner);
  }
}

function replaceDir(staged, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(staged, target);
}

/** The build machine as named in the lock's `platforms`. */
export function currentPlatform(platform = process.platform, arch = process.arch) {
  const os = { darwin: 'macos', win32: 'windows', linux: 'linux' }[platform] ?? platform;
  return `${os}-${arch === 'x64' ? 'x64' : arch}`;
}

/** Remove everything in `dir` except a README.md. */
function emptyKeepingReadme(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const e of fs.readdirSync(dir)) {
    if (e !== 'README.md') fs.rmSync(path.join(dir, e), { recursive: true, force: true });
  }
}

const SERVICE_PYTHON = ['python/bin/python3', 'python/python.exe'];

async function fetchService(m, { lockDir, platform, strict, log }) {
  if (typeof m.out !== 'string' || !m.out) throw new Error(`${m.name}: a service needs an "out" folder in the lock`);
  const out = path.resolve(lockDir, m.out);
  const pin = m.platforms?.[platform] ?? {};
  const hasRelease = typeof pin.url === 'string' && pin.url.length > 0;
  if (!hasRelease) {
    const msg = `${m.name}: no release for ${platform} in the lock`;
    if (strict) throw new Error(msg);
    emptyKeepingReadme(out);
    log(`skip  ${msg}; this build offers Lab server mode only${m.local ? ` (development builds run ${m.local})` : ''}`);
    return null;
  }
  if (!/^[0-9a-f]{64}$/.test(pin.sha256 ?? '')) throw new Error(`${m.name}: ${platform} url needs a 64-hex-digit sha256 in the lock`);
  const data = await download(pin.url);
  const got = sha256(data);
  if (got !== pin.sha256) throw new Error(`${m.name}: SHA-256 mismatch for ${pin.url}\n  lock ${pin.sha256}\n  got  ${got}`);
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), `upbstudio-${m.name}-`));
  try {
    const archive = `${staged}${/\.zip($|\?)/i.test(pin.url) ? '.zip' : '.tar.gz'}`;
    fs.writeFileSync(archive, data);
    try {
      extract(archive, staged);
    } finally {
      fs.rmSync(archive, { force: true });
    }
    const version = fs.existsSync(path.join(staged, 'VERSION')) ? fs.readFileSync(path.join(staged, 'VERSION'), 'utf8').trim() : '';
    if (!version) throw new Error(`${m.name}: the archive has no VERSION file (contract section 1)`);
    if (!SERVICE_PYTHON.some((p) => fs.existsSync(path.join(staged, p)))) {
      throw new Error(`${m.name}: the archive has no ${SERVICE_PYTHON.join(' or ')} (contract section 1)`);
    }
    emptyKeepingReadme(out);
    for (const e of fs.readdirSync(staged)) {
      if (e !== 'README.md') fs.renameSync(path.join(staged, e), path.join(out, e));
    }
    log(`ok    ${m.name} ${version} for ${platform} (release, sha256 ${got.slice(0, 12)}…) -> ${path.relative(lockDir, out)}`);
    return { name: m.name, version, platform, source: 'release', sha256: got, hashKind: 'archive', from: pin.url };
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
}

/** HEAD commit of the git checkout holding `dir`, and whether it has uncommitted changes; {} outside git. */
export function gitState(dir) {
  const head = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { stdio: 'pipe', encoding: 'utf8' });
  if (head.status !== 0 || !/^[0-9a-f]{40}$/.test(head.stdout.trim())) return {};
  const status = spawnSync('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=no'], { stdio: 'pipe', encoding: 'utf8' });
  return { commit: head.stdout.trim(), dirty: status.status === 0 ? status.stdout.trim().length > 0 : null };
}

/**
 * @param {{ lock?: string, out?: string, prefer?: 'local'|'release', strict?: boolean, platform?: string, log?: (m: string) => void }} opts
 * @returns {Promise<{ modules: object[], services: object[], skipped: string[] }>}
 */
export async function fetchModules(opts = {}) {
  const lockPath = path.resolve(opts.lock ?? path.join(root, 'modules.lock.json'));
  const out = path.resolve(opts.out ?? path.join(root, 'ui', 'public', 'modules'));
  const log = opts.log ?? ((m) => console.log(m));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (lock.lockVersion !== 1) throw new Error(`${lockPath}: unsupported lockVersion ${lock.lockVersion}`);
  const lockDir = path.dirname(lockPath);
  fs.mkdirSync(out, { recursive: true });

  const installed = [];
  const services = [];
  const skipped = [];
  const platform = opts.platform ?? currentPlatform();
  for (const m of lock.modules ?? []) {
    if (!NAME.test(m.name ?? '')) throw new Error(`invalid module name ${JSON.stringify(m.name)}`);
    if (m.kind === 'service') {
      const record = await fetchService(m, { lockDir, platform, strict: opts.strict, log });
      if (record) services.push(record);
      else skipped.push(m.name);
      continue;
    }
    const target = path.join(out, m.name);
    const entry = m.entry ?? 'index.html';
    const hasRelease = typeof m.url === 'string' && m.url.length > 0;
    if (hasRelease && !/^[0-9a-f]{64}$/.test(m.sha256 ?? '')) {
      throw new Error(`${m.name}: a url needs a 64-hex-digit sha256 in the lock`);
    }
    const useLocal = m.local && (!hasRelease || opts.prefer === 'local');
    const staged = fs.mkdtempSync(path.join(os.tmpdir(), `upbstudio-${m.name}-`));
    try {
      let record;
      if (useLocal) {
        const src = path.resolve(lockDir, m.local);
        if (!fs.existsSync(path.join(src, entry))) {
          const msg = `${m.name}: no local build at ${src} (missing ${entry})`;
          if (opts.strict) throw new Error(msg);
          log(`skip  ${msg}; the shell will show its placeholder`);
          skipped.push(m.name);
          fs.rmSync(target, { recursive: true, force: true });
          continue;
        }
        fs.cpSync(src, staged, { recursive: true });
        record = { source: 'local', sha256: treeHash(staged), hashKind: 'tree', from: m.local, ...gitState(src) };
      } else if (hasRelease) {
        const data = await download(m.url);
        const got = sha256(data);
        if (got !== m.sha256) {
          throw new Error(`${m.name}: SHA-256 mismatch for ${m.url}\n  lock ${m.sha256}\n  got  ${got}`);
        }
        const ext = /\.zip($|\?)/i.test(m.url) ? '.zip' : '.tar.gz';
        const archive = `${staged}${ext}`; // beside the staging folder, not in it
        fs.writeFileSync(archive, data);
        try {
          extract(archive, staged);
        } finally {
          fs.rmSync(archive, { force: true });
        }
        if (!fs.existsSync(path.join(staged, entry))) throw new Error(`${m.name}: release has no ${entry}`);
        record = { source: 'release', sha256: got, hashKind: 'archive', from: m.url };
      } else {
        const msg = `${m.name}: neither url nor local in the lock`;
        if (opts.strict) throw new Error(msg);
        log(`skip  ${msg}`);
        skipped.push(m.name);
        continue;
      }
      replaceDir(staged, target);
      installed.push({ name: m.name, version: String(m.version ?? '0.0.0'), entry, ...record });
      const at = record.commit ? `, ${record.commit.slice(0, 7)}${record.dirty ? ' with uncommitted changes' : ''}` : '';
      log(`ok    ${m.name} ${m.version} (${record.source}${at}, sha256 ${record.sha256.slice(0, 12)}…)`);
    } finally {
      fs.rmSync(staged, { recursive: true, force: true });
    }
  }

  const manifest = { generatedBy: 'scripts/fetch-modules.mjs', lockVersion: 1, modules: installed };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { modules: installed, services, skipped };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') opts.strict = true;
    else if (a === '--prefer') opts.prefer = argv[++i];
    else if (a === '--lock') opts.lock = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--platform') opts.platform = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('usage: fetch-modules.mjs [--prefer local|release] [--strict] [--platform macos-arm64|windows-x64] [--lock file] [--out dir]');
      process.exit(0);
    } else throw new Error(`unknown argument ${a}`);
  }
  if (opts.prefer && !['local', 'release'].includes(opts.prefer)) throw new Error('--prefer is local or release');
  return opts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  fetchModules(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(`fetch-modules: ${err.message}`);
    process.exit(1);
  });
}
