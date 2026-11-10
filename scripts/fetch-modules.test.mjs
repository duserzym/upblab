// Module pinning test (plan section 6): fetched builds must match the lock.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { currentPlatform, fetchModules, sha256, tarCommand, treeHash } from './fetch-modules.mjs';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-modules-test-'));
  const build = path.join(dir, 'build', 'dist');
  fs.mkdirSync(path.join(build, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(build, 'index.html'), '<!doctype html><title>atlas</title>');
  fs.writeFileSync(path.join(build, 'assets', 'app.js'), 'console.log(1)');
  const archive = path.join(dir, 'grainatlas-web-1.2.3.tar.gz');
  const r = spawnSync(tarCommand(), ['-czf', archive, '-C', path.join(dir, 'build'), 'dist']);
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
  assert.equal(modules[0].commit, undefined); // the fixture is not in a git checkout
});

test('a local build in a git checkout records its commit and whether it was dirty', async () => {
  const f = fixture();
  const git = (...args) => {
    const r = spawnSync('git', ['-C', f.dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q');
  git('add', 'build');
  git('commit', '-q', '-m', 'build');
  const head = git('rev-parse', 'HEAD');
  const lock = writeLock(f.dir, [{ name: 'grainatlas', version: '0.0.0-dev', url: null, sha256: null, local: 'build/dist' }]);
  git('add', 'modules.lock.json');
  git('commit', '-q', '-m', 'lock');
  const clean = (await fetchModules({ lock, out: f.out, ...quiet })).modules[0];
  assert.equal(clean.commit, git('rev-parse', 'HEAD'));
  assert.notEqual(clean.commit, head);
  assert.equal(clean.dirty, false);
  fs.writeFileSync(path.join(f.build, 'index.html'), '<!doctype html><title>edited</title>');
  const dirty = (await fetchModules({ lock, out: f.out, ...quiet })).modules[0];
  assert.equal(dirty.dirty, true);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.modules[0].commit, clean.commit);
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

// The laicpmsdb service bundle (docs/service-bundle-contract.md section 5).
function serviceFixture({ version = '0.4.0', python = 'python/bin/python3' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-service-test-'));
  const bundle = path.join(dir, 'build', 'laicpmsdb-service');
  fs.mkdirSync(path.join(bundle, path.dirname(python)), { recursive: true });
  fs.writeFileSync(path.join(bundle, python), '#!/bin/sh\n');
  if (version !== null) fs.writeFileSync(path.join(bundle, 'VERSION'), `${version}\n`);
  const archive = path.join(dir, `laicpmsdb-service-${version}-macos-arm64.tar.gz`);
  const r = spawnSync(tarCommand(), ['-czf', archive, '-C', path.join(dir, 'build'), 'laicpmsdb-service']);
  assert.equal(r.status, 0, r.stderr?.toString());
  const out = path.join(dir, 'resources', 'laicpmsdb-service');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'README.md'), 'kept');
  return { dir, archive, out };
}

function serviceEntry(f, pin) {
  return {
    name: 'laicpmsdb-service',
    kind: 'service',
    version: '0.4.0',
    platforms: { 'macos-arm64': pin, 'windows-x64': { url: null, sha256: null } },
    local: '../laicpmsdb',
    out: 'resources/laicpmsdb-service',
  };
}

test('names the build platform like the lock does', () => {
  assert.equal(currentPlatform('darwin', 'arm64'), 'macos-arm64');
  assert.equal(currentPlatform('win32', 'x64'), 'windows-x64');
});

test('unpacks the service bundle for the platform, keeping the README', async () => {
  const f = serviceFixture();
  const pin = { url: pathToFileURL(f.archive).href, sha256: sha256(fs.readFileSync(f.archive)) };
  const lock = writeLock(f.dir, [serviceEntry(f, pin)]);
  const r = await fetchModules({ lock, out: path.join(f.dir, 'web'), platform: 'macos-arm64', ...quiet });
  assert.deepEqual(r.services.map((s) => [s.name, s.version, s.platform]), [['laicpmsdb-service', '0.4.0', 'macos-arm64']]);
  assert.equal(fs.readFileSync(path.join(f.out, 'VERSION'), 'utf8').trim(), '0.4.0');
  assert.ok(fs.existsSync(path.join(f.out, 'python', 'bin', 'python3')));
  assert.equal(fs.readFileSync(path.join(f.out, 'README.md'), 'utf8'), 'kept');
  // Services are not web modules: the shell page's manifest does not list them.
  const manifest = JSON.parse(fs.readFileSync(path.join(f.dir, 'web', 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.modules, []);
});

test('without a release for the platform the bundle folder is emptied (Lab server only)', async () => {
  const f = serviceFixture();
  fs.writeFileSync(path.join(f.out, 'VERSION'), 'stale');
  const lock = writeLock(f.dir, [serviceEntry(f, { url: null, sha256: null })]);
  const r = await fetchModules({ lock, out: path.join(f.dir, 'web'), platform: 'windows-x64', ...quiet });
  assert.deepEqual(r.skipped, ['laicpmsdb-service']);
  assert.deepEqual(fs.readdirSync(f.out), ['README.md']);
  await assert.rejects(fetchModules({ lock, out: path.join(f.dir, 'web'), platform: 'windows-x64', strict: true, ...quiet }), /no release for windows-x64/);
});

test('refuses a service archive with a wrong hash or without VERSION', async () => {
  const f = serviceFixture();
  const bad = writeLock(f.dir, [serviceEntry(f, { url: pathToFileURL(f.archive).href, sha256: 'f'.repeat(64) })]);
  await assert.rejects(fetchModules({ lock: bad, out: path.join(f.dir, 'web'), platform: 'macos-arm64', ...quiet }), /SHA-256 mismatch/);
  const g = serviceFixture({ version: null });
  const noVersion = writeLock(g.dir, [serviceEntry(g, { url: pathToFileURL(g.archive).href, sha256: sha256(fs.readFileSync(g.archive)) })]);
  await assert.rejects(fetchModules({ lock: noVersion, out: path.join(g.dir, 'web'), platform: 'macos-arm64', ...quiet }), /no VERSION/);
  assert.deepEqual(fs.readdirSync(g.out), ['README.md'], 'a refused archive leaves the folder alone');
});
