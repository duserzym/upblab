import { test, expect, type Page } from '@playwright/test';
import { installFakeTauri, type FakeOptions } from './fake-tauri';
import { fixtures, batch, lab, plan, recipe, version, solutions } from './fixtures/tims';
import { routeTimsAtlas } from './tims-atlas-helpers';
import { problems } from './problems';
import { fractionStatuses } from '../src/lib/tims-model';
// Preserve the stack in the supervisor's run if a Svelte runtime error recurs.
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const errors: string[] = []; pageErrors.set(page, errors); page.on('pageerror', error => errors.push(error.stack ?? String(error))); });
test.afterEach(async ({ page }, info) => {
  const errors = pageErrors.get(page) ?? [];
  if (errors.length) await info.attach('TIMS browser errors', { body: errors.join('\n\n'), contentType: 'text/plain' });
  expect(errors, 'Unhandled TIMS browser errors').toEqual([]);
});
type Write = { method: string; path: string; body: Record<string, unknown>; idempotencyKey: string };
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __fake: { writes: Write[] } }).__fake.writes);
async function start(page: Page, options: Partial<FakeOptions> = {}) {
  const scoped = Object.fromEntries(Object.entries(fixtures).map(([path, value]) => {
    const paged = ['/v1/labs', '/v1/accounts', '/v1/tims/spikes'].includes(path) ? `${path}?limit=500` : path;
    return [`${paged}${paged.includes('?') ? '&' : '?'}as=invented-viewer`, value];
  }));
  await routeTimsAtlas(page);
  await page.route('**/modules/manifest.json', route => route.fulfill({ json: { modules: [] } }));
  await page.addInitScript(installFakeTauri, { signedIn: true, canViewAs: true, ...options, store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'tims', ...options.store }, fixtures: { ...fixtures, ...scoped, ...options.fixtures } });
  await page.goto('./');
  await expect(page.getByRole('tab', { name: 'TIMS', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Batch list', exact: true })).toBeVisible();
}
async function openBatch(page: Page) {
  await page.getByRole('region', { name: 'Batch list', exact: true }).getByRole('button', { name: 'Krogh · 2026-11-06', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Krogh (K) · 2026-11-06', exact: true })).toBeVisible();
}
async function reply(page: Page, path: string, status: number, body: unknown) {
  await page.evaluate(({ path, status, body }) => { (window as unknown as { __fake: { apiReplies: Record<string, unknown> } }).__fake.apiReplies[path] = { status, body }; }, { path, status, body });
}
async function gate(page: Page, key: string, release = false) {
  await page.evaluate(async ({ key, release }) => {
    const fake = (window as unknown as { __fake: { holdApi(key: string): void; releaseApi(key: string): void } }).__fake;
    if (release) { fake.releaseApi(key); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }
    else fake.holdApi(key);
  }, { key, release });
}
const readCount = (page: Page, path: string) => page.evaluate(path => (window as unknown as { __fake: { calls: [string, { path?: string }][] } }).__fake.calls.filter(([command, args]) => command === 'api_get' && args?.path === path).length, path);
test('filters preserve the lab, use cursor paging, and stay out of the URL', async ({ page }) => {
  const path = `/v1/tims/batches?limit=500&lab=${lab}&capsule_set=set-k&started_after=2026-11-01&started_before=2026-11-30&status=picked`;
  await start(page, { apiReplies: { [path]: { status: 200, body: [batch], nextCursor: 'invented-next' }, [`/v1/tims/batches?limit=500&after=invented-next&lab=${lab}&capsule_set=set-k&started_after=2026-11-01&started_before=2026-11-30&status=picked`]: { status: 200, body: [{ ...batch, id: 'batch-older', started_on: '2026-11-05' }] } } });
  await page.getByLabel('Capsule set', { exact: true }).selectOption('set-k'); await page.getByLabel('Started after', { exact: true }).fill('2026-11-01'); await page.getByLabel('Started before', { exact: true }).fill('2026-11-30'); await page.getByLabel('Fraction status', { exact: true }).selectOption('picked'); await page.getByRole('button', { name: 'Apply filters' }).click();
  await page.getByRole('button', { name: 'Load more batches' }).click(); await expect(page.getByRole('region', { name: 'Batch list', exact: true }).getByRole('button')).toHaveCount(2);
  expect(page.url()).not.toContain('started_after');
  await page.reload(); await expect(page.getByLabel('Started after')).toHaveValue('2026-11-01');
});
test('grid has 15 cells, shared atlas crops, labels and per-capsule records', async ({ page }) => {
  await start(page); await openBatch(page); await expect(page.getByTestId('tims-capsule')).toHaveCount(15);
  const cellImage = page.getByRole('button', { name: 'K1 z1', exact: true }).getByTestId('tims-grain-image');
  await expect(cellImage).toHaveAttribute('data-image-state', 'ready');
  await expect(cellImage.locator('clipPath polygon')).toHaveCount(1); await expect(cellImage.locator('image[href]')).not.toHaveCount(0);
  await expect(cellImage.locator('circle')).not.toHaveClass(/\bdot\b/); await expect(page.getByTestId('tims-capsule').last()).toContainText('empty');
  await page.getByRole('button', { name: 'K1 z1', exact: true }).click(); const drawer = page.getByRole('region', { name: 'Capsule details' }); await expect(drawer).toContainText('Invented mount S'); await expect(drawer).toContainText('Invented grain one');
  await expect(drawer.locator('clipPath polygon')).toHaveCount(1); await expect(drawer.locator('image[href]')).not.toHaveCount(0);
  expect(await cellImage.locator('clipPath').getAttribute('id')).not.toBe(await drawer.locator('clipPath').getAttribute('id')); await drawer.getByRole('button', { name: 'Chemical abrasion', exact: true }).click(); await expect(drawer).toContainText('overridden');
  expect(await readCount(page, '/v1/mounts/mount-demo/atlas')).toBe(1);
  await page.getByRole('button', { name: 'Step × capsule matrix' }).click(); await expect(page.getByLabel('Capsule record matrix')).toContainText('180 °C');
  expect(await page.evaluate(() => (window as unknown as { __fake: { calls: [string, { path?: string }][] } }).__fake.calls.filter(([c, a]) => c === 'api_get' && a?.path === '/v1/mounts/mount-demo/elements').length)).toBe(1);
  await page.getByRole('button', { name: 'History', exact: true }).click(); await expect(page.getByRole('region', { name: 'History' })).toContainText('notes: old → new');
});
test('capsules render while atlas metadata is pending, then tiles fill in', async ({ page }) => {
  await start(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requests = await routeTimsAtlas(page, { holdManifest: pending });
  await openBatch(page);
  await expect(page.getByTestId('tims-capsule')).toHaveCount(15);
  const crop = page.getByRole('button', { name: 'K1 z1', exact: true }).getByTestId('tims-grain-image');
  await expect.poll(() => requests.length).toBe(1);
  await expect(crop.locator('image')).toHaveCount(0);
  await expect(crop.locator('polygon')).not.toHaveCount(0);
  release();
  await expect(crop).toHaveAttribute('data-image-state', 'ready');
  await expect(crop.locator('clipPath polygon')).toHaveCount(1);
  expect(requests.every(url => url.includes('version=3&access=invented-read-access'))).toBe(true);
});
test('an unpublished atlas keeps the outline and explains HTTP 404 in its title', async ({ page }) => {
  await start(page, { apiReplies: { '/v1/mounts/mount-demo/atlas': { status: 404, body: { detail: 'No invented atlas is published.' } } } });
  await openBatch(page);
  const crop = page.getByRole('button', { name: 'K1 z1', exact: true }).getByTestId('tims-grain-image');
  await expect(crop.locator('title')).toContainText('404');
  await expect(crop.locator('title')).toContainText('No invented atlas is published.');
  await expect(crop.locator('image')).toHaveCount(0); await expect(crop.locator('polygon')).not.toHaveCount(0);
  expect(await readCount(page, '/v1/mounts/mount-demo/atlas')).toBe(1);
});
test('failed image loads renew shared atlas access once, then retain the outline', async ({ page }) => {
  await start(page); await routeTimsAtlas(page, { failTiles: true }); await openBatch(page);
  const crop = page.getByRole('button', { name: 'K1 z1', exact: true }).getByTestId('tims-grain-image');
  await expect(crop.locator('title')).toContainText('a published tile could not be loaded');
  await expect(crop.locator('image')).toHaveCount(0);
  await expect.poll(() => readCount(page, '/v1/mounts/mount-demo/atlas')).toBe(2);
});
test('missing source and operator labels use shared cached names', async ({ page }) => {
  const unnamed = { ...batch, operator_id: 'invented-other-operator', operator_name: '', fractions: batch.fractions.map(f => ({ ...f, sources: f.sources.map(s => ({ ...s, mount_label: null, grain_label: null, spot_label: null })) })) };
  await start(page, { fixtures: {
    '/v1/accounts?limit=500': [{ id: 'invented-other-operator', username: 'other-analyst', display_name: 'Invented other analyst' }],
    '/v1/mounts/mount-demo': { label: 'Shared invented mount' },
    '/v1/mounts/mount-demo/elements': { ...fixtures['/v1/mounts/mount-demo/elements'] as object, grains: [{ id: 'atlas-grain-1', server_id: 'grain-1', number: 3, polygon_um: [[0, 0], [100, 0], [80, 50]] }] },
    [`/v1/tims/batches?limit=500&lab=${lab}`]: [unnamed], [`/v1/tims/batches/${batch.id}`]: unnamed,
  } });
  await openBatch(page); await expect(page.getByRole('region', { name: 'Chemistry batch' })).toContainText('Invented other analyst');
  await page.getByRole('button', { name: 'K1 z1', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Capsule details' })).toContainText('Mount: Shared invented mount · Grain: 3');
  expect(await readCount(page, '/v1/accounts?limit=500')).toBe(1); expect(await readCount(page, '/v1/mounts/mount-demo')).toBe(1); expect(await readCount(page, '/v1/mounts/mount-demo/elements')).toBe(1);
});
for (const [width, height] of [[1280, 800], [1024, 640]]) test(`all 15 populated capsule status chips keep words intact at ${width} × ${height}`, async ({ page }) => {
  const fractions = Array.from({ length: 15 }, (_, i) => ({ ...batch.fractions[0], id: `invented-capsule-${i + 1}`, name: `z${i + 1}`, capsule_number: i + 1, capsule_label: `K${i + 1}`, status: fractionStatuses[i % fractionStatuses.length] }));
  const populated = { ...batch, fractions, capsule_map: Object.fromEntries(fractions.map(f => [String(f.capsule_number), f.id])) };
  await page.setViewportSize({ width, height }); await start(page, { fixtures: { [`/v1/tims/batches/${batch.id}`]: populated } }); await openBatch(page);
  await expect(page.getByTestId('tims-capsule').locator('.chip')).toHaveCount(15);
  expect(await page.getByTestId('tims-capsule').locator('.chip').evaluateAll(chips => chips.flatMap(chip => {
    const errors: string[] = [];
    if (chip.scrollWidth > chip.clientWidth + 1) errors.push(`${chip.textContent}: overflow`);
    const node = chip.firstChild;
    if (node) for (const word of (node.textContent ?? '').matchAll(/\S+/g)) {
      const range = document.createRange(); range.setStart(node, word.index!); range.setEnd(node, word.index! + word[0].length);
      if (range.getClientRects().length !== 1) errors.push(`${word[0]}: broken word`);
    }
    return errors;
  }))).toEqual([]);
  expect(await problems(page, 'Populated capsule grid')).toEqual([]);
});
test('step edits are durable while offline, then sent with an Idempotency-Key', async ({ page }) => {
  await start(page, { cached: { asOf: '2026-11-06T10:00:00Z', reason: 'unreachable' } }); await openBatch(page);
  const step = page.getByRole('article', { name: 'Chemical abrasion', exact: true }); await step.getByRole('button', { name: 'Edit step', exact: true }).click(); await step.getByLabel('Temperature (°C)').fill('195'); await step.getByRole('button', { name: 'Save step here' }).click();
  await expect(page.getByRole('complementary', { name: 'Saved edits' })).toContainText('1 edit not sent yet'); expect(await writes(page)).toHaveLength(0);
  const changed = { ...batch, steps: batch.steps.map(s => s.id === 'ca-step' ? { ...s, parameters: { ...s.parameters, temperature_c: 195 } } : s) };
  await reply(page, `PATCH /v1/tims/batches/${batch.id}/steps/ca-step`, 200, changed.steps[0]); await reply(page, `/v1/tims/batches/${batch.id}`, 200, changed); await reply(page, '/v1/accounts/me', 200, { id: 'invented-account', username: 'demo' });
  await page.evaluate(() => { (window as unknown as { __fake: { goOnline(): void } }).__fake.goOnline(); window.dispatchEvent(new Event('online')); }); await expect.poll(() => writes(page)).toHaveLength(1); const [write] = await writes(page);
  expect(write).toMatchObject({ method: 'PATCH', path: `/v1/tims/batches/${batch.id}/steps/ca-step`, body: { parameters: { temperature_c: 195 } } }); expect(write.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
  await expect(page.getByRole('complementary', { name: 'Saved edits' })).toHaveCount(0);
});
test('422 attention shows the server reason with Retry and Discard', async ({ page }) => {
  await start(page, { apiReplies: { [`PATCH /v1/tims/batches/${batch.id}/steps/ca-step`]: { status: 422, body: { code: 'validation_failed', detail: 'Invented temperature refusal.' } } } }); await openBatch(page);
  const step = page.getByRole('article', { name: 'Chemical abrasion', exact: true }); await step.getByRole('button', { name: 'Edit step' }).click(); await step.getByLabel('Temperature (°C)').fill('195'); await step.getByRole('button', { name: 'Save step here' }).click();
  const edits = page.getByRole('complementary', { name: 'Saved edits' }); await expect(edits).toContainText('1 needs your attention'); await edits.getByText('1 needs your attention').click(); await expect(edits).toContainText('422'); await expect(edits).toContainText('Invented temperature refusal.'); await expect(edits.getByRole('button', { name: 'Retry' })).toBeVisible(); await edits.getByRole('button', { name: 'Discard' }).click(); await expect(edits).toHaveCount(0);
});
test('spike picker reviews composition and non-current warning before applying a registered version', async ({ page }) => {
  await start(page); await openBatch(page); const step = page.getByRole('article', { name: 'Spiking', exact: true }); await step.getByRole('button', { name: 'Edit step' }).click(); await step.getByRole('button', { name: 'Choose spike version' }).click();
  const picker = page.getByRole('region', { name: 'Spike version picker' }); await expect(picker.getByLabel('Solution', { exact: true }).getByRole('option')).toHaveCount(solutions.length + 1); await picker.getByLabel('Solution', { exact: true }).selectOption('synthetic-solution'); await picker.getByLabel('Subfraction', { exact: true }).selectOption('synthetic-bottle'); await picker.getByLabel('Version', { exact: true }).selectOption(version.id);
  await expect(picker.getByRole('region', { name: 'Spike composition' })).toContainText('0.001 mol/g'); await expect(picker).toContainText('uncertainty not given'); await expect(picker).toContainText('not current'); expect(await writes(page)).toHaveLength(0);
  await picker.getByRole('button', { name: 'Apply reviewed version' }).click(); await expect(picker).toHaveCount(0); expect(await writes(page)).toHaveLength(0);
  await expect(step).toContainText('Selected version: Synthetic spike · Master · v1 (superseded)');
  await step.getByRole('button', { name: 'Choose spike version' }).click();
  await expect(picker.getByLabel('Solution', { exact: true }).getByRole('option')).toHaveCount(solutions.length + 1);
  expect(await readCount(page, '/v1/tims/spikes?limit=500')).toBe(1);
});
test('new recipes and reset fill guidebook defaults for review before saving', async ({ page }) => {
  await start(page); await page.getByRole('navigation', { name: 'TIMS sections' }).getByRole('button', { name: 'Recipes', exact: true }).click(); await page.getByRole('button', { name: 'New recipe', exact: true }).click(); const editor = page.getByRole('region', { name: 'Recipe editor' }); await expect(editor.getByLabel('Temperature (°C)').first()).toHaveValue('900'); await expect(editor.getByLabel('Duration (h)').first()).toHaveValue('60'); expect(await writes(page)).toHaveLength(0);
  await editor.getByRole('button', { name: 'Close recipe' }).click(); await page.getByRole('button', { name: recipe.name, exact: true }).click(); await editor.getByRole('button', { name: 'Reset to guidebook defaults' }).click(); await expect(editor.getByLabel('Temperature (°C)').first()).toHaveValue('900'); expect(await writes(page)).toHaveLength(0);
});
test('BSU defaults need an explicit confirm and create only missing sets with separate keys', async ({ page }) => {
  await start(page, { apiReplies: { 'POST /v1/tims/capsule-sets': { status: 200, body: { ...batch.capsule_set, id: 'invented-created' } } } }); await page.getByRole('navigation', { name: 'TIMS sections' }).getByRole('button', { name: 'Capsule sets', exact: true }).click(); await page.getByRole('button', { name: 'Add BSU-IGL defaults' }).click(); const dialog = page.getByRole('dialog', { name: 'Add BSU-IGL defaults' }); await expect(dialog).toContainText('Becquerel B'); await expect(dialog).not.toContainText('Krogh K'); expect(await writes(page)).toHaveLength(0);
  await page.evaluate(() => (window as unknown as { __emit(event: string, payload: unknown): Promise<void> }).__emit('shell://menu', 'tab:home'));
  await expect(dialog).toHaveCount(0); await page.getByRole('tab', { name: 'TIMS', exact: true }).click(); await expect(dialog).toBeVisible(); expect(await writes(page)).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click(); await expect.poll(() => writes(page)).toHaveLength(9); const calls = await writes(page); expect(new Set(calls.map(w => w.idempotencyKey)).size).toBe(9); expect(calls.map(w => w.body.name)).toEqual(['Becquerel', 'Curie', 'Holmes', 'Wilson', 'Aston', 'Nier', 'Ussher', 'Rutherford', 'Soddy']);
});
test('pick notes preview, then a separate confirmation imports the exact plan with a key', async ({ page }) => {
  await start(page, { apiReplies: { 'POST /v1/tims/pick-notes/preview': { status: 200, body: plan }, 'POST /v1/tims/pick-notes/import': { status: 200, body: { plan, created: { batches: [batch.id], fractions: ['invented-fraction'], sources: ['invented-source'] } } } } }); await page.getByRole('navigation', { name: 'TIMS sections' }).getByRole('button', { name: 'Import pick notes', exact: true }).click(); await page.getByLabel('Pick-note text', { exact: true }).fill('K1-z1:S 1'); await page.getByRole('button', { name: 'Preview pick notes' }).click(); await expect(page.getByRole('region', { name: 'Pick-note plan' })).toContainText('1 batch, 1 fraction, 1 source'); await expect(page.getByRole('region', { name: 'Pick-note plan' })).toContainText('Sample Synthetic-A (DEMO-2026) · Set Krogh K · Mount Invented mount S · Spot S 1 · Grain Invented grain one'); expect((await writes(page)).map(w => w.path)).toEqual(['/v1/tims/pick-notes/preview']); await page.getByRole('button', { name: 'Import confirmed plan' }).click(); const confirm = page.getByRole('dialog', { name: 'Import pick notes' }); await expect(confirm).toContainText('1 batch, 1 fraction, 1 source'); await confirm.getByRole('button', { name: 'Confirm', exact: true }).click(); await expect(page.getByRole('region', { name: 'Imported batches' }).getByRole('button', { name: 'Open batch Krogh · 2026-11-06', exact: true })).toBeVisible(); expect((await writes(page))[1]).toMatchObject({ method: 'POST', path: '/v1/tims/pick-notes/import', body: { text: 'K1-z1:S 1', lab_id: lab } }); expect((await writes(page))[1].idempotencyKey).toBeTruthy();
});
test('refused preview and a refusal at import show the returned plan and disable import', async ({ page }) => {
  const refused = { ...plan, summary: { ok: 0, refused: 1 }, lines: plan.lines.map(l => ({ ...l, status: 'refused', code: 'capsule_taken', message: 'Invented capsule occupied.' })) };
  await start(page, { apiReplies: { 'POST /v1/tims/pick-notes/preview': { status: 200, body: plan }, 'POST /v1/tims/pick-notes/import': { status: 409, body: { code: 'pick_notes_refused', detail: 'Invented plan was refused.', plan: refused } } } }); await page.getByRole('navigation', { name: 'TIMS sections' }).getByRole('button', { name: 'Import pick notes', exact: true }).click(); await page.getByLabel('Pick-note text', { exact: true }).fill('K1-z1:S 1'); await page.getByRole('button', { name: 'Preview pick notes' }).click(); await page.getByRole('button', { name: 'Import confirmed plan' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click(); await expect(page.getByRole('region', { name: 'Pick-note plan' })).toContainText('Invented capsule occupied.'); await expect(page.getByRole('button', { name: 'Import confirmed plan' })).toBeDisabled(); await page.getByLabel('Show lines').selectOption('refused'); await expect(page.getByRole('cell', { name: '1. K1-z1:S 1' })).toBeVisible();
});
test('view-as is read-only, and top-level tab switches preserve a selected capsule', async ({ page }) => {
  await start(page); await openBatch(page); await page.getByRole('button', { name: 'K1 z1', exact: true }).click(); await page.getByRole('tab', { name: 'Home', exact: true }).click(); await page.getByRole('tab', { name: 'TIMS', exact: true }).click(); await expect(page.getByRole('region', { name: 'Capsule details' })).toBeVisible();
  await page.getByRole('navigation', { name: 'TIMS sections' }).getByRole('button', { name: 'Recipes', exact: true }).click();
  await page.evaluate(() => (window as unknown as { __emit(event: string, payload: unknown): Promise<void> }).__emit('lab-bridge://open', { source: 'sessions', url: 'upbdb://tims/batch/batch-synthetic' }));
  await expect(page.getByRole('heading', { name: 'Krogh (K) · 2026-11-06', exact: true })).toBeVisible();
  await page.locator('header.bar').getByLabel('View as', { exact: true }).selectOption('invented-viewer');
  await expect(page.locator('header.bar').getByTestId('view-as-banner')).toBeVisible();
  await expect(page.locator('.oversight-bar')).toHaveCount(0);
  await expect(page.getByTestId('tims-view')).toContainText('Viewing as another account is read-only.'); await expect(page.getByRole('button', { name: 'Edit batch', exact: true })).toBeDisabled(); expect(await writes(page)).toHaveLength(0);
});
test('delivering an unrelated queued recipe does not refresh a mounted chemistry batch', async ({ page }) => {
  await start(page, { cached: { asOf: '2026-11-06T10:00:00Z', reason: 'unreachable' }, apiReplies: { [`PATCH /v1/tims/recipes/${recipe.id}`]: { status: 200, body: { ...recipe, notes: 'Saved elsewhere' } } } });
  const nav = page.getByRole('navigation', { name: 'TIMS sections' });
  await nav.getByRole('button', { name: 'Recipes', exact: true }).click(); await page.getByRole('button', { name: recipe.name, exact: true }).click();
  await page.getByLabel('Recipe notes').fill('Saved elsewhere'); await page.getByRole('button', { name: 'Save recipe here' }).click();
  await expect(page.getByRole('complementary', { name: 'Saved edits' })).toContainText('1 edit not sent yet');
  await nav.getByRole('button', { name: 'Batches', exact: true }).click(); await openBatch(page);
  await expect.poll(() => readCount(page, `/v1/tims/batches/${batch.id}`)).toBe(1);
  await reply(page, '/v1/accounts/me', 200, fixtures['/v1/accounts/me']);
  await page.evaluate(() => { (window as unknown as { __fake: { goOnline(): void } }).__fake.goOnline(); window.dispatchEvent(new Event('online')); });
  await expect(page.getByRole('complementary', { name: 'Saved edits' })).toHaveCount(0);
  expect(await readCount(page, `/v1/tims/batches/${batch.id}`)).toBe(1); expect(await readCount(page, '/v1/mounts/mount-demo/elements')).toBe(1);
});
test('a late batch creation in another lab does not navigate the current workspace', async ({ page }) => {
  const other = 'another-invented-lab';
  await start(page, { fixtures: { '/v1/labs': [{ id: lab, name: 'Invented lab', my_role: 'member' }, { id: other, name: 'Another invented lab', my_role: 'member' }], [`/v1/tims/capsule-sets?limit=500&lab=${other}`]: [], [`/v1/tims/recipes?limit=500&lab=${other}`]: [], [`/v1/tims/batches?limit=500&lab=${other}`]: [] }, apiReplies: { 'POST /v1/tims/batches': { status: 200, body: { ...batch, id: 'earlier-created-batch' } } } });
  await gate(page, 'POST /v1/tims/batches'); await page.getByRole('button', { name: 'New batch', exact: true }).click();
  await page.getByRole('form', { name: 'New batch' }).getByLabel('Active capsule set').selectOption(batch.capsule_set_id);
  await page.getByRole('button', { name: 'Create batch', exact: true }).click(); await expect.poll(() => writes(page)).toHaveLength(1);
  await page.getByLabel('Lab', { exact: true }).selectOption(other); await expect(page.getByRole('region', { name: 'Batch list', exact: true })).toBeVisible();
  await gate(page, 'POST /v1/tims/batches', true);
  await expect(page.getByLabel('Lab', { exact: true })).toHaveValue(other); await expect(page.getByRole('region', { name: 'Batch list', exact: true })).toBeVisible();
  expect(await readCount(page, '/v1/tims/batches/earlier-created-batch')).toBe(0);
});
test('a late recipe creation cannot close a different recipe form', async ({ page }) => {
  await start(page, { apiReplies: { 'POST /v1/tims/recipes': { status: 200, body: { ...recipe, id: 'earlier-recipe' } } } });
  await page.getByRole('navigation', { name: 'TIMS sections' }).getByRole('button', { name: 'Recipes', exact: true }).click();
  await gate(page, 'POST /v1/tims/recipes'); await page.getByRole('button', { name: 'New recipe', exact: true }).click();
  await page.getByRole('button', { name: 'Create recipe', exact: true }).click(); await expect.poll(() => writes(page)).toHaveLength(1);
  await page.getByRole('button', { name: 'Close recipe', exact: true }).click(); await page.getByRole('button', { name: recipe.name, exact: true }).click();
  await page.getByLabel('Recipe notes').fill('Keep this newer draft'); await gate(page, 'POST /v1/tims/recipes', true);
  await expect(page.getByRole('region', { name: 'Recipe editor' })).toBeVisible(); await expect(page.getByLabel('Recipe notes')).toHaveValue('Keep this newer draft');
});
test('a late pick-note preview cannot appear in a different account view', async ({ page }) => {
  await start(page, { apiReplies: { 'POST /v1/tims/pick-notes/preview': { status: 200, body: plan } } });
  await page.getByRole('navigation', { name: 'TIMS sections' }).getByRole('button', { name: 'Import pick notes', exact: true }).click();
  await gate(page, 'POST /v1/tims/pick-notes/preview'); await page.getByLabel('Pick-note text', { exact: true }).fill('K1-z1:S 1'); await page.getByRole('button', { name: 'Preview pick notes' }).click();
  await expect.poll(() => writes(page)).toHaveLength(1); await page.locator('header.bar').getByLabel('View as', { exact: true }).selectOption('invented-viewer');
  await expect(page.getByTestId('tims-view')).toContainText('Viewing as another account is read-only.'); await gate(page, 'POST /v1/tims/pick-notes/preview', true);
  await expect(page.getByRole('region', { name: 'Pick-note plan' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Preview pick notes' })).toBeDisabled();
});
for (const [width, height] of [[1280, 800], [1440, 900], [1024, 640]]) for (const theme of ['light', 'dark']) {
  test(`TIMS panels fit ${width} × ${height}, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await start(page, { store: { theme, themeChosen: true } }); await openBatch(page); await page.getByRole('button', { name: 'K1 z1', exact: true }).click(); await expect(page.getByRole('img', { name: 'Grain outline and LA spot' }).first()).toBeAttached(); expect(await problems(page, 'TIMS batch')).toEqual([]);
    for (const name of ['Recipes', 'Capsule sets', 'Spikes', 'Import pick notes']) { await page.getByRole('navigation', { name: 'TIMS sections' }).getByRole('button', { name, exact: true }).click(); expect(await problems(page, `TIMS ${name}`)).toEqual([]); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
