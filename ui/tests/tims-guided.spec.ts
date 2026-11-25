import { test, expect, type Page, type Locator } from '@playwright/test';
import { installFakeTauri, type FakeOptions } from './fake-tauri';
import { fixtures, batch, lab, version, publishedVersion } from './fixtures/tims';
import { batchReadiness } from '../src/lib/tims-readiness';
import { timsRegionBoxes, expectTimsRegionsStable, timsWellBoxes, expectTimsWellsStable, expectPuckBoardFits } from './tims-layout';
import { routeTimsAtlas } from './tims-atlas-helpers';
import { problems } from './problems';
import { inventedElements } from './fixtures/tims-atlas';
import type { BatchDetail, SpikeAddition } from '../src/lib/tims-api';
const batchPath = `/v1/tims/batches/${batch.id}`;
const rail = (page: Page) => page.getByRole('navigation', { name: 'Batch setup steps' });
const inspector = (page: Page) => page.getByRole('region', { name: 'Capsule details', exact: true });
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __fake: { writes: { path: string; body: Record<string, unknown> }[] } }).__fake.writes);
async function reply(page: Page, path: string, status: number, body: unknown) {
  await page.evaluate(({ path, status, body }) => { (window as unknown as { __fake: { apiReplies: Record<string, unknown> } }).__fake.apiReplies[path] = { status, body }; }, { path, status, body });
}
async function start(page: Page, options: Partial<FakeOptions> = {}) {
  await routeTimsAtlas(page);
  await page.route('**/modules/manifest.json', route => route.fulfill({ json: { modules: [] } }));
  await page.addInitScript(installFakeTauri, { signedIn: true, ...options, store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'tims', ...options.store }, fixtures: { ...fixtures, [`/v1/tims/column-protocols?limit=2&lab=${lab}`]: [], ...options.fixtures } });
  await page.goto('./');
  await page.getByRole('region', { name: 'Batch list', exact: true }).getByRole('button', { name: 'Krogh · 2026-11-06', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Krogh (K) · 2026-11-06', exact: true })).toBeVisible();
}
async function step(page: Page, number: number) { await rail(page).getByRole('button', { name: new RegExp(`^${number}\\.`) }).click(); }
async function selectVersion(card: Locator) {
  await card.getByRole('button', { name: 'Choose spike version' }).click();
  const picker = card.getByRole('region', { name: 'Spike version picker' });
  await picker.getByLabel('Solution', { exact: true }).selectOption(publishedVersion.solution_id);
  await picker.getByLabel('Subfraction', { exact: true }).selectOption(publishedVersion.subfraction_id);
  await picker.getByLabel('Version', { exact: true }).selectOption(publishedVersion.id);
  await picker.getByRole('button', { name: 'Apply reviewed version' }).click();
}
const missingSpike = { ...batch, spikes: [] };
test('guided navigation, next incomplete, persistence and browsing without writes', async ({ page }) => {
  await start(page);
  await expect(rail(page).getByRole('button', { name: /^1\./ })).toHaveAttribute('aria-current', 'step');
  await rail(page).getByRole('button', { name: 'Next', exact: true }).click();
  await expect(inspector(page)).toContainText('K1');
  await rail(page).getByRole('button', { name: 'Next incomplete' }).click();
  await expect(inspector(page).getByRole('heading', { level: 3 })).toContainText('K3');
  await step(page, 3);
  await expect(rail(page)).toContainText(`Spike ${batchReadiness(batch).totals.spike} of ${batchReadiness(batch).totals.capsules}`);
  await rail(page).getByRole('button', { name: 'Next incomplete' }).click();
  const expected = batchReadiness(batch).capsules.find(c => !c.spike)!;
  await expect(inspector(page).getByRole('heading', { level: 3 })).toContainText(`K${expected.capsule_number}`);
  await step(page, 4); await expect(page.getByLabel('Step timeline')).toBeVisible();
  await step(page, 5); await expect(page.getByLabel('Batch completion review')).toBeVisible();
  // K1 dissolved during CA; K2 has a spike. Empty positions do not block completion.
  await expect(page.getByRole('button', { name: 'Complete batch', exact: true })).toBeEnabled();
  await rail(page).getByRole('button', { name: 'Back', exact: true }).click();
  await page.reload();
  // The shell may also restore the batch itself.
  await expect(page.getByRole('region', { name: 'Batch list', exact: true }).or(rail(page))).toBeVisible();
  if (await page.getByRole('region', { name: 'Batch list', exact: true }).isVisible()) await page.getByRole('region', { name: 'Batch list', exact: true }).getByRole('button', { name: 'Krogh · 2026-11-06', exact: true }).click();
  await expect(rail(page).getByRole('button', { name: /^4\./ })).toHaveAttribute('aria-current', 'step');
  expect(await writes(page)).toEqual([]);
});
test('required spike records weighing metadata, pinned version, calculation and warnings', async ({ page }) => {
  const path = `/v1/tims/batches/${batch.id}/fractions/${batch.fractions[0].id}/steps/spike-step/spike`;
  const row: SpikeAddition = { ...batch.spikes[0], fraction_id: batch.fractions[0].id, spike_version_id: publishedVersion.id, spike_weight_g: '0.01', balance_readability_g: '0.00001', weighed_by_name: 'Demo analyst', weighed_by_display_name: 'Invented account analyst', weighed_at: '2026-11-24T12:00:00Z', warnings: ['spike_weight_unusual', 'readability_missing'], tracer: [{ isotope: '235U', mol: 2.3e-12, mol_u1s: 1e-14, basis: 'concentration' }, { isotope: '205Pb', mol: 3.12345e-9, mol_u1s: null, basis: 'concentration', uncertainty_incomplete: true }] };
  await start(page, { fixtures: { [batchPath]: missingSpike }, apiReplies: { [`PUT ${path}`]: { status: 200, body: row } } });
  await step(page, 3);
  const card = page.getByRole('region', { name: 'Required capsule spike' });
  await expect(card).toContainText('Required'); await expect(inspector(page).getByRole('button', { name: 'Save spike here' })).toBeDisabled();
  await selectVersion(card); await card.getByLabel('Recorded spike weight (g)').fill('0.01');
  await expect(card.getByLabel('Tracer calculation')).toContainText("Save the weighing to see the server's tracer calculation.");
  await expect(card.getByLabel('Tracer calculation').getByText('²³⁵U', { exact: true })).toHaveCount(0);
  await reply(page, batchPath, 200, { ...batch, spikes: [row] });
  await inspector(page).getByRole('button', { name: 'Save spike here' }).click();
  await expect(card).toContainText('This spike weight is unusual');
  await expect.poll(() => writes(page)).toHaveLength(1);
  expect((await writes(page))[0].body).toMatchObject({ spike_version_id: publishedVersion.id, spike_weight_g: '0.01', balance_readability_g: '0.00001', weighed_by_id: 'invented-account', expected_updated_at: null });
  const calculation = card.getByLabel('Tracer calculation');
  await expect(calculation).toContainText('Stored server calculation');
  await expect(calculation).toContainText('²³⁵U');
  await expect(calculation).toContainText('2.3 ± 0.01 pmol');
  await expect(calculation.locator('p[title]').filter({ hasText: '²³⁵U' })).toHaveAttribute('title', '2.3e-12 mol; ± 1e-14 mol (1σ)');
  await expect(calculation).toContainText('3.12345 ± not given nmol');
  await calculation.getByLabel('Full precision').check();
  await expect(calculation).toContainText('2.3 ± 0.01 pmol');
  await expect(card).toContainText('Weighed by Invented account analyst');
  await card.getByLabel('Recorded spike weight (g)').fill('0.02');
  await expect(calculation).toContainText("Save the weighing to see the server's tracer calculation.");
  await expect(calculation.locator('p[title]')).toHaveCount(0);
  await card.getByLabel('Recorded spike weight (g)').fill('0.01');
  await expect(calculation).toContainText('Stored server calculation');
  await card.getByLabel('Balance readability (g)').fill('0.00002');
  await expect(calculation).toContainText("Save the weighing to see the server's tracer calculation.");
});
test('stale 409 compares both values and requires an explicit choice before retry', async ({ page }) => {
  const addition = { ...batch.spikes[0], spike_weight_g: '0.01', bottle_before_g: null, bottle_after_g: null };
  const path = `/v1/tims/batches/${batch.id}/fractions/${addition.fraction_id}/steps/${addition.step_id}/spike`;
  const current = { ...addition, spike_weight_g: '0.03', updated_at: '2026-11-24T12:00:00Z', weighed_by_name: 'Invented other analyst', weighed_by_display_name: 'Invented other account' };
  await start(page, { fixtures: { [batchPath]: { ...batch, spikes: [addition] } }, apiReplies: { [`PUT ${path}`]: { status: 409, body: { code: 'spike_changed', current } } } });
  await step(page, 3); await page.getByTestId('tims-capsule').nth(1).click(); const card = page.getByRole('region', { name: 'Required capsule spike' });
  await expect(card.getByLabel('Tracer calculation')).toContainText("Save the weighing to see the server's tracer calculation.");
  await card.getByLabel('Recorded spike weight (g)').fill('0.02'); await inspector(page).getByRole('button', { name: 'Save spike here' }).click();
  const conflict = card.getByLabel('Spike conflict'); await expect(conflict).toContainText('0.02 g'); await expect(conflict).toContainText('0.03 g'); await expect(conflict).toContainText('Invented other account');
  expect((await writes(page))[0].body.expected_updated_at).toBe(addition.updated_at);
  await expect(inspector(page).getByRole('button', { name: 'Save spike here' })).toBeDisabled();
  await conflict.getByRole('button', { name: 'Keep mine', exact: true }).click();
  await reply(page, `PUT ${path}`, 200, { ...current, spike_weight_g: '0.02' });
  await reply(page, batchPath, 200, { ...batch, spikes: [{ ...current, spike_weight_g: '0.02' }] });
  await inspector(page).getByRole('button', { name: 'Save spike here' }).click();
  await expect.poll(() => writes(page)).toHaveLength(2);
  expect((await writes(page))[1].body).toMatchObject({ expected_updated_at: current.updated_at, spike_weight_g: '0.02' });
});
test('server spike_required explains the failed status save', async ({ page }) => {
  const path = `/v1/fractions/${batch.fractions[0].id}`;
  await start(page, { fixtures: { [batchPath]: { ...batch, spikes: [{ ...batch.spikes[0], fraction_id: batch.fractions[0].id }] } }, apiReplies: { [`PATCH ${path}`]: { status: 422, body: { code: 'spike_required', detail: 'Invented missing spike' } } } });
  await page.getByTestId('tims-capsule').first().click();
  const capsule = inspector(page); await capsule.getByText('Fraction status and notes', { exact: true }).click();
  const status = capsule.getByLabel('Status', { exact: true });
  await expect(status).toHaveAccessibleDescription('');
  await expect(status.getByRole('option', { name: 'spiked', exact: true })).toHaveJSProperty('disabled', false);
  await status.selectOption('spiked');
  await expect(status).toHaveValue('spiked');
  const save = capsule.getByRole('button', { name: 'Save fraction here' });
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => writes(page)).toEqual([expect.objectContaining({ path, body: expect.objectContaining({ status: 'spiked' }) })]);
  await expect(capsule).toContainText('Record a spike version and positive weight for this capsule before marking it spiked');
});
test('completion refuses missing items, then completes and can reopen', async ({ page }) => {
  const readiness = batchReadiness(batch);
  const ready = { ...readiness, capsules: readiness.capsules.map((c, i) => ({ ...c, grain: false, spike: i !== 0, missing: [] })), totals: { capsules: readiness.capsules.length, ready: readiness.capsules.length, pending: 0, spike: readiness.capsules.length - 1, grain: 0 } };
  const detail: BatchDetail = { ...batch, fractions: batch.fractions.map((f, i) => i === 0 ? { ...f, status: 'lost' } : f), fraction_step_records: [], readiness: ready };
  await start(page, { fixtures: { [batchPath]: detail }, apiReplies: { [`POST ${batchPath}/complete`]: { status: 422, body: { code: 'batch_incomplete', capsules: [{ ...ready.capsules[0], missing: ['spike'] }] } } } });
  await step(page, 5); await page.getByRole('button', { name: 'Complete batch', exact: true }).click();
  await expect(page.getByLabel('Chemistry batch')).toContainText('The batch is incomplete');
  await expect(page.getByLabel('Batch completion review')).toContainText('spike pending');
  await expect(page.getByRole('button', { name: 'Complete batch', exact: true })).toBeDisabled();
  await reply(page, batchPath, 200, detail);
  await page.getByRole('button', { name: 'Refresh batch', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Complete batch', exact: true })).toBeEnabled();
  const completed = { ...detail, completed_at: '2026-11-24T12:00:00Z', completed_by_name: 'Invented analyst' };
  await reply(page, `POST ${batchPath}/complete`, 200, completed); await reply(page, batchPath, 200, completed);
  await page.getByRole('button', { name: 'Complete batch', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen batch', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Edit batch', exact: true })).toBeDisabled();
  await reply(page, `POST ${batchPath}/reopen`, 200, detail); await reply(page, batchPath, 200, detail);
  await page.getByRole('button', { name: 'Reopen batch', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit batch', exact: true })).toBeEnabled();
});
for (const [width, height] of [[1440, 900], [1280, 800], [1024, 640]]) for (const theme of ['light', 'dark']) {
  test(`TIMS regions stay within 2 px at ${width} × ${height}, ${theme}`, async ({ page }) => {
    // Covers the full assignment and disclosure walk in both browser engines.
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    const grain = { ...inventedElements.grains[0], label: 'Invented layout grain', sample: 'Synthetic-A' };
    const elements = { ...inventedElements, grains: [grain], spots: [{ ...inventedElements.spots[0], grain_id: grain.id }] };
    const added = { ...batch.fractions[0], id: 'invented-assigned', capsule_number: 3, capsule_label: 'K3', name: 'z3' };
    await start(page, { store: { theme, themeChosen: true }, fixtures: {
      '/v1/mounts/mount-demo/elements': elements,
      // This walk opens and closes history; unsupported-server hiding is tested separately.
      [`/v1/fractions/${batch.spikes[0].fraction_id}/spikes/history?limit=50`]: [],
    }, apiReplies: { 'POST /v1/fractions': { status: 201, body: added } } });
    const railBox = await rail(page).boundingBox();
    expect(railBox).not.toBeNull(); expect(railBox!.height).toBeLessThanOrEqual(40);
    const before = await timsRegionBoxes(page);
    const wellsBefore = await timsWellBoxes(page);
    if (width >= 1280) await expectPuckBoardFits(page);
    const stable = async (action: () => Promise<unknown>) => {
      await action(); await expectTimsRegionsStable(page, before);
      await expectTimsWellsStable(page, wellsBefore);
      if (width >= 1280) await expectPuckBoardFits(page);
    };
    const walkDisclosures = async () => {
      // Exclude summaries inside another disclosure, even after its parent opens.
      // Re-query on each click rather than retaining indexes into all nested summaries.
      const summaries = inspector(page).locator('details:not(details details) > summary:visible');
      for (let index = 0; index < await summaries.count(); index++) {
        const summary = summaries.nth(index);
        await stable(() => summary.click());
        await expect(summary.locator('..')).toHaveAttribute('open', '');
        await stable(() => summary.click());
        await expect(summary.locator('..')).not.toHaveAttribute('open', '');
      }
    };
    await stable(() => page.getByTestId('tims-capsule').nth(2).click());
    await stable(() => inspector(page).getByRole('button', { name: 'TIMS only', exact: true }).click());
    await walkDisclosures();
    await stable(() => inspector(page).getByRole('button', { name: 'Lab blank', exact: true }).click());
    await stable(() => inspector(page).getByRole('button', { name: 'GrainAtlas', exact: true }).click());
    const picker = page.getByRole('region', { name: 'GrainAtlas picker', exact: true });
    await stable(() => picker.getByRole('combobox', { name: 'Mount', exact: true }).fill('Invented mount S'));
    await stable(() => picker.getByRole('option', { name: /Invented mount S/ }).click());
    await stable(() => picker.getByRole('button', { name: new RegExp(grain.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click());
    await stable(() => picker.getByRole('button', { name: 'Load into K3', exact: true }).click());
    await stable(() => inspector(page).getByRole('button', { name: 'Next capsule', exact: true }).click());
    await stable(() => inspector(page).getByRole('button', { name: 'Previous capsule', exact: true }).click());
    // Each available capsule disclosure is tested both ways at each size/theme.
    for (const number of [2, 3, 4]) {
      await stable(() => step(page, number));
      if (number === 3) await stable(() => page.getByTestId('tims-capsule').nth(1).click());
      await walkDisclosures();
    }
    for (const number of [1, 2, 3, 4, 5]) await stable(() => step(page, number));
    expect(await problems(page, 'TIMS guided bench')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.tims > .workspace').evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
  });
}
test('take server keeps the current weighing without another write and history hides on 404', async ({ page }) => {
  const addition = { ...batch.spikes[0], spike_weight_g: '0.01' };
  const path = `/v1/tims/batches/${batch.id}/fractions/${addition.fraction_id}/steps/${addition.step_id}/spike`;
  const current = { ...addition, spike_weight_g: '0.04', updated_at: '2026-11-24T12:00:00Z' };
  await start(page, { fixtures: { [batchPath]: { ...batch, spikes: [addition] } }, apiReplies: {
    [`PUT ${path}`]: { status: 409, body: { code: 'spike_changed', current } },
    [`/v1/fractions/${addition.fraction_id}/spikes/history?limit=50`]: { status: 404, body: {} },
  } });
  await step(page, 3); await page.getByTestId('tims-capsule').nth(1).click();
  const card = page.getByRole('region', { name: 'Required capsule spike' });
  await card.getByLabel('Recorded spike weight (g)').fill('0.02'); await inspector(page).getByRole('button', { name: 'Save spike here' }).click();
  await reply(page, batchPath, 200, { ...batch, spikes: [current] });
  await card.getByRole('button', { name: 'Take server’s', exact: true }).click();
  await expect(card.getByLabel('Recorded spike weight (g)')).toHaveValue('0.04');
  await card.getByText('Spike edit history', { exact: true }).click();
  await expect(card.getByText('Spike edit history', { exact: true })).toHaveCount(0);
  expect(await writes(page)).toHaveLength(1);
});
