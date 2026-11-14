import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from './quick-check.mjs';

test('a Review component maps to the Review specs and its related unit tests', () => {
  const p = plan(['ui/src/components/review/SpotDetails.svelte']);
  assert.deepEqual(p.specs, ['layout.spec.ts', 'openers.spec.ts', 'review.spec.ts']);
  assert.deepEqual(p.related, ['src/components/review/SpotDetails.svelte']);
  assert.equal(p.svelteCheck, true);
  assert.deepEqual(p.full, []);
});

test('an unmapped source file falls back to the screen-size walk', () => {
  assert.deepEqual(plan(['ui/src/components/Unmapped.svelte']).specs, ['sizes.spec.ts']);
});

test('a changed spec runs itself; docs run nothing', () => {
  assert.deepEqual(plan(['ui/tests/home.spec.ts']).specs, ['home.spec.ts']);
  const docs = plan(['docs/WORKFLOW.md']);
  assert.deepEqual([docs.specs, docs.related, docs.svelteCheck, docs.rust], [[], [], false, false]);
});

test('contracts, hosting, storage and the fake host ask for the full check', () => {
  for (const f of ['bridge/src/protocol.ts', 'src-tauri/src/bridge.rs', 'src-tauri/src/modules.rs',
    'ui/src/lib/settings.svelte.ts', 'ui/tests/fake-tauri.ts', 'ui/playwright.config.ts', 'modules.lock.json']) {
    assert.deepEqual(plan([f]).full, [f], f);
  }
  assert.equal(plan(['src-tauri/src/studio.rs']).rust, true);
  assert.deepEqual(plan(['src-tauri/src/studio.rs']).full, []);
});
