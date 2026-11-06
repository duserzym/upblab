import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'upbstudio-version-'));
  try {
    for (const dir of ['scripts', 'ui', 'src-tauri']) mkdirSync(join(root, dir));
    writeFileSync(join(root, 'scripts/check-version.mjs'), readFileSync(new URL('./check-version.mjs', import.meta.url)));
    for (const path of ['package.json', 'ui/package.json', 'src-tauri/tauri.conf.json']) {
      writeFileSync(join(root, path), JSON.stringify({ version: '0.2.0-beta.1' }));
    }
    writeFileSync(join(root, 'src-tauri/Cargo.toml'), '[package]\nname = "invented"\nversion = "0.2.0-beta.1"\n');
    run(root, () => spawnSync(process.execPath, ['scripts/check-version.mjs'], { cwd: root, encoding: 'utf8' }));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test('check-version accepts matching prerelease versions', () => fixture((_root, check) => {
  const result = check();
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '0.2.0-beta.1');
}));
for (const path of ['package.json', 'ui/package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml']) {
  test(`check-version rejects a mismatch in ${path}`, () => fixture((root, check) => {
    const file = join(root, path);
    writeFileSync(file, readFileSync(file, 'utf8').replace('0.2.0-beta.1', '0.2.0'));
    const result = check();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Version copies disagree/);
    assert.ok(result.stderr.includes(path));
  }));
}
