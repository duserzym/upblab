import { test, expect, type Page, type Locator } from '@playwright/test';
import { installFakeTauri, type FakeOptions } from './fake-tauri';
import { fixtures, batch, lab, plan, recipe, version, solutions, publishedVersion, labVersion, earlierVersion } from './fixtures/tims';
import { capsuleMount, correctionElements, correctionFixtures, correctionGrain, correctionSpot, correctedFraction, replacementPath } from './fixtures/tims-capsules';
import { routeTimsAtlas } from './tims-atlas-helpers';
import { problems } from './problems';
import { expectPuckBoardFits, expectTimsBenchFills } from './tims-layout';
import { fractionStatuses, statusWords } from '../src/lib/tims-model';
import { inventedElements } from './fixtures/tims-atlas';
import { writeCapsulePreparation } from '../src/lib/tims-capsule-intake';
import { writeSpikingSession } from '../src/lib/tims-spiking';
import { writeColumnNotes } from '../src/lib/tims-protocol';
import type { ColumnProtocolOut, SourceOut } from '../src/lib/tims-api';
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
const labProtocolsPath = `/v1/tims/column-protocols?limit=2&lab=${lab}`;
async function start(page: Page, options: Partial<FakeOptions> = {}) {
  const scoped = Object.fromEntries(Object.entries({ ...fixtures, [labProtocolsPath]: [] }).map(([path, value]) => {
    const paged = ['/v1/labs', '/v1/accounts', '/v1/tims/spikes'].includes(path) ? `${path}?limit=500` : path;
    return [`${paged}${paged.includes('?') ? '&' : '?'}as=invented-viewer`, value];
  }));
  await routeTimsAtlas(page);
  await page.route('**/modules/manifest.json', route => route.fulfill({ json: { modules: [] } }));
  await page.addInitScript(installFakeTauri, { signedIn: true, canViewAs: true, ...options, store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'tims', ...options.store }, fixtures: { ...fixtures, [labProtocolsPath]: [], ...scoped, ...options.fixtures } });
  await page.goto('./');
  await expect(page.getByRole('tab', { name: 'TIMS', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Batch list', exact: true })).toBeVisible();
}
async function openBatch(page: Page) {
  await page.getByRole('region', { name: 'Batch list', exact: true }).getByRole('button', { name: 'Krogh · 2026-11-06', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Krogh (K)', exact: true })).toBeVisible();
}
async function openStep(page: Page, name: string) {
  await page.getByRole('radio', { name: 'Batch steps', exact: true }).click();
  await page.getByRole('group', { name: 'Choose a batch step' }).getByRole('button', { name: new RegExp(name + '$') }).click();
  return page.getByRole('article', { name, exact: true });
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
  const path = `/v1/tims/batches?limit=200&lab=${lab}&capsule_set=set-k&started_after=2026-11-01&started_before=2026-11-30&status=picked&order=-started_on`;
  await start(page, { apiReplies: { [path]: { status: 200, body: [batch], nextCursor: 'invented-next' }, [`/v1/tims/batches?limit=200&after=invented-next&lab=${lab}&capsule_set=set-k&started_after=2026-11-01&started_before=2026-11-30&status=picked&order=-started_on`]: { status: 200, body: [{ ...batch, id: 'batch-older', started_on: '2026-11-05' }] } } });
  await page.getByLabel('Capsule set', { exact: true }).selectOption('set-k'); await page.getByLabel('Started after', { exact: true }).fill('2026-11-01'); await page.getByLabel('Started before', { exact: true }).fill('2026-11-30'); await page.getByLabel('Fraction status', { exact: true }).selectOption('picked');
  await page.getByRole('button', { name: 'Load more batches' }).click(); await expect(page.getByRole('region', { name: 'Batch list', exact: true }).getByTestId('tims-batch-row')).toHaveCount(2);
  expect(page.url()).not.toContain('started_after');
  await page.reload(); await expect(page.getByLabel('Started after')).toHaveValue('2026-11-01');
});
test('grid has 15 cells, shared atlas crops, labels and per-capsule records', async ({ page }) => {
  await start(page); await openBatch(page); await expect(page.getByTestId('tims-capsule')).toHaveCount(15);
  const cellImage = page.getByRole('button', { name: /^K1 z1(?: · |$)/ }).getByTestId('tims-grain-image');
  await expect(cellImage).toHaveAttribute('data-image-state', 'ready');
  await expect(cellImage.locator('clipPath polygon')).toHaveCount(1); await expect(cellImage.locator('image[href]')).not.toHaveCount(0);
  await expect(cellImage.locator('circle')).not.toHaveClass(/\bdot\b/); await expect(page.getByRole('button', { name: 'K15 empty', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /^K1 z1(?: · |$)/ }).click(); const drawer = page.getByRole('region', { name: 'Capsule details' }); await expect(drawer).toContainText('Invented mount S'); await expect(drawer).toContainText('Invented grain one');
  await expect(drawer.locator('clipPath polygon')).toHaveCount(1); await expect(drawer.locator('image[href]')).not.toHaveCount(0);
  expect(await cellImage.locator('clipPath').getAttribute('id')).not.toBe(await drawer.locator('clipPath').getAttribute('id')); await drawer.getByLabel('Capsule step', { exact: true }).selectOption('ca-step'); await expect(drawer).toContainText('overridden');
  expect(await readCount(page, '/v1/mounts/mount-demo/atlas')).toBe(1);
  await page.getByRole('radio', { name: 'Step × capsule matrix' }).click(); await expect(page.getByLabel('Capsule record matrix')).toContainText('180 °C');
  expect(await page.evaluate(() => (window as unknown as { __fake: { calls: [string, { path?: string }][] } }).__fake.calls.filter(([c, a]) => c === 'api_get' && a?.path === '/v1/mounts/mount-demo/elements').length)).toBe(1);
  await page.getByRole('button', { name: 'History', exact: true }).click(); await expect(page.getByRole('region', { name: 'History' })).toContainText('notes: old → new');
});
test('loading a grain creates the empty capsule and its selected LA spots with one write', async ({ page }) => {
  const grain = { ...inventedElements.grains[0], label: 'Invented selectable grain', sample: 'Synthetic-A' };
  const spot = { ...inventedElements.spots[0], grain_id: grain.id, name: 'Invented spot 1' };
  const extra = { ...spot, id: 'atlas-2', server_id: 'spot-2', name: 'Invented spot 2' };
  const template = batch.fractions[0], source = template.sources[0];
  const added = { ...template, id: 'new-fraction', name: 'z3', status: 'picked', capsule_number: 3, capsule_label: 'K3',
    sources: [{ ...source, spot_label: spot.name }, { ...source, id: 'source-2', spot_id: extra.server_id, atlas_spot_id: extra.id, spot_label: extra.name }] };
  await start(page, {
    fixtures: { '/v1/mounts?limit=50': [{ id: 'mount-demo', label: 'Invented mount S', atlas: { project_id: 'project-demo' } }],
      '/v1/mounts/mount-demo/elements': { ...inventedElements, grains: [grain], spots: [spot, extra] } },
    apiReplies: { 'POST /v1/fractions': { status: 201, body: added } },
  });
  await openBatch(page);
  await page.getByRole('button', { name: 'K3 empty', exact: true }).click();
  await page.getByRole('button', { name: 'GrainAtlas', exact: true }).click();
  const picker = page.getByRole('region', { name: 'GrainAtlas picker' });
  await chooseMount(picker, 'Invented mount S');
  await picker.getByRole('button', { name: /Invented selectable grain/ }).click();
  await expect(picker.getByLabel('Invented spot 1')).toBeChecked();
  await expect(picker.getByLabel('Invented spot 2')).toBeChecked();
  await picker.getByRole('button', { name: 'Load into K3' }).click();
  await expect(page.getByRole('button', { name: 'K3 z3 · Invented spot 1, Invented spot 2', exact: true })).toBeVisible();
  await expect(page.getByLabel('Linked LA spots')).toContainText('Invented spot 2');
  expect(await writes(page)).toMatchObject([{ method: 'POST', path: '/v1/fractions', body: {
    lab_id: lab, batch_id: batch.id, capsule_number: 3, mineral: 'zircon',
    sources: [{ grain_id: 'grain-1', spot_id: 'spot-1' }, { grain_id: 'grain-1', spot_id: 'spot-2' }],
  } }]);
  expect(await readCount(page, '/v1/mounts/mount-demo/elements')).toBe(1);
  expect(await readCount(page, `/v1/tims/batches/${batch.id}`)).toBe(1);
});
test('assigns an existing sample directly to TIMS without a mount or laser spot', async ({ page }) => {
  const sample = { id: 'sample-direct', name: 'Invented unmounted sample', material: 'Zircon', igsn: null, project: { code: 'DEMO' } };
  const notes = writeCapsulePreparation('tims-only', 'Picked by hand');
  const added = { ...batch.fractions[0], id: 'fraction-direct', sample, name: 'z3', status: 'transferred', capsule_number: 3, capsule_label: 'K3', notes, sources: [] };
  const path = '/v1/samples?limit=50&q=Invented';
  await start(page, { fixtures: { [path]: [sample] }, apiReplies: { 'POST /v1/fractions': { status: 201, body: added } } });
  await openBatch(page);
  await page.getByRole('button', { name: 'K3 empty', exact: true }).click();
  await page.getByRole('button', { name: 'TIMS only', exact: true }).click();
  const form = page.getByRole('region', { name: 'TIMS only setup' });
  await form.getByRole('searchbox', { name: 'Find a sample' }).fill('Invented');
  await form.getByRole('button', { name: 'Search', exact: true }).click();
  await form.getByRole('combobox', { name: 'Sample', exact: true }).selectOption(sample.id);
  await form.getByLabel('Fraction notes').fill('Picked by hand');
  await form.getByRole('button', { name: 'Assign sample to K3' }).click();
  await expect(page.getByRole('button', { name: 'K3 z3 · TIMS only', exact: true })).toBeVisible();
  expect(await writes(page)).toMatchObject([{ method: 'POST', path: '/v1/fractions', body: { sample_id: sample.id, batch_id: batch.id, capsule_number: 3, sources: [], notes } }]);
  expect(await readCount(page, path)).toBe(1);
  expect(await readCount(page, '/v1/mounts?limit=50')).toBe(1);
});
test('opens the Spiking pane for a source-free lab blank and saves its measured use', async ({ page }) => {
  const sample = { id: 'sample-blank', name: 'Invented lab blank', material: 'Lab blank', igsn: null, project: { code: 'DEMO' } };
  const ordinary = { ...sample, id: 'sample-other', name: 'Invented ordinary sample', material: 'Zircon' };
  const steps = batch.steps.map(s => s.id === 'spike-step' ? { ...s, notes: writeSpikingSession('', { before: '', after: '' }, [
    { bottleId: version.subfraction_id, versionId: version.id, label: version.solution_name, before: '25.0000' },
  ]) } : s);
  const added = { ...batch.fractions[0], id: 'fraction-blank', sample, name: 'o1', mineral: 'other', status: 'transferred', capsule_number: 3, capsule_label: 'K3',
    notes: writeCapsulePreparation('lab-blank', ''), sources: [] };
  const put = `/v1/tims/batches/${batch.id}/fractions/${added.id}/steps/spike-step/spike`;
  const addition = { ...batch.spikes[0], id: 'spike-blank', fraction_id: added.id, spike_weight_g: '0.0080',
    bottle_before_g: '25.0000', bottle_after_g: '24.9920', bottle_difference_g: '0.0080', notes: 'Process blank' };
  const batchPath = `/v1/tims/batches/${batch.id}`;
  await start(page, { fixtures: { [batchPath]: { ...batch, steps, spike_versions: { ...batch.spike_versions, [version.id]: { ...version, status: 'current', is_current: true } } }, '/v1/samples?limit=50&q=blank': [sample, ordinary] },
    apiReplies: { 'POST /v1/fractions': { status: 201, body: added }, [`PUT ${put}`]: { status: 200, body: addition } } });
  await openBatch(page);
  await page.getByRole('button', { name: 'K3 empty', exact: true }).click();
  await page.getByRole('button', { name: 'Lab blank', exact: true }).click();
  const form = page.getByRole('region', { name: 'Lab blank setup' });
  await form.getByRole('button', { name: 'Search', exact: true }).click();
  const picker = form.getByRole('combobox', { name: 'Lab blank sample' });
  await expect(picker.getByRole('option')).toHaveCount(2);
  await picker.selectOption(sample.id);
  await form.getByRole('button', { name: 'Set K3 as a lab blank' }).click();
  await expect(page.getByRole('button', { name: 'K3 o1 · Lab blank', exact: true })).toBeVisible();
  const capsule = page.getByRole('region', { name: 'Capsule details' });
  await expect(capsule.getByLabel('Capsule step')).toHaveCount(1);
  await expect(capsule.getByLabel('Capsule step')).toHaveValue('spike-step');
  await expect(capsule.getByRole('heading', { name: 'Spiking', exact: true })).toBeVisible();
  await capsule.getByRole('textbox', { name: 'Bottle after this capsule (g)' }).fill('24.9920');
  await capsule.getByRole('textbox', { name: 'Spike comment' }).fill('Process blank');
  await reply(page, batchPath, 200, { ...batch, steps, spike_versions: { ...batch.spike_versions, [version.id]: { ...version, status: 'current', is_current: true } }, fractions: [...batch.fractions, added], capsule_map: { ...batch.capsule_map, 3: added.id }, spikes: [...batch.spikes, addition] });
  await capsule.getByRole('button', { name: 'Save spike here' }).click();
  await expect.poll(async () => (await writes(page)).map(({ method, path, body }) => ({ method, path, body }))).toMatchObject([
    { method: 'POST', path: '/v1/fractions', body: { sample_id: sample.id, mineral: 'other', sources: [] } },
    { method: 'PUT', path: put, body: { spike_weight_g: '0.0080', bottle_before_g: '25.0000', bottle_after_g: '24.9920', notes: 'Process blank' } },
  ]);
});
test('capsules render while atlas metadata is pending, then tiles fill in', async ({ page }) => {
  await start(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requests = await routeTimsAtlas(page, { holdManifest: pending });
  await openBatch(page);
  await expect(page.getByTestId('tims-capsule')).toHaveCount(15);
  const crop = page.getByRole('button', { name: /^K1 z1(?: · |$)/ }).getByTestId('tims-grain-image');
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
  const crop = page.getByRole('button', { name: /^K1 z1(?: · |$)/ }).getByTestId('tims-grain-image');
  await expect(crop.locator('title')).toContainText('404');
  await expect(crop.locator('title')).toContainText('No invented atlas is published.');
  await expect(crop.locator('image')).toHaveCount(0); await expect(crop.locator('polygon')).not.toHaveCount(0);
  expect(await readCount(page, '/v1/mounts/mount-demo/atlas')).toBe(1);
});
test('failed image loads renew shared atlas access once, then retain the outline', async ({ page }) => {
  await start(page); await routeTimsAtlas(page, { failTiles: true }); await openBatch(page);
  const crop = page.getByRole('button', { name: /^K1 z1(?: · |$)/ }).getByTestId('tims-grain-image');
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
    [`/v1/tims/batches?limit=200&lab=${lab}&order=-started_on`]: [unnamed], [`/v1/tims/batches/${batch.id}`]: unnamed,
  } });
  await openBatch(page); await expect(page.getByRole('region', { name: 'Chemistry batch' })).toContainText('Invented other analyst');
  await page.getByRole('button', { name: /^K1 z1(?: · |$)/ }).click();
  await expect(page.getByRole('region', { name: 'Capsule details' })).toContainText('Mount: Shared invented mount · Grain: 3');
  expect(await readCount(page, '/v1/accounts?limit=500')).toBe(1); expect(await readCount(page, '/v1/mounts/mount-demo')).toBe(1); expect(await readCount(page, '/v1/mounts/mount-demo/elements')).toBe(1);
});
for (const [width, height] of [[1280, 800], [1440, 900]]) {
  test(`lab protocol editor fits ${width} × ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await start(page, { fixtures: { '/v1/labs': ownerLab, [labProtocolsPath]: [{ ...inventedProtocol,
      title: 'Invented protocol ' + 'long-title-'.repeat(30), source_url: 'https://example.org/' + 'invented-path-'.repeat(30),
    }] } });
    const area = await openLabProtocols(page);
    await area.getByRole('button', { name: 'Edit HCl anion lab protocol', exact: true }).click();
    await expect(area.getByLabel('Lab protocol text', { exact: true })).toHaveValue(inventedProtocol.text);
    expect(await problems(page, 'TIMS lab protocol editor')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
for (const [width, height] of [[1280, 800], [1024, 640]]) test(`all 15 populated capsule buttons expose their status at ${width} × ${height}`, async ({ page }) => {
  const fractions = Array.from({ length: 15 }, (_, i) => ({ ...batch.fractions[0], id: `invented-capsule-${i + 1}`, name: `z${i + 1}`, capsule_number: i + 1, capsule_label: `K${i + 1}`, status: fractionStatuses[i % fractionStatuses.length] }));
  const populated = { ...batch, fractions, capsule_map: Object.fromEntries(fractions.map(f => [String(f.capsule_number), f.id])) };
  await page.setViewportSize({ width, height }); await start(page, { fixtures: { [`/v1/tims/batches/${batch.id}`]: populated } }); await openBatch(page);
  for (const fraction of fractions) {
    await expect(page.getByRole('button', { name: `${fraction.capsule_label} ${fraction.name} · Zircon_1`, exact: true })).toHaveAttribute('title', new RegExp(statusWords(fraction.status)));
  }
  expect(await problems(page, 'Populated capsule grid')).toEqual([]);
});
for (const [width, height] of [[1440, 900], [1280, 800]]) for (const theme of ['light', 'dark']) {
  test(`three capsule pucks form a visible triangle at ${width} × ${height}, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await start(page, { store: { theme, themeChosen: true } }); await openBatch(page);
    await expectPuckBoardFits(page);
    await expectTimsBenchFills(page);
    await expect(page.getByRole('button', { name: 'Back to batches', exact: true })).toBeVisible();
    await expect(page.locator('.batch > header')).toContainText('Invented lab');
    await expect(page.locator('.tims > .workspace > .lab-bar')).toHaveCount(0);
    await expect(page.locator('.batch-status')).toBeAttached();
    expect(await page.locator('.batch-status').evaluate(node => node.getBoundingClientRect().height)).toBe(0);
    const board = page.getByRole('region', { name: 'Capsule grid', exact: true });
    const pucks = board.locator('section[aria-label^="Puck "]');
    await expect(pucks).toHaveCount(3);
    const boxes = await Promise.all([0, 1, 2].map(index => pucks.nth(index).boundingBox()));
    const [one, two, three] = boxes.map(box => box!);
    expect(Math.abs(one.y - two.y)).toBeLessThanOrEqual(1);
    expect(one.x + one.width).toBeLessThanOrEqual(two.x);
    expect(three.y).toBeGreaterThanOrEqual(Math.max(one.y + one.height, two.y + two.height));
    const area = (await board.boundingBox())!;
    expect(Math.abs(three.x + three.width / 2 - (area.x + area.width / 2))).toBeLessThanOrEqual(2);
    for (let index = 0; index < 3; index++) await expect(pucks.nth(index)).toBeInViewport({ ratio: 1 });
    for (const box of await board.locator('.well').all()) {
      const bounds = (await box.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(28);
    }
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.getByRole('region', { name: 'History', exact: true })).toBeVisible();
    await expectTimsBenchFills(page);
    await expectPuckBoardFits(page);
    expect(await problems(page, 'Triangle capsule board')).toEqual([]);
  });
}
test('an open batch retains the multi-lab selector and returns to the selected lab list', async ({ page }) => {
  const other = 'other-invented-lab';
  await start(page, { fixtures: {
    '/v1/labs': [{ id: lab, name: 'Invented lab', my_role: 'member' }, { id: other, name: 'Another invented lab', my_role: 'member' }],
    [`/v1/tims/capsule-sets?limit=500&lab=${other}`]: [],
    [`/v1/tims/recipes?limit=500&lab=${other}`]: [],
    [`/v1/tims/batches?limit=200&lab=${other}&order=-started_on`]: [],
  } });
  await openBatch(page);
  await expect(page.getByRole('combobox', { name: 'Lab', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Lab', exact: true }).selectOption(other);
  await expect(page.getByRole('region', { name: 'Chemistry batch', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Batch list', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Lab', exact: true })).toHaveValue(other);
});
test('step edits are durable while offline, then sent with an Idempotency-Key', async ({ page }) => {
  await start(page, { cached: { asOf: '2026-11-06T10:00:00Z', reason: 'unreachable' } }); await openBatch(page);
  const step = await openStep(page, 'Chemical abrasion'); await step.getByRole('button', { name: 'Edit step', exact: true }).click(); await step.getByLabel('Temperature (°C)').fill('195'); await step.getByRole('button', { name: 'Save step here' }).click();
  await expect(page.getByRole('complementary', { name: 'Saved edits' })).toContainText('1 edit not sent yet'); expect(await writes(page)).toHaveLength(0);
  const changed = { ...batch, steps: batch.steps.map(s => s.id === 'ca-step' ? { ...s, parameters: { ...s.parameters, temperature_c: 195 } } : s) };
  await reply(page, `PATCH /v1/tims/batches/${batch.id}/steps/ca-step`, 200, changed.steps[0]); await reply(page, `/v1/tims/batches/${batch.id}`, 200, changed); await reply(page, '/v1/accounts/me', 200, { id: 'invented-account', username: 'demo' });
  await page.evaluate(() => { (window as unknown as { __fake: { goOnline(): void } }).__fake.goOnline(); window.dispatchEvent(new Event('online')); }); await expect.poll(() => writes(page)).toHaveLength(1); const [write] = await writes(page);
  expect(write).toMatchObject({ method: 'PATCH', path: `/v1/tims/batches/${batch.id}/steps/ca-step`, body: { parameters: { temperature_c: 195 } } }); expect(write.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
  await expect(page.getByRole('complementary', { name: 'Saved edits' })).toHaveCount(0);
});
test('422 attention shows the server reason with Retry and Discard', async ({ page }) => {
  await start(page, { apiReplies: { [`PATCH /v1/tims/batches/${batch.id}/steps/ca-step`]: { status: 422, body: { code: 'validation_failed', detail: 'Invented temperature refusal.' } } } }); await openBatch(page);
  const step = await openStep(page, 'Chemical abrasion'); await step.getByRole('button', { name: 'Edit step' }).click(); await step.getByLabel('Temperature (°C)').fill('195'); await step.getByRole('button', { name: 'Save step here' }).click();
  const edits = page.getByRole('complementary', { name: 'Saved edits' }); await expect(edits).toContainText('1 needs your attention'); await edits.getByText('1 needs your attention').click(); await expect(edits).toContainText('422'); await expect(edits).toContainText('Invented temperature refusal.'); await expect(edits.getByRole('button', { name: 'Retry' })).toBeVisible(); await edits.getByRole('button', { name: 'Discard' }).click(); await expect(edits).toHaveCount(0);
});
test('spike picker reviews composition and non-current warning before applying a registered version', async ({ page }) => {
  await start(page); await openBatch(page); const step = await openStep(page, 'Spiking'); await step.getByRole('button', { name: 'Edit step' }).click(); await step.getByRole('button', { name: 'Choose spike version' }).click();
  const picker = page.getByRole('region', { name: 'Spike version picker' }); await expect(picker.getByLabel('Solution', { exact: true }).getByRole('option')).toHaveCount(solutions.length + 1); await picker.getByLabel('Solution', { exact: true }).selectOption('synthetic-solution'); await picker.getByLabel('Subfraction', { exact: true }).selectOption('synthetic-bottle'); await picker.getByRole('checkbox', { name: 'Show older versions' }).check(); await picker.getByLabel('Version', { exact: true }).selectOption(version.id);
  await expect(picker.getByRole('table', { name: 'Concentrations (mol/g)', exact: true })).toContainText('0.001'); await expect(picker).toContainText('uncertainty not given'); await expect(picker).toContainText('not current'); expect(await writes(page)).toHaveLength(0);
  await picker.getByRole('button', { name: 'Apply reviewed version' }).click(); await expect(picker).toHaveCount(0); expect(await writes(page)).toHaveLength(0);
  await expect(step).toContainText('Selected version: Synthetic spike · Master · v1 (superseded)');
  await step.getByRole('button', { name: 'Choose spike version' }).click();
  await expect(picker.getByLabel('Solution', { exact: true }).getByRole('option')).toHaveCount(solutions.length + 1);
  expect(await readCount(page, '/v1/tims/spikes?limit=500')).toBe(1);
});
test('shared spike composition fits a 320 px picker with full stored precision', async ({ page }) => {
  await start(page); await openBatch(page); const step = await openStep(page, 'Spiking');
  await step.getByRole('button', { name: 'Edit step' }).click();
  await step.getByRole('button', { name: 'Choose spike version' }).click();
  const picker = page.getByRole('region', { name: 'Spike version picker' });
  await picker.getByLabel('Solution', { exact: true }).selectOption(publishedVersion.solution_id);
  await picker.getByLabel('Subfraction', { exact: true }).selectOption(publishedVersion.subfraction_id);
  await picker.getByLabel('Version', { exact: true }).selectOption(publishedVersion.id);
  const composition = picker.getByRole('region', { name: 'Spike composition' });
  await expect(composition).toBeVisible();
  await composition.evaluate(e => { e.style.width = '320px'; e.style.maxWidth = '100%'; });
  await composition.getByRole('checkbox', { name: 'Full precision', exact: true }).check();
  expect(await composition.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  for (const table of await composition.getByRole('table').all()) expect(await table.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  expect(await writes(page)).toHaveLength(0);
});
async function openSpikes(page: Page) {
  await page.getByRole('navigation', { name: 'TIMS sections' }).getByRole('button', { name: 'Spikes', exact: true }).click();
  const composition = page.getByRole('region', { name: 'Spike composition' });
  await expect(composition).toBeVisible();
  return { composition, catalogue: page.getByRole('region', { name: 'Spike solutions' }), detail: page.getByRole('article', { name: 'Selected spike' }) };
}
test('spikes have a compact catalogue, a default master calibration and disclosed history', async ({ page }) => {
  await start(page); const { composition, catalogue, detail } = await openSpikes(page);
  for (const solution of solutions) await expect(catalogue.getByRole('button', { name: solution.name, exact: true })).toHaveCount(1);
  await expect(catalogue.getByRole('button', { name: solutions[0].name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(catalogue).toContainText('also REF-X'); await expect(catalogue).toContainText('2 current versions');
  const master = detail.getByRole('region', { name: 'EARTHTIME master solution', exact: true });
  await expect(master.getByRole('row', { name: /^View v1/ })).toHaveAttribute('aria-selected', 'true');
  await expect(composition.getByRole('heading')).toContainText([`${publishedVersion.solution_name} · EARTHTIME master solution · v1`, 'Reference']);
  await expect(page.getByRole('region', { name: 'Spikes', exact: true })).not.toContainText(/registry|overlay/);
  await expect(detail.getByRole('row', { name: /^View v2/ })).toBeHidden();
  await expect(detail.getByRole('row', { name: /^View v0/ })).toBeHidden();
  await detail.getByText('Show 2 earlier versions', { exact: true }).click();
  const earlier = detail.getByRole('row', { name: /^View v2/ }); await expect(earlier).toBeVisible();
  await earlier.focus(); await earlier.press('Enter');
  await expect(composition).toContainText('This version is not current.');
  await expect(composition.getByRole('table', { name: 'Ratios', exact: true })).toBeVisible();
  expect(await writes(page)).toHaveLength(0);
});
test('spike composition offers stored precision, wrapping references and cached version reads', async ({ page }) => {
  await start(page); const { composition, detail } = await openSpikes(page);
  await expect(composition).toContainText('0.8765432');
  await expect(composition).toContainText('uncertainty not given');
  await expect(composition.getByRole('cell', { name: '± 0.00679 %', exact: true })).toBeVisible();
  await composition.getByRole('checkbox', { name: 'Full precision', exact: true }).check();
  await expect(composition.getByRole('cell', { name: '0.876543219876', exact: true })).toBeVisible();
  await expect(composition.getByRole('cell', { name: '± 0.006789123 %', exact: true })).toBeVisible();
  await expect(composition.getByRole('cell', { name: '4.0000000007e-12', exact: true })).toBeVisible();
  const reference = composition.getByRole('region', { name: 'Reference', exact: true });
  expect(await reference.evaluate(e => getComputedStyle(e).textAlign)).not.toBe('center');
  await expect(reference).toContainText(publishedVersion.source_display); await expect(reference).toContainText(publishedVersion.locator);
  await expect(detail.getByText('Fable et al. 2022', { exact: true })).toHaveAttribute('title', publishedVersion.source_display);
  await detail.getByRole('row', { name: /^View v3/ }).click();
  await expect(composition).toContainText(labVersion.notes);
  await detail.getByRole('row', { name: /^View v1/ }).click();
  await expect(composition).toContainText(publishedVersion.notes);
  expect(await readCount(page, `/v1/tims/spikes/versions/${publishedVersion.id}`)).toBe(1);
  expect(await readCount(page, `/v1/tims/spikes/versions/${labVersion.id}`)).toBe(1);
  expect(await readCount(page, `/v1/tims/spikes/versions/${earlierVersion.id}`)).toBe(0);
  expect(await writes(page)).toHaveLength(0);
});
test('spike editing stays disclosed, preserves permissions and sends only status and notes', async ({ page }) => {
  await start(page, { apiReplies: { [`PATCH /v1/tims/spikes/versions/${labVersion.id}`]: { status: 200, body: { ...labVersion, status: 'superseded', notes: 'Invented revised note.' } } } });
  const { composition, detail } = await openSpikes(page);
  await expect(detail.getByRole('combobox', { name: 'Version status', exact: true })).toBeHidden();
  await detail.getByText('Edit status and notes', { exact: true }).click();
  await expect(detail.getByRole('combobox', { name: 'Version status', exact: true })).toBeDisabled();
  await expect(detail).toContainText('Only superusers may edit public versions.');
  await detail.getByRole('row', { name: /^View v3/ }).click(); await expect(composition).toContainText(labVersion.notes);
  await detail.getByText('Edit status and notes', { exact: true }).click();
  await detail.getByRole('combobox', { name: 'Version status', exact: true }).selectOption('superseded');
  await detail.getByLabel('Version notes', { exact: true }).fill('Invented revised note.');
  expect(await writes(page)).toHaveLength(0);
  await detail.getByRole('button', { name: 'Save version here', exact: true }).click();
  await expect.poll(() => writes(page)).toHaveLength(1);
  expect((await writes(page))[0]).toMatchObject({ method: 'PATCH', path: `/v1/tims/spikes/versions/${labVersion.id}`, body: { status: 'superseded', notes: 'Invented revised note.' } });
});
test('spike lists page on demand without reading a version per row', async ({ page }) => {
  const next = { ...solutions[1], id: 'invented-next-solution', name: 'Invented next spike' };
  await start(page, { apiReplies: {
    '/v1/tims/spikes?limit=500': { status: 200, body: [solutions[0]], nextCursor: 'invented-next' },
    '/v1/tims/spikes?limit=500&after=invented-next': { status: 200, body: [next] },
  } });
  const { catalogue, composition } = await openSpikes(page);
  await expect(catalogue.getByRole('button', { name: next.name, exact: true })).toHaveCount(0);
  expect(await readCount(page, '/v1/tims/spikes?limit=500&after=invented-next')).toBe(0);
  await catalogue.getByRole('button', { name: 'Load more spikes', exact: true }).click();
  await expect(catalogue.getByRole('button', { name: next.name, exact: true })).toBeVisible();
  await expect(composition).toContainText(publishedVersion.notes);
  expect(await readCount(page, '/v1/tims/spikes?limit=500&after=invented-next')).toBe(1);
  expect(await readCount(page, `/v1/tims/spikes/versions/${version.id}`)).toBe(0);
  expect(await writes(page)).toHaveLength(0);
});
test('new recipes and reset fill guidebook defaults for review before saving', async ({ page }) => {
  await start(page); await page.getByRole('navigation', { name: 'TIMS sections' }).getByRole('button', { name: 'Recipes', exact: true }).click(); await page.getByRole('button', { name: 'New recipe', exact: true }).click(); const editor = page.getByRole('region', { name: 'Recipe editor' }); await expect(editor.getByLabel('Temperature (°C)').first()).toHaveValue('900'); await expect(editor.getByLabel('Duration (h)').first()).toHaveValue('60');
  await editor.getByText('Column protocol', { exact: true }).click();
  await expect(editor.getByRole('link', { name: 'Boise State U-Th-Pb Lab Guidebook, U-Pb separation (HCl anion)', exact: true })).toHaveAttribute('href', guidebookUrl);
  await expect(editor.getByRole('button', { name: 'Print column protocol' })).toHaveCount(0);
  expect(await writes(page)).toHaveLength(0);
  await editor.getByRole('button', { name: 'Close recipe' }).click(); await page.getByRole('button', { name: recipe.name, exact: true }).click(); await editor.getByRole('button', { name: 'Reset to guidebook defaults' }).click(); await expect(editor.getByLabel('Temperature (°C)').first()).toHaveValue('900'); expect(await writes(page)).toHaveLength(0);
});
const guidebookUrl = 'https://www.boisestate.edu/earth-isotope/labshare/laboratory-handbooks/';
const columnStep = {
  ...batch.steps[0], id: 'column-step', ordinal: 4, method_code: 'SP-TIMS-COL', method_name: 'Column chemistry',
  parameters: { scheme: 'HCl anion' },
  parameter_definitions: [{ name: 'scheme', meaning: 'Scheme', type: 'choice', choices: ['HCl anion', 'HBr-HCl'] }],
  notes: 'Invented batch note',
};

test('column reference opens externally and starts an empty batch copy that can be saved and printed', async ({ page }) => {
  const populated = { ...batch, steps: [...batch.steps, columnStep] };
  const copy = 'Invented batch protocol\nChecklist:\nRecord the trial identifier.';
  const saved = { ...columnStep, notes: writeColumnNotes(columnStep.notes, copy) };
  await start(page, { fixtures: { [`/v1/tims/batches/${batch.id}`]: populated }, apiReplies: {
    [`PATCH /v1/tims/batches/${batch.id}/steps/${columnStep.id}`]: { status: 200, body: saved },
  } });
  await openBatch(page);
  const step = await openStep(page, 'Column chemistry');
  await step.getByText('Column protocol', { exact: true }).click();
  const link = step.getByRole('link', { name: 'Boise State U-Th-Pb Lab Guidebook, U-Pb separation (HCl anion)', exact: true });
  await expect(link).toHaveAttribute('href', guidebookUrl);
  await expect(step.getByRole('button', { name: 'Print column protocol' })).toHaveCount(0);
  await expect(step.locator('.column-protocol')).toHaveCount(0);
  await link.click();
  await expect.poll(() => page.evaluate(url => (window as unknown as { __fake: { calls: [string, { url?: string }][] } }).__fake.calls.some(([command, args]) => command === 'plugin:opener|open_url' && args?.url === url), guidebookUrl)).toBe(true);
  await step.getByRole('button', { name: 'Edit step', exact: true }).click();
  await step.getByText('Column protocol', { exact: true }).click();
  await step.getByRole('button', { name: 'Add protocol copy', exact: true }).click();
  await expect(step.getByLabel('Protocol text')).toHaveValue('');
  expect(await writes(page)).toHaveLength(0);
  await step.getByLabel('Protocol text').fill(copy);
  await expect(step.getByRole('button', { name: 'Print column protocol' })).toHaveCount(0);
  await reply(page, `/v1/tims/batches/${batch.id}`, 200, { ...populated, steps: [...batch.steps, saved] });
  await step.getByRole('button', { name: 'Save step here' }).click();
  await expect.poll(() => writes(page)).toHaveLength(1);
  expect((await writes(page))[0]).toMatchObject({ method: 'PATCH', path: `/v1/tims/batches/${batch.id}/steps/${columnStep.id}`, body: { notes: saved.notes } });
  await step.getByText('Column protocol · edited', { exact: true }).click();
  await expect(step.getByRole('heading', { name: 'Invented batch protocol', exact: true })).toBeVisible();
  await expect(step.locator('.column-protocol')).toContainText('Record the trial identifier.');
  await expect(step.locator('.attribution')).toHaveText('Boise State Isotope Geology Laboratory · U-Th-Pb Lab Guidebook · edited copy');
  await page.evaluate(() => { window.print = () => { window.dispatchEvent(new Event('protocol-print-requested')); }; });
  await step.getByRole('button', { name: 'Print column protocol' }).click();
  await expect(step.locator('.column-protocol')).toHaveAttribute('data-print', '');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(step.locator('.column-protocol')).not.toHaveAttribute('data-print', '');
});

test('capsules retain inherited and saved copies and start empty when their scheme has no copy', async ({ page }) => {
  const batchCopy = 'Invented inherited protocol\nBatch checklist.';
  const capsuleCopy = 'Invented capsule protocol\nCapsule checklist.';
  const populated = { ...batch, steps: [...batch.steps, { ...columnStep, notes: writeColumnNotes(columnStep.notes, batchCopy) }] };
  const record = { ...batch.fraction_step_records[0], id: 'invented-column-record', step_id: columnStep.id, parameters: {}, outcome: '', outcome_note: writeColumnNotes('Invented capsule note', capsuleCopy) };
  await start(page, { fixtures: { [`/v1/tims/batches/${batch.id}`]: populated }, apiReplies: {
    [`PUT /v1/tims/batches/${batch.id}/fractions/${record.fraction_id}/steps/${columnStep.id}`]: { status: 200, body: record },
  } });
  await openBatch(page);
  await page.getByRole('button', { name: /^K1 z1(?: · |$)/ }).click();
  const drawer = page.getByRole('region', { name: 'Capsule details' });
  await drawer.getByLabel('Capsule step', { exact: true }).selectOption(columnStep.id);
  await drawer.getByText('Column protocol · edited', { exact: true }).click();
  await expect(drawer.getByRole('heading', { name: 'Invented inherited protocol', exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Print column protocol' })).toBeVisible();
  await drawer.getByRole('button', { name: 'Edit protocol copy', exact: true }).click();
  await expect(drawer.getByLabel('Protocol text')).toHaveValue(batchCopy);
  await drawer.getByLabel('Protocol text').fill(capsuleCopy);
  await drawer.getByLabel('Step note', { exact: true }).fill('Invented capsule note');
  await reply(page, `/v1/tims/batches/${batch.id}`, 200, { ...populated, fraction_step_records: [...batch.fraction_step_records, record] });
  await drawer.getByRole('button', { name: 'Save capsule record here' }).click();
  await expect.poll(() => writes(page)).toHaveLength(1);
  expect((await writes(page))[0]).toMatchObject({ method: 'PUT', body: { outcome_note: writeColumnNotes('Invented capsule note', capsuleCopy) } });
  await drawer.getByRole('button', { name: 'Preview protocol', exact: true }).click();
  await expect(drawer.getByRole('heading', { name: 'Invented capsule protocol', exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: 'Use inherited protocol', exact: true }).click();
  await expect(drawer.getByRole('heading', { name: 'Invented inherited protocol', exact: true })).toBeVisible();
  await drawer.getByLabel('Override Scheme', { exact: true }).check();
  await drawer.getByRole('combobox', { name: 'Scheme', exact: true }).selectOption('HBr-HCl');
  await expect(drawer.getByRole('link', { name: 'Boise State U-Th-Pb Lab Guidebook, U-Pb separation (HBr-HCl)', exact: true })).toHaveAttribute('href', guidebookUrl);
  await expect(drawer.getByRole('button', { name: 'Print column protocol' })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Add protocol copy', exact: true }).click();
  await expect(drawer.getByLabel('Protocol text')).toHaveValue('');
  expect(await writes(page)).toHaveLength(1);
});

const inventedProtocol: ColumnProtocolOut = {
  id: 'invented-lab-protocol', lab_id: lab, scheme: 'HCl anion', title: 'Invented column instructions',
  text: 'Invented column\nStep A: rinse twice.', attribution: 'Invented isotope laboratory',
  source_url: 'https://example.org/invented-protocol', revision: 3,
  created_at: '2026-11-23T10:00:00Z', updated_at: '2026-11-23T11:00:00Z', created_by_id: 'invented-account',
};
const protocolBatch = { ...batch, steps: [...batch.steps, columnStep] };
const ownerLab = [{ id: lab, name: 'Invented lab', my_role: 'owner' }];
async function openLabProtocols(page: Page) {
  await page.getByRole('navigation', { name: 'TIMS sections' }).getByRole('button', { name: 'Recipes', exact: true }).click();
  return page.getByRole('region', { name: 'Lab column protocols', exact: true });
}
test('a new batch inherits its lab protocol, prints it, and seeds batch and capsule copies', async ({ page }) => {
  const created = { ...protocolBatch, id: 'invented-new-batch', fractions: protocolBatch.fractions.map(row => ({ ...row, batch_id: 'invented-new-batch' })) };
  await start(page, { fixtures: { [labProtocolsPath]: [inventedProtocol], [`/v1/tims/batches/${created.id}`]: created },
    apiReplies: { 'POST /v1/tims/batches': { status: 201, body: created } } });
  await page.getByRole('button', { name: 'New batch', exact: true }).click();
  await page.getByRole('form', { name: 'New batch' }).getByLabel('Active capsule set').selectOption(batch.capsule_set_id);
  await page.getByRole('button', { name: 'Create batch', exact: true }).click();
  const step = await openStep(page, 'Column chemistry');
  await step.getByText('Column protocol · lab protocol rev 3', { exact: true }).click();
  await expect(step.locator('.column-protocol')).toContainText('Step A: rinse twice.');
  await expect(step.getByRole('button', { name: 'Print column protocol' })).toBeEnabled();
  await expect(step.getByRole('link', { name: inventedProtocol.title, exact: true })).toHaveAttribute('href', inventedProtocol.source_url);
  await expect(step.locator('.attribution')).toHaveText(inventedProtocol.attribution);
  await step.getByRole('button', { name: 'Edit step', exact: true }).click();
  await step.getByText('Column protocol · lab protocol rev 3', { exact: true }).click();
  await step.getByRole('button', { name: 'Add protocol copy', exact: true }).click();
  await expect(step.getByLabel('Protocol text')).toHaveValue(inventedProtocol.text);
  await step.getByRole('button', { name: 'Use inherited protocol', exact: true }).click();
  await step.getByRole('button', { name: 'Cancel edit', exact: true }).click();
  await page.getByRole('radio', { name: 'Capsules', exact: true }).click();
  await page.getByRole('button', { name: /^K1 z1(?: · |$)/ }).click();
  const capsule = page.getByRole('region', { name: 'Capsule details' });
  await capsule.getByLabel('Capsule step', { exact: true }).selectOption(columnStep.id);
  await capsule.getByText('Column protocol · lab protocol rev 3', { exact: true }).click();
  await capsule.getByRole('button', { name: 'Add protocol copy', exact: true }).click();
  await expect(capsule.getByLabel('Protocol text')).toHaveValue(inventedProtocol.text);
  await capsule.getByLabel('Protocol text').fill('Invented capsule override\nStep B: record the trial.');
  await capsule.getByRole('button', { name: 'Preview protocol', exact: true }).click();
  await expect(capsule.getByRole('heading', { name: 'Invented capsule override', exact: true })).toBeVisible();
  await expect(capsule.locator('.attribution')).toHaveText('Invented isotope laboratory · edited copy');
  await capsule.getByRole('button', { name: 'Use inherited protocol', exact: true }).click();
  await expect(capsule.getByRole('heading', { name: 'Invented column', exact: true })).toBeVisible();
  expect(await readCount(page, labProtocolsPath)).toBe(1);
});
test('saved capsule text overrides batch and lab protocols', async ({ page }) => {
  const record = { ...batch.fraction_step_records[0], id: 'invented-column-record', step_id: columnStep.id,
    outcome_note: writeColumnNotes('', 'Invented saved capsule\nStep C: log the run.') };
  await start(page, { fixtures: { [labProtocolsPath]: [inventedProtocol], [`/v1/tims/batches/${batch.id}`]: {
    ...protocolBatch, steps: [...batch.steps, { ...columnStep, notes: writeColumnNotes('', 'Invented batch copy') }],
    fraction_step_records: [...batch.fraction_step_records, record],
  } } });
  await openBatch(page); await page.getByRole('button', { name: /^K1 z1(?: · |$)/ }).click();
  const capsule = page.getByRole('region', { name: 'Capsule details' });
  await capsule.getByLabel('Capsule step', { exact: true }).selectOption(columnStep.id);
  await capsule.getByText('Column protocol · edited', { exact: true }).click();
  await expect(capsule.getByRole('heading', { name: 'Invented saved capsule', exact: true })).toBeVisible();
  await expect(capsule.getByRole('button', { name: 'Print column protocol' })).toBeEnabled();
  await capsule.getByRole('button', { name: 'Use inherited protocol', exact: true }).click();
  await expect(capsule.getByRole('heading', { name: 'Invented batch copy', exact: true })).toBeVisible();
});
test('an owner saves the loaded revision online and reads protocol history', async ({ page }) => {
  const saved = { ...inventedProtocol, revision: 4, text: 'Invented revised column\nStep D: label the trial.' };
  await start(page, { fixtures: { [labProtocolsPath]: [inventedProtocol], '/v1/labs': ownerLab,
    [`/v1/history/column-protocol/${inventedProtocol.id}`]: [{ id: 'invented-protocol-history', actor: 'Invented owner', action: 'updated' }] },
    apiReplies: { [`PATCH /v1/tims/column-protocols/${inventedProtocol.id}`]: { status: 200, body: saved } } });
  const area = await openLabProtocols(page), row = area.getByRole('article', { name: 'HCl anion lab protocol', exact: true });
  await expect(row).toContainText('Revision 3'); await expect(row).toContainText(inventedProtocol.updated_at);
  await row.getByRole('button', { name: 'History', exact: true }).click();
  await expect(row.getByRole('region', { name: 'History' })).toContainText('Invented owner');
  await row.getByRole('button', { name: 'Edit HCl anion lab protocol', exact: true }).click();
  await area.getByLabel('Lab protocol text', { exact: true }).fill(saved.text);
  await reply(page, labProtocolsPath, 200, [saved]);
  await area.getByRole('button', { name: 'Save lab protocol', exact: true }).click();
  await expect.poll(() => writes(page)).toHaveLength(1);
  expect((await writes(page))[0]).toMatchObject({ method: 'PATCH', path: `/v1/tims/column-protocols/${inventedProtocol.id}`,
    body: { revision: 3, text: saved.text, title: saved.title, attribution: saved.attribution, source_url: saved.source_url } });
  await expect(row).toContainText('Revision 4');
  await expect(area.getByRole('form', { name: 'Lab protocol editor' })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Saved edits' })).toHaveCount(0);
});
test('an owner creates a missing scheme and cannot save empty protocol text', async ({ page }) => {
  const created = { ...inventedProtocol, scheme: 'HBr-HCl', revision: 1 };
  await start(page, { fixtures: { '/v1/labs': ownerLab }, apiReplies: { 'POST /v1/tims/column-protocols': { status: 201, body: created } } });
  const area = await openLabProtocols(page);
  await area.getByRole('button', { name: 'Create HBr-HCl lab protocol', exact: true }).click();
  await expect(area.getByRole('button', { name: 'Save lab protocol' })).toBeDisabled();
  await area.getByLabel('Lab protocol text', { exact: true }).fill(inventedProtocol.text);
  await reply(page, labProtocolsPath, 200, [created]);
  await area.getByRole('button', { name: 'Save lab protocol' }).click();
  await expect.poll(() => writes(page)).toHaveLength(1);
  expect((await writes(page))[0]).toMatchObject({ method: 'POST', body: { lab_id: lab, scheme: 'HBr-HCl', text: inventedProtocol.text } });
});
test('members see lab protocols read-only and can print the saved text offline', async ({ page }) => {
  await start(page, { cached: { asOf: '2026-11-23T11:00:00Z', reason: 'unreachable' }, fixtures: { [labProtocolsPath]: [inventedProtocol] } });
  const area = await openLabProtocols(page);
  await expect(area).toContainText("Only lab owners can edit the lab's column protocol.");
  await expect(area.getByRole('button', { name: /^(Edit|Create) .* lab protocol$/ })).toHaveCount(0);
  const row = area.getByRole('article', { name: 'HCl anion lab protocol', exact: true });
  await row.getByText('Column protocol · lab protocol rev 3', { exact: true }).click();
  await expect(row.locator('.column-protocol')).toContainText('Step A: rinse twice.');
  await expect(row.getByRole('button', { name: 'Print column protocol' })).toBeEnabled();
  expect(await writes(page)).toHaveLength(0);
});
test('stale protocol saves require reloading the newer revision before editing', async ({ page }) => {
  const path = `/v1/tims/column-protocols/${inventedProtocol.id}`;
  await start(page, { fixtures: { [labProtocolsPath]: [inventedProtocol], '/v1/labs': ownerLab },
    apiReplies: { [`PATCH ${path}`]: { status: 409, body: { code: 'stale_revision', detail: 'Invented newer revision exists.' } } } });
  const area = await openLabProtocols(page);
  await area.getByRole('button', { name: 'Edit HCl anion lab protocol', exact: true }).click();
  await area.getByLabel('Lab protocol text', { exact: true }).fill('Invented conflicting draft');
  await area.getByRole('button', { name: 'Save lab protocol' }).click();
  await expect(area).toContainText('Someone else saved a newer revision; reload it before editing.');
  await expect(area.getByRole('button', { name: 'Save lab protocol' })).toBeDisabled();
  const newer = { ...inventedProtocol, revision: 4, text: 'Invented newer column' };
  await reply(page, labProtocolsPath, 200, [newer]); await area.getByRole('button', { name: 'Reload lab protocols' }).click();
  await expect(area.getByLabel('Lab protocol text', { exact: true })).toHaveValue(newer.text);
  await reply(page, `PATCH ${path}`, 200, { ...newer, revision: 5 });
  await reply(page, labProtocolsPath, 200, [{ ...newer, revision: 5 }]);
  await area.getByRole('button', { name: 'Save lab protocol' }).click();
  await expect.poll(() => writes(page)).toHaveLength(2);
  expect((await writes(page))[1]).toMatchObject({ body: { revision: 4 } });
});
test('servers without column protocols retain the link-only fallback', async ({ page }) => {
  await start(page, { fixtures: { [`/v1/tims/batches/${batch.id}`]: protocolBatch },
    apiReplies: { [labProtocolsPath]: { status: 404, body: { detail: 'Invented older server.' } } } });
  await openBatch(page); const step = await openStep(page, 'Column chemistry');
  await step.getByText('Column protocol', { exact: true }).click();
  await expect(step.getByRole('link')).toHaveAttribute('href', guidebookUrl);
  await expect(step.getByRole('button', { name: 'Print column protocol' })).toHaveCount(0);
  await expect(step.locator('.column-protocol')).toHaveCount(0);
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
  await start(page); await openBatch(page); await page.getByRole('button', { name: /^K1 z1(?: · |$)/ }).click(); await page.getByRole('tab', { name: 'Home', exact: true }).click(); await page.getByRole('tab', { name: 'TIMS', exact: true }).click(); await expect(page.getByRole('region', { name: 'Capsule details' })).toBeVisible();
  await page.getByRole('navigation', { name: 'TIMS sections' }).getByRole('button', { name: 'Recipes', exact: true }).click();
  await page.evaluate(() => (window as unknown as { __emit(event: string, payload: unknown): Promise<void> }).__emit('lab-bridge://open', { source: 'sessions', url: 'upbdb://tims/batch/batch-synthetic' }));
  await expect(page.getByRole('heading', { name: 'Krogh (K)', exact: true })).toBeVisible();
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
  await start(page, { fixtures: { '/v1/labs': [{ id: lab, name: 'Invented lab', my_role: 'member' }, { id: other, name: 'Another invented lab', my_role: 'member' }], [`/v1/tims/capsule-sets?limit=500&lab=${other}`]: [], [`/v1/tims/recipes?limit=500&lab=${other}`]: [], [`/v1/tims/batches?limit=200&lab=${other}&order=-started_on`]: [] }, apiReplies: { 'POST /v1/tims/batches': { status: 200, body: { ...batch, id: 'earlier-created-batch' } } } });
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
    await page.setViewportSize({ width, height }); await start(page, { store: { theme, themeChosen: true } }); await openBatch(page); await expectTimsBenchFills(page); await page.getByRole('button', { name: /^K1 z1(?: · |$)/ }).click(); await expect(page.getByRole('img', { name: 'Grain outline and LA spot' }).first()).toBeAttached(); expect(await problems(page, 'TIMS batch')).toEqual([]);
    const capsule = page.getByRole('region', { name: 'Capsule details' });
    await capsule.getByText('Fraction status and notes', { exact: true }).click();
    expect(await problems(page, 'TIMS fraction form')).toEqual([]);
    await expect(capsule.getByLabel('Status', { exact: true })).toBeVisible();
    await expect(capsule.getByLabel('Status', { exact: true })).toHaveAccessibleDescription('Record a spike version and positive weight before marking this capsule spiked or later.');
    await expect(capsule.getByLabel('Status', { exact: true }).getByRole('option', { name: 'spiked', exact: true })).toHaveJSProperty('disabled', true);
    const saveFraction = capsule.getByRole('button', { name: 'Save fraction here', exact: true });
    // Capsule actions stay visible while the form scrolls independently.
    await expect(saveFraction).toBeInViewport({ ratio: 1 });
    const saveBox = await saveFraction.boundingBox(), capsuleBox = await capsule.boundingBox();
    expect(saveBox).not.toBeNull(); expect(capsuleBox).not.toBeNull();
    expect(saveBox!.y).toBeGreaterThanOrEqual(capsuleBox!.y);
    expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(capsuleBox!.y + capsuleBox!.height);
    await expect(capsule.getByRole('button', { name: 'Next capsule' })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('region', { name: 'GrainAtlas picker' }).getByRole('group', { name: 'Picker actions' })).toBeInViewport({ ratio: 1 });
    // K1 has no spike; K2 has a pinned version and positive recorded weight.
    // Switching capsules must update both the explanation and native option state.
    await capsule.getByRole('button', { name: 'Next capsule', exact: true }).click();
    await expect(capsule.getByRole('heading', { level: 3 })).toHaveText('K2 · z2');
    if (!await capsule.getByLabel('Status', { exact: true }).isVisible()) await capsule.getByText('Fraction status and notes', { exact: true }).click();
    await expect(capsule.getByLabel('Status', { exact: true })).toHaveAccessibleDescription('');
    await expect(capsule.getByLabel('Status', { exact: true }).getByRole('option', { name: 'spiked', exact: true })).toHaveJSProperty('disabled', false);
    for (const name of ['Recipes', 'Capsule sets', 'Spikes', 'Import pick notes']) {
      await page.getByRole('navigation', { name: 'TIMS sections' }).getByRole('button', { name, exact: true }).click();
      if (name === 'Spikes') {
        const composition = page.getByRole('region', { name: 'Spike composition' });
        await expect(composition).toBeVisible();
        await composition.getByRole('checkbox', { name: 'Full precision', exact: true }).check();
        const spike = page.getByRole('article', { name: 'Selected spike' });
        await spike.getByText('Show 2 earlier versions', { exact: true }).click();
        await spike.getByText('Edit status and notes', { exact: true }).click();
        expect(await composition.getByRole('region', { name: 'Reference' }).evaluate(e => getComputedStyle(e).textAlign)).not.toBe('center');
      }
      expect(await problems(page, `TIMS ${name}`)).toEqual([]);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

// Invented samples, grains and spots for the picker; no project data.
const searchMounts = [
  { id: 'mount-zz02', label: 'Invented ZZ01 comparison mount', atlas: null },
  { id: 'mount-zz01', label: 'Invented ZZ01 spot mount', atlas: null },
];
const searchGrain = { ...inventedElements.grains[0], id: 'atlas-zz195', server_id: 'grain-zz195', label: '001_ZZ01/12', sample: 'ZZ01' };
const searchSpot = { ...inventedElements.spots[0], id: 'atlas-zz195', server_id: 'spot-zz195', grain_id: searchGrain.id, name: 'ZZ01_S_195' };
const searchElements = {
  ...inventedElements,
  grains: [searchGrain, { ...searchGrain, id: 'atlas-zz1950', server_id: 'grain-zz1950', label: '002_ZZ01/12' },
    { ...searchGrain, id: 'atlas-zz-empty', server_id: 'grain-zz-empty', label: '003_ZZ03/12', sample: 'ZZ03' }],
  spots: [searchSpot, { ...searchSpot, id: 'atlas-zz1950', server_id: 'spot-zz1950', grain_id: 'atlas-zz1950', name: 'ZZ01_S_1950' }],
};
const otherSearchElements = { ...inventedElements,
  grains: [{ ...searchGrain, sample: 'ZZ02', label: '001_ZZ02/12' }],
  spots: [{ ...searchSpot, name: 'ZZ02_S_641' }],
};
const spotSearchFixtures = {
  '/v1/mounts?limit=50': searchMounts,
  '/v1/mounts?limit=5&q=ZZ01': searchMounts,
  '/v1/mounts?limit=5&q=ZZ02': searchMounts,
  '/v1/mounts/mount-zz01/elements': searchElements,
  '/v1/mounts/mount-zz02/elements': otherSearchElements,
};
async function chooseMount(picker: Locator, name: string) {
  await picker.getByRole('combobox', { name: 'Mount', exact: true }).fill(name);
  await picker.getByRole('option', { name: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' ') }).click();
}
async function openSpotPicker(page: Page) {
  await openBatch(page);
  await page.getByRole('button', { name: 'K3 empty', exact: true }).click();
  await page.getByRole('button', { name: 'GrainAtlas', exact: true }).click();
  return page.getByRole('region', { name: 'GrainAtlas picker' });
}
for (const [width, height] of [[1280, 800], [1440, 900]]) {
  test(`spot searches select ZZ01_S_195 and label the capsule at ${width} × ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const template = batch.fractions[0];
    const added = { ...template, id: 'fraction-zz195', name: 'z3', capsule_number: 3, capsule_label: 'K3', sample: { id: 'sample-zz01', name: 'ZZ01' },
      sources: [{ ...template.sources[0], grain_id: searchGrain.server_id, atlas_grain_id: searchGrain.id, grain_label: searchGrain.label,
        mount_id: 'mount-zz01', mount_label: searchMounts[1].label, spot_id: searchSpot.server_id, atlas_spot_id: searchSpot.id, spot_label: searchSpot.name }] };
    await start(page, { fixtures: spotSearchFixtures, apiReplies: { 'POST /v1/fractions': { status: 201, body: added } } });
    const picker = await openSpotPicker(page);
    await chooseMount(picker, 'Invented ZZ01 spot mount');
    const filter = picker.getByRole('searchbox', { name: 'Filter grains' });
    await expect(filter).toHaveAttribute('placeholder', 'Spot, grain or sample');
    await picker.getByRole('combobox', { name: 'Sample', exact: true }).selectOption('ZZ03');
    await expect(picker.getByRole('button', { name: /003_ZZ03\/12/ })).toBeVisible();
    await picker.getByRole('combobox', { name: 'Sample', exact: true }).selectOption('');
    for (const query of ['195', 'S 195']) {
      await filter.fill(query);
      await expect(picker.getByRole('button', { name: /ZZ01_S_1950/ })).toHaveCount(0);
      await picker.getByRole('button', { name: /ZZ01_S_195 · grain 001_ZZ01\/12/ }).click();
      await expect(picker.getByLabel('ZZ01_S_195', { exact: true })).toBeChecked();
      await picker.getByRole('button', { name: 'Choose another', exact: true }).click();
    }
    expect(await readCount(page, '/v1/mounts?limit=5&q=ZZ01')).toBe(0);
    expect(await readCount(page, '/v1/mounts/mount-zz01/elements')).toBe(1);
    expect(await problems(page, 'TIMS spot picker')).toEqual([]);
    await picker.getByRole('button', { name: /ZZ01_S_195 · grain 001_ZZ01\/12/ }).click();
    await picker.getByRole('button', { name: 'Load into K3', exact: true }).click();
    const capsule = page.getByRole('button', { name: 'K3 z3 · ZZ01_S_195', exact: true });
    await expect(capsule).toHaveAttribute('title', /ZZ01_S_195/);
    await expect(page.getByLabel('Linked LA spots')).toContainText('ZZ01_S_195');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await problems(page, 'TIMS spot capsule')).toEqual([]);
  });
}
test('sample submit opens the matching mount among two and preselects its sample', async ({ page }) => {
  await start(page, { fixtures: spotSearchFixtures });
  const picker = await openSpotPicker(page);
  const filter = picker.getByRole('searchbox', { name: 'Filter grains' });
  await filter.fill('ZZ01');
  expect(await readCount(page, '/v1/mounts?limit=5&q=ZZ01')).toBe(0);
  await filter.press('Enter');
  await expect(picker.getByRole('combobox', { name: 'Mount', exact: true })).toHaveValue('Invented ZZ01 spot mount');
  await expect(picker.getByRole('combobox', { name: 'Sample', exact: true })).toHaveValue('ZZ01');
  await expect(picker.getByRole('button', { name: /ZZ01_S_195 · grain/ })).toBeVisible();
  expect(await readCount(page, '/v1/mounts?limit=5&q=ZZ01')).toBe(1);
  // A different sample also changes mounts when one is already open.
  await filter.fill('ZZ02');
  await picker.getByRole('button', { name: 'Find spot', exact: true }).click();
  await expect(picker.getByRole('combobox', { name: 'Mount', exact: true })).toHaveValue('Invented ZZ01 comparison mount');
  await expect(picker.getByRole('combobox', { name: 'Sample', exact: true })).toHaveValue('ZZ02');
  expect(await readCount(page, '/v1/mounts/mount-zz01/elements')).toBe(1);
  expect(await readCount(page, '/v1/mounts/mount-zz02/elements')).toBe(1);
});
test('ambiguous spot matches list mount choices with full spot names', async ({ page }) => {
  await start(page, { fixtures: { ...spotSearchFixtures, '/v1/mounts/mount-zz02/elements': searchElements } });
  const picker = await openSpotPicker(page);
  await picker.getByRole('searchbox', { name: 'Filter grains' }).fill('ZZ01_S_195');
  await picker.getByRole('button', { name: 'Find spot', exact: true }).click();
  await expect(picker.getByRole('combobox', { name: 'Mount', exact: true })).toHaveValue('');
  await expect(picker.getByRole('button', { name: 'Invented ZZ01 comparison mount · ZZ01_S_195', exact: true })).toBeVisible();
  await picker.getByRole('button', { name: 'Invented ZZ01 spot mount · ZZ01_S_195', exact: true }).click();
  await expect(picker.getByRole('combobox', { name: 'Mount', exact: true })).toHaveValue('Invented ZZ01 spot mount');
  await expect(picker.getByRole('combobox', { name: 'Sample', exact: true })).toHaveValue('ZZ01');
  expect(await readCount(page, '/v1/mounts/mount-zz01/elements')).toBe(1);
});

const looseGrainSource: SourceOut = { ...batch.fractions[0].sources[0], grain_id: null, atlas_grain_id: null, spot_id: null, atlas_spot_id: null,
  mount_id: null, mount_label: null, grain_label: null, spot_label: null,
  loose_grain_id: '00000000-0000-4000-8000-000000000007', loose_grain_label: 'LG-invented-1' };

for (const [width, height] of [[1440, 900], [1280, 800]]) test(`loose-grain capsule labels and disabled mounted-grain actions at ${width} × ${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  const old = batch.fractions[0];
  const retired = { ...looseGrainSource, id: 'retired-loose-source', loose_grain_label: 'LG-invented-old', retired_at: '2026-11-24T12:00:00Z' };
  const medium = { ...old, id: 'medium-loose-fraction', name: 'z3', capsule_number: 3, capsule_label: 'K3', sources: [{ ...looseGrainSource, id: 'medium-loose-source', loose_grain_label: 'H12-z3' }] };
  const shortFraction = { ...old, id: 'short-loose-fraction', name: 'z4', capsule_number: 4, capsule_label: 'K4', sources: [{ ...looseGrainSource, id: 'short-loose-source', loose_grain_label: 'LG-7' }] };
  const looseBatch = { ...batch, capsule_map: { ...batch.capsule_map, '3': medium.id, '4': shortFraction.id }, fractions: [{ ...old, sources: [looseGrainSource], replaced_sources: [retired],
    replaces: { id: 'replaced-loose-fraction', name: 'z-old', sample_name: old.sample.name, retired_at: retired.retired_at, retired_by_name: 'Invented analyst', sources: [retired] } }, batch.fractions[1], medium, shortFraction] };
  await start(page, { fixtures: { [`/v1/tims/batches/${batch.id}`]: looseBatch } });
  await openBatch(page);
  const well = page.getByRole('button', { name: /^K1 z1 · Loose grain LG-invented-1/ });
  await expect(well.locator('.well')).toHaveText('LG-invented-1');
  await expect(well).toHaveAttribute('title', /Loose grain LG-invented-1/);
  await expect(well.locator('.fraction-mark')).toHaveAttribute('title', 'Loose grain LG-invented-1');
  await expect(well).toHaveAttribute('data-loose-overflow', 'true');
  await expect(well.locator('.well .fraction-mark')).toBeHidden();
  await expect(well.locator('.capsule-label .loose-label')).toBeVisible();
  await expect(well.locator('.capsule-label .loose-label')).toHaveText('LG-invented-1');
  await expect(well.locator('.capsule-label .loose-label')).toHaveAttribute('title', 'Loose grain LG-invented-1');
  const short = page.getByRole('button', { name: /^K4 z4 · Loose grain LG-7/ });
  await expect(short).toHaveAttribute('data-loose-overflow', 'false');
  await expect(short.locator('.well .fraction-mark')).toBeVisible();
  await expect(short.locator('.capsule-label .loose-label')).toBeHidden();
  expect(await short.locator('.well .fraction-mark').evaluate(node => node.scrollWidth <= node.parentElement!.clientWidth - 4)).toBe(true);
  const mediumWell = page.getByRole('button', { name: /^K3 z3 · Loose grain H12-z3/ });
  // Check the rendered font, including fallback fonts on the supervisor's OS.
  const mediumOverflows = await mediumWell.evaluate(node => {
    const mark = node.querySelector<HTMLElement>('.loose-grain-mark')!, well = node.querySelector<HTMLElement>('.well')!;
    return mark.getBoundingClientRect().width > well.clientWidth - 4;
  });
  await expect(mediumWell).toHaveAttribute('data-loose-overflow', String(mediumOverflows));
  await expect(mediumWell.locator(mediumOverflows ? '.capsule-label .loose-label' : '.well .fraction-mark')).toBeVisible();
  expect(await mediumWell.locator('.capsule-label .loose-label').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expectPuckBoardFits(page);
  await well.click();
  const capsule = page.getByRole('region', { name: 'Capsule details' });
  const card = capsule.getByRole('article');
  await expect(card).toContainText('Loose grain · Grain: LG-invented-1');
  await expect(card).not.toContainText('Not recorded');
  await expect(card.getByText('Loose grain · No GrainAtlas image.', { exact: true })).toBeVisible();
  expect(await card.locator('.loose-image').evaluate(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }))).toEqual({ width: 104, height: 104 });
  await expect(card.getByTestId('tims-grain-image')).toHaveCount(0);
  await expect(capsule.getByText('Replaced Loose grain · Grain: LG-invented-old', { exact: true })).toBeVisible();
  await expect(capsule.getByText(/^Replaced Loose grain · Grain: LG-invented-old · Unknown viewer/)).toBeVisible();
  const buttons = capsule.getByRole('button', { name: 'Replace grain', exact: true });
  await expect(buttons).toHaveCount(2);
  for (const button of await buttons.all()) {
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', 'Loose grains cannot be replaced here yet.');
    await expect(button).toHaveAccessibleDescription('Loose grains cannot be replaced here yet.');
  }
  const refine = card.getByRole('button', { name: 'Refine in GrainAtlas', exact: true });
  await expect(refine).toBeDisabled();
  await expect(refine).toHaveAttribute('title', 'Loose grains have no GrainAtlas project.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: /^K2 z2(?: · |$)/ }).click();
  const registered = capsule.getByRole('button', { name: 'Replace grain', exact: true });
  await expect(registered).toHaveCount(2);
  for (const button of await registered.all()) await expect(button).toBeEnabled();
  expect(await writes(page)).toEqual([]);
});

test('Source to replace names loose grains and disables replacement only for the selected loose source', async ({ page }) => {
  const mixed = { ...batch, fractions: [{ ...batch.fractions[0], sources: [looseGrainSource,
    { ...batch.fractions[0].sources[0], id: 'registered-source' }] }, batch.fractions[1]] };
  await start(page, { fixtures: { [`/v1/tims/batches/${batch.id}`]: mixed } });
  await openBatch(page);
  await page.getByRole('button', { name: /^K1 z1 · Loose grain LG-invented-1/ }).click();
  const actions = page.getByRole('region', { name: 'Capsule details' }).getByRole('group', { name: 'Capsule actions' });
  const select = actions.getByRole('combobox', { name: 'Source to replace' });
  const replace = actions.getByRole('button', { name: 'Replace grain', exact: true });
  await expect(select.getByRole('option', { name: 'Loose grain · Grain: LG-invented-1', exact: true })).toHaveCount(1);
  await expect(replace).toBeDisabled();
  await select.selectOption('registered-source');
  await expect(replace).toBeEnabled();
  await select.selectOption(looseGrainSource.id);
  await expect(replace).toBeDisabled();
  await expect(replace).toHaveAccessibleDescription('Loose grains cannot be replaced here yet.');
  expect(await writes(page)).toEqual([]);
});

for (const crossSample of [false, true]) test(`Replace grain preserves history (${crossSample ? 'cross sample' : 'same sample'})`, async ({ page }) => {
  const next = correctedFraction(crossSample);
  const elements = { ...correctionElements, grains: correctionElements.grains.map(g => g.id === correctionGrain.id ? { ...g, sample: next.sample.name } : g) };
  await start(page, { fixtures: { ...correctionFixtures, '/v1/mounts/mount-demo/elements': elements } });
  await openBatch(page);
  await page.getByRole('button', { name: /^K1 z1(?: · |$)/ }).click();
  const capsule = page.getByRole('region', { name: 'Capsule details' });
  await capsule.getByRole('group', { name: 'Capsule actions' }).getByRole('button', { name: 'Replace grain', exact: true }).click();
  const picker = page.getByRole('region', { name: 'GrainAtlas picker' });
  await expect(picker).toContainText('Replacing Invented grain one · spot Zircon_1');
  await chooseMount(picker, capsuleMount.label);
  await picker.getByRole('button', { name: /Demo-12 · grain 002_Demo\/4/ }).click();
  await expect(picker).toContainText(crossSample
    ? `This grain is from Synthetic-B, not ${batch.fractions[0].sample.name}. K1 will hold a new Synthetic-B fraction; z1 is kept as a replaced record.`
    : 'The old grain stays recorded as replaced.');
  await picker.getByRole('textbox', { name: 'Reason (optional)' }).fill('Wrong grain selected');
  expect(await writes(page)).toEqual([]);
  await reply(page, `POST ${replacementPath}`, 200, next);
  await reply(page, `/v1/tims/batches/${batch.id}`, 200, { ...batch, fractions: [...batch.fractions.filter(f => f.id !== batch.fractions[0].id), next], capsule_map: { ...batch.capsule_map, 1: next.id } });
  await picker.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(capsule).toContainText('Replaced Invented grain one (spot Zircon_1) · Invented analyst · 24 Nov 2026 · Wrong grain selected');
  if (crossSample) await expect(capsule).toContainText(`Replaces z1 · ${batch.fractions[0].sample.name} · Invented analyst · 24 Nov 2026`);
  await expect(page.getByRole('button', { name: new RegExp(`^K1 ${next.name}(?: · |$)`) })).toHaveAttribute('aria-pressed', 'true');
  const recorded = await writes(page);
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toEqual({ method: 'POST', path: replacementPath,
    body: { grain_id: correctionGrain.server_id, spot_id: correctionSpot.server_id, is_fragment: false, fragment_note: '', note: '', reason: 'Wrong grain selected' },
    idempotencyKey: expect.stringMatching(/^[\da-f-]{36}$/i) });
  expect(await readCount(page, `/v1/tims/batches/${batch.id}`)).toBe(2);
});

for (const status of [404, 405, 409]) test(`Replace grain leaves the capsule intact on ${status}`, async ({ page }) => {
  await start(page, { fixtures: correctionFixtures, apiReplies: { [`POST ${replacementPath}`]: { status, body: { detail: 'Invented chemistry record blocks this replacement.' } } } });
  await openBatch(page); await page.getByRole('button', { name: /^K1 z1(?: · |$)/ }).click();
  const capsule = page.getByRole('region', { name: 'Capsule details' });
  await capsule.getByRole('group', { name: 'Capsule actions' }).getByRole('button', { name: 'Replace grain', exact: true }).click();
  const picker = page.getByRole('region', { name: 'GrainAtlas picker' });
  await chooseMount(picker, capsuleMount.label);
  await picker.getByRole('button', { name: /Demo-12 · grain/ }).click();
  await picker.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(picker).toContainText(status === 409 ? '409: Invented chemistry record blocks this replacement.' : 'This server does not support Replace grain yet.');
  await expect(capsule).toContainText('Grain: Invented grain one');
  await expect(capsule).not.toContainText('Replaced Invented grain one');
  expect(await readCount(page, `/v1/tims/batches/${batch.id}`)).toBe(1);
  const first = (await writes(page))[0];
  await picker.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect.poll(async () => (await writes(page)).length).toBe(2);
  expect((await writes(page))[1].idempotencyKey).toBe(first.idempotencyKey);
});

for (const [width, height] of [[1440, 900], [1280, 800], [1024, 640]]) for (const theme of ['light', 'dark']) test(`capsule and picker actions stay visible at ${width} × ${height}, ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await start(page, { store: { theme, themeChosen: true }, fixtures: correctionFixtures });
  await openBatch(page); await page.getByRole('button', { name: /^K1 z1(?: · |$)/ }).click();
  const capsule = page.getByRole('region', { name: 'Capsule details' }), picker = page.getByRole('region', { name: 'GrainAtlas picker' });
  const actions = capsule.getByRole('group', { name: 'Capsule actions' });
  await expect(actions.getByRole('button', { name: 'Add source', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(actions.getByRole('button', { name: 'Replace grain', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(capsule.getByRole('button', { name: 'Close capsule' })).toBeInViewport({ ratio: 1 });
  await chooseMount(picker, capsuleMount.label);
  await picker.getByRole('button', { name: /Demo-12 · grain/ }).click();
  await expect(picker.getByRole('button', { name: 'Add source', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('region', { name: 'Capsule grid' })).toBeInViewport({ ratio: 1 });
  expect(await problems(page, 'Capsule bench with picker')).toEqual([]);
  expect(await writes(page)).toEqual([]);
});

test('carries mount, sample and search to the next capsule and after reopening the batch', async ({ page }) => {
  await start(page, { fixtures: correctionFixtures });
  const picker = await openSpotPicker(page);
  await chooseMount(picker, capsuleMount.label);
  await picker.getByRole('combobox', { name: 'Sample', exact: true }).selectOption(batch.fractions[0].sample.name);
  await picker.getByRole('searchbox', { name: 'Filter grains' }).fill('Demo-12');
  const capsule = page.getByRole('region', { name: 'Capsule details' });
  await capsule.getByRole('button', { name: 'Next capsule' }).click();
  await expect(capsule).toContainText('K4');
  await expect(picker.getByRole('combobox', { name: 'Mount', exact: true })).toHaveValue(capsuleMount.label);
  await expect(picker.getByRole('combobox', { name: 'Sample', exact: true })).toHaveValue(batch.fractions[0].sample.name);
  await expect(picker.getByRole('searchbox', { name: 'Filter grains' })).toHaveValue('Demo-12');
  expect(await readCount(page, '/v1/mounts/mount-demo/elements')).toBe(1);
  await page.getByRole('button', { name: 'Back to batches', exact: true }).click();
  await openBatch(page); await page.getByRole('button', { name: 'K4 empty', exact: true }).click();
  await expect(picker.getByRole('searchbox', { name: 'Filter grains' })).toHaveValue('Demo-12');
  await page.getByRole('button', { name: 'Back to batches', exact: true }).click();
  await page.reload(); await expect(page.getByRole('region', { name: 'Batch list', exact: true })).toBeVisible(); await openBatch(page); await page.getByRole('button', { name: 'K4 empty', exact: true }).click();
  await expect(picker.getByRole('combobox', { name: 'Mount', exact: true })).toHaveValue(capsuleMount.label);
  await expect(picker.getByRole('combobox', { name: 'Sample', exact: true })).toHaveValue(batch.fractions[0].sample.name);
  await expect(picker.getByRole('searchbox', { name: 'Filter grains' })).toHaveValue('Demo-12');
  expect(await writes(page)).toEqual([]);
});

test('mount combobox filters loaded metadata, navigates by keyboard and pages on demand', async ({ page }) => {
  const mounts = [capsuleMount, { ...capsuleMount, id: 'mount-other', label: 'Other synthetic 50X', sample_names: ['Other-B'], projects: ['Other project'] }];
  await start(page, { fixtures: correctionFixtures, apiReplies: { '/v1/mounts?limit=50': { status: 200, body: mounts, nextCursor: 'more' }, '/v1/mounts?limit=50&after=more': { status: 200, body: [{ ...capsuleMount, id: 'mount-last', label: 'Last synthetic 100X' }] } } });
  const picker = await openSpotPicker(page), combo = picker.getByRole('combobox', { name: 'Mount', exact: true });
  const options = picker.getByRole('listbox', { name: 'Mounts', exact: true }).getByRole('option');
  await combo.fill('synthetic a');
  await expect(options).toHaveCount(1);
  await combo.press('ArrowDown'); await combo.press('Home');
  await expect(combo).toHaveAttribute('aria-activedescendant', /.+-0$/);
  await combo.press('Enter');
  await expect(combo).toHaveValue(capsuleMount.label);
  await expect(combo).toHaveAttribute('aria-expanded', 'false');
  await picker.getByRole('button', { name: 'Change mount', exact: true }).click();
  await expect(picker.getByRole('group', { name: 'Recent', exact: true })).toContainText(capsuleMount.label);
  await combo.fill('other-project'); await expect(options).toContainText('50X · 2 samples · 2 grains');
  await combo.press('Escape'); await expect(combo).toHaveValue(capsuleMount.label);
  await combo.fill(''); await combo.press('End'); await expect(combo).toHaveAttribute('aria-activedescendant', /.+-1$/);
  await combo.press('ArrowUp'); await expect(combo).toHaveAttribute('aria-activedescendant', /.+-0$/);
  await picker.getByRole('button', { name: 'Load more mounts', exact: true }).click();
  await expect(options).toHaveCount(3);
  expect(await readCount(page, '/v1/mounts?limit=50')).toBe(1);
  expect(await readCount(page, '/v1/mounts?limit=50&after=more')).toBe(1);
  expect(await readCount(page, '/v1/mounts/mount-other')).toBe(0);
  expect(await writes(page)).toEqual([]);
});

test('Refine in GrainAtlas launches project and spot and refreshes a changed mount on return', async ({ page }) => {
  await start(page, { fixtures: correctionFixtures }); await openBatch(page);
  await page.getByRole('button', { name: /^K1 z1(?: · |$)/ }).click();
  const capsule = page.getByRole('region', { name: 'Capsule details' });
  await expect(capsule.locator('.source').getByTestId('tims-grain-image')).toHaveAttribute('data-image-state', 'ready');
  const puckOutline = page.getByRole('button', { name: /^K1 z1(?: · |$)/ }).locator('polygon.outline');
  const puckBefore = await puckOutline.getAttribute('points');
  const outline = capsule.locator('.source polygon.outline');
  await expect(outline).toHaveCount(1); const before = await outline.getAttribute('points');
  await capsule.getByRole('button', { name: 'Refine in GrainAtlas', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fake: { calls: [string, unknown][] } }).__fake.calls.filter(([command]) => command === 'grainatlas_launch'))).toEqual([
    ['grainatlas_launch', { project: 'project-demo', server: 'http://localhost:8000', code: 'ONE-TIME-FIXTURE', spot: 'atlas-1' }],
  ]);
  await reply(page, '/v1/mounts/mount-demo', 200, { ...capsuleMount, content_revision: 2 });
  await reply(page, `/v1/tims/batches/${batch.id}`, 200, { ...batch, fractions: batch.fractions.map(f => ({ ...f, sources: f.sources.map(source => ({ ...source, grain_label: 'Refined invented grain' })) })) });
  await reply(page, '/v1/mounts/mount-demo/elements', 200, { ...correctionElements, grains: correctionElements.grains.map((grain, i) => i ? grain : { ...grain, polygon_um: [[580, 430], [700, 430], [900, 630]] }) });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(capsule).toContainText('Updated from GrainAtlas');
  await expect(outline).not.toHaveAttribute('points', before!);
  await expect(puckOutline).not.toHaveAttribute('points', puckBefore!);
  await expect(capsule).toContainText('Grain: Refined invented grain');
  expect(await readCount(page, '/v1/mounts/mount-demo/elements')).toBe(2);
  expect(await readCount(page, `/v1/tims/batches/${batch.id}`)).toBe(2);
  // Unchanged return visits revalidate only metadata, never download all grains again.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => readCount(page, '/v1/mounts/mount-demo')).toBe(3);
  expect(await readCount(page, '/v1/mounts/mount-demo/elements')).toBe(2);
  expect(await writes(page)).toEqual([]);
});

test('a successful assignment keeps the mount and sample and clears a search hiding other grains', async ({ page }) => {
  const sample = batch.fractions[0].sample.name;
  const next = { ...correctedFraction(), id: 'fraction-assigned', capsule_number: 3, capsule_label: 'K3' };
  await start(page, { fixtures: { ...correctionFixtures, '/v1/mounts/mount-demo/elements': { ...correctionElements, grains: correctionElements.grains.map(grain => ({ ...grain, sample })) } }, apiReplies: { 'POST /v1/fractions': { status: 200, body: next } } });
  const picker = await openSpotPicker(page);
  await chooseMount(picker, capsuleMount.label);
  await picker.getByRole('combobox', { name: 'Sample', exact: true }).selectOption(sample);
  await picker.getByRole('searchbox', { name: 'Filter grains' }).fill('Demo-12');
  await picker.getByRole('button', { name: /Demo-12 · grain/ }).click();
  await picker.getByRole('button', { name: 'Load into K3', exact: true }).click();
  const capsule = page.getByRole('region', { name: 'Capsule details' });
  await expect(capsule).toContainText('Loaded z1 into K3.');
  await capsule.getByRole('button', { name: 'Next capsule' }).click();
  await expect(picker.getByRole('combobox', { name: 'Mount', exact: true })).toHaveValue(capsuleMount.label);
  await expect(picker.getByRole('combobox', { name: 'Sample', exact: true })).toHaveValue(sample);
  await expect(picker.getByRole('searchbox', { name: 'Filter grains' })).toHaveValue('');
  expect(await writes(page)).toHaveLength(1);
  expect(await readCount(page, '/v1/mounts/mount-demo/elements')).toBe(1);
});

test('Refine falls back to the atlas grain when the source has no spot', async ({ page }) => {
  await start(page, { fixtures: correctionFixtures }); await openBatch(page);
  await page.getByRole('button', { name: /^K2 z2(?: · |$)/ }).click();
  await page.getByRole('region', { name: 'Capsule details' }).getByRole('button', { name: 'Refine in GrainAtlas', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fake: { calls: [string, unknown][] } }).__fake.calls.filter(([command]) => command === 'grainatlas_launch'))).toEqual([
    ['grainatlas_launch', { project: 'project-demo', server: 'http://localhost:8000', code: 'ONE-TIME-FIXTURE', grain: 'atlas-grain-1' }],
  ]);
  expect(await writes(page)).toEqual([]);
});

test('refine polling pauses when hidden and stops after 10 minutes', async ({ page }) => {
  await page.clock.install();
  await start(page, { fixtures: correctionFixtures }); await openBatch(page);
  await page.getByRole('button', { name: /^K1 z1(?: · |$)/ }).click();
  await page.getByRole('region', { name: 'Capsule details' }).getByRole('button', { name: 'Refine in GrainAtlas', exact: true }).click();
  await expect.poll(() => readCount(page, '/v1/mounts/mount-demo')).toBe(1);
  await page.clock.runFor(20_000);
  await expect.poll(() => readCount(page, '/v1/mounts/mount-demo')).toBe(2);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(20_000);
  expect(await readCount(page, '/v1/mounts/mount-demo')).toBe(2);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => readCount(page, '/v1/mounts/mount-demo')).toBe(3);
  await page.clock.fastForward(10 * 60_000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(await readCount(page, '/v1/mounts/mount-demo')).toBe(3);
  expect(await readCount(page, '/v1/mounts/mount-demo/elements')).toBe(1);
  expect(await writes(page)).toEqual([]);
});
