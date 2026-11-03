// Module pinning test (plan section 6): fetched builds must match the lock.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { fetchModules, sha256, treeHash } from './fetch-modules.mjs';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-modules-test-'));
  const build = path.join(dir, 'build', 'dist');
  fs.mkdirSync(path.join(build, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(build, 'index.html'), '<!doctype html><title>atlas</title>');
  fs.writeFileSync(path.join(build, 'assets', 'app.js'), 'console.log(1)');
  const archive = path.join(dir, 'grainatlas-web-1.2.3.tar.gz');
  const r = spawnSync('tar', ['-czf', archive, '-C', path.join(dir, 'build'), 'dist']);
  assert.equal(r.status, 0, r.stderr?.toString());
  return { dir, build, archive, out: path.join(dir, 'out') };
}

function writeLock(dir, modules) {
  const lock = path.join(dir, 'modules.lock.json');
  fs.writeFileSync(lock, JSON.stringify({ lockVersion: 1, modules }));
  return lock;
}

const quiet = { log: () => {} };

test('installs a release whose hash matches and records it in the manifest', async () => {
  const f = fixture();
  const hash = sha256(fs.readFileSync(f.archive));
  const lock = writeLock(f.dir, [
    { name: 'grainatlas', version: '1.2.3', url: pathToFileURL(f.archive).href, sha256: hash, local: 'build/dist' },
  ]);
  const { modules } = await fetchModules({ lock, out: f.out, ...quiet });
  assert.equal(modules[0].source, 'release');
  assert.equal(fs.readFileSync(path.join(f.out, 'grainatlas', 'assets', 'app.js'), 'utf8'), 'console.log(1)');
  const manifest = JSON.parse(fs.readFileSync(path.join(f.out, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.modules.map((m) => [m.name, m.version, m.sha256]), [['grainatlas', '1.2.3', hash]]);
});

test('refuses a release whose hash does not match and leaves the old install alone', async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.out, 'grainatlas'), { recursive: true });
  fs.writeFileSync(path.join(f.out, 'grainatlas', 'index.html'), 'previous');
  const lock = writeLock(f.dir, [
    { name: 'grainatlas', version: '1.2.3', url: pathToFileURL(f.archive).href, sha256: '0'.repeat(64) },
  ]);
  await assert.rejects(fetchModules({ lock, out: f.out, ...quiet }), /SHA-256 mismatch/);
  assert.equal(fs.readFileSync(path.join(f.out, 'grainatlas', 'index.html'), 'utf8'), 'previous');
});

test('a url without a sha256 is an error', async () => {
  const f = fixture();
  const lock = writeLock(f.dir, [{ name: 'grainatlas', version: '1', url: pathToFileURL(f.archive).href, sha256: null }]);
  await assert.rejects(fetchModules({ lock, out: f.out, ...quiet }), /needs a 64-hex-digit sha256/);
});

test('copies a local development build and records its tree hash', async () => {
  const f = fixture();
  const lock = writeLock(f.dir, [{ name: 'grainatlas', version: '0.0.0-dev', url: null, sha256: null, local: 'build/dist' }]);
  const { modules } = await fetchModules({ lock, out: f.out, ...quiet });
  assert.equal(modules[0].source, 'local');
  assert.equal(modules[0].sha256, treeHash(f.build));
  assert.ok(fs.existsSync(path.join(f.out, 'grainatlas', 'index.html')));
});

test('--prefer local uses the local build even when a release is pinned', async () => {
  const f = fixture();
  const lock = writeLock(f.dir, [
    { name: 'grainatlas', version: '1', url: 'https://example.invalid/x.tar.gz', sha256: 'a'.repeat(64), local: 'build/dist' },
  ]);
  const { modules } = await fetchModules({ lock, out: f.out, prefer: 'local', ...quiet });
  assert.equal(modules[0].source, 'local');
});

test('a missing local build is skipped, or fatal with strict', async () => {
  const f = fixture();
  const lock = writeLock(f.dir, [{ name: 'grainatlas', version: '0', url: null, sha256: null, local: 'nowhere' }]);
  const { modules, skipped } = await fetchModules({ lock, out: f.out, ...quiet });
  assert.deepEqual([modules.length, skipped], [0, ['grainatlas']]);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.out, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.modules, []);
  await assert.rejects(fetchModules({ lock, out: f.out, strict: true, ...quiet }), /no local build/);
});

test('rejects module names that could escape the output folder', async () => {
  const f = fixture();
  const lock = writeLock(f.dir, [{ name: '../evil', version: '0', local: 'build/dist' }]);
  await assert.rejects(fetchModules({ lock, out: f.out, ...quiet }), /invalid module name/);
});

test('tree hash ignores file order and platform separators', () => {
  const f = fixture();
  const copy = path.join(f.dir, 'copy');
  fs.cpSync(f.build, copy, { recursive: true });
  assert.equal(treeHash(copy), treeHash(f.build));
  fs.writeFileSync(path.join(copy, 'assets', 'app.js'), 'changed');
  assert.notEqual(treeHash(copy), treeHash(f.build));
});
