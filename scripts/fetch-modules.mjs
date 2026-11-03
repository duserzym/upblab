#!/usr/bin/env node
// Install the module builds pinned in modules.lock.json into
// ui/public/modules/<name>/ and write ui/public/modules/manifest.json, which
// the shell reads to decide what the Images tab can show.
//
// Per module:
//   url + sha256   download the release archive (.tar.gz, .tgz or .zip),
//                  verify its SHA-256 against the lock, extract it
//   local          copy a development build (path relative to the lock file)
//                  and record a tree hash; used when there is no url yet, or
//                  with --prefer local
//
// Usage: node scripts/fetch-modules.mjs [--prefer local|release] [--strict]
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

function extract(archive, dest) {
  // bsdtar ships with macOS and Windows 10+, and reads .tar.gz and .zip alike.
  // It refuses absolute paths and `..` members unless -P is given.
  const r = spawnSync('tar', ['-xf', archive, '-C', dest], { stdio: 'pipe' });
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

/**
 * @param {{ lock?: string, out?: string, prefer?: 'local'|'release', strict?: boolean, log?: (m: string) => void }} opts
 * @returns {Promise<{ modules: object[], skipped: string[] }>}
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
  const skipped = [];
  for (const m of lock.modules ?? []) {
    if (!NAME.test(m.name ?? '')) throw new Error(`invalid module name ${JSON.stringify(m.name)}`);
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
        record = { source: 'local', sha256: treeHash(staged), hashKind: 'tree', from: m.local };
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
      log(`ok    ${m.name} ${m.version} (${record.source}, sha256 ${record.sha256.slice(0, 12)}…)`);
    } finally {
      fs.rmSync(staged, { recursive: true, force: true });
    }
  }

  const manifest = { generatedBy: 'scripts/fetch-modules.mjs', lockVersion: 1, modules: installed };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { modules: installed, skipped };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') opts.strict = true;
    else if (a === '--prefer') opts.prefer = argv[++i];
    else if (a === '--lock') opts.lock = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('usage: fetch-modules.mjs [--prefer local|release] [--strict] [--lock file] [--out dir]');
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
