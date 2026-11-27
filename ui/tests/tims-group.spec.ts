import { test, expect, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';
import { fixtures, batch as original, publishedVersion, lab } from './fixtures/tims';
import { routeTimsAtlas } from './tims-atlas-helpers';
import { timsRegionBoxes, expectTimsRegionsStable, timsWellBoxes, expectTimsWellsStable } from './tims-layout';
import { type BulkInput, type BulkResult } from '../src/lib/tims-group';
import type { BatchDetail, SpikeAddition } from '../src/lib/tims-api';
const batch: BatchDetail = { ...original, fractions: original.fractions.map(f => ({ ...f, status: 'picked' })), fraction_step_records: [], spikes: [] };
const path = `/v1/tims/batches/${batch.id}`, bulkPath = `${path}/bulk`;
const capsules = (page: Page) => page.getByTestId('tims-capsule');
const editor = (page: Page) => page.getByRole('region', { name: 'Group editor', exact: true });
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __fake: { writes: { method: string; path: string; body: BulkInput }[] } }).__fake.writes);
async function reply(page: Page, route: string, body: unknown, status = 200) {
  await page.evaluate(({ route, body, status }) => { (window as unknown as { __fake: { apiReplies: Record<string, unknown> } }).__fake.apiReplies[route] = { status, body }; }, { route, body, status });
}
async function start(page: Page, detail: BatchDetail = batch) {
  await routeTimsAtlas(page);
  await page.route('**/modules/manifest.json', route => route.fulfill({ json: { modules: [] } }));
  await page.addInitScript(installFakeTauri, { signedIn: true, store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'tims' }, fixtures: { ...fixtures, [path]: detail, [`/v1/tims/column-protocols?limit=2&lab=${lab}`]: [] } });
  await page.goto('./');
  await page.getByRole('region', { name: 'Batch list', exact: true }).getByRole('button', { name: 'Krogh · 2026-11-06', exact: true }).click();
  await expect(capsules(page).first()).toBeVisible();
}
async function selectTwo(page: Page) {
  await capsules(page).nth(0).click();
  await capsules(page).nth(1).click({ modifiers: ['ControlOrMeta'] });
  await expect(editor(page)).toBeVisible();
}
function stepResult(input: BulkInput): BulkResult {
  const updated = structuredClone(batch);
  updated.fraction_step_records = updated.fractions.map(f => ({ ...f, id: `group-${f.id}`, updated_at: '2026-11-27T12:00:00Z', fraction_id: f.id, step_id: input.step_id!, parameters: {}, performed_on: String(input.set.performed_on), operator_name: '', skipped: false, outcome: '', outcome_note: '' }));
  return { batch: updated, previous: Object.fromEntries(batch.fractions.map(f => [f.id, { performed_on: null }])), previous_default: null, skipped_fraction_ids: [] };
}

test('plain, Cmd/Ctrl, Shift, puck, all, Space, Shift+arrows and Esc selection', async ({ page }) => {
  await start(page);
  await selectTwo(page);
  await expect(capsules(page).nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(capsules(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
  await capsules(page).nth(1).click({ modifiers: ['ControlOrMeta'] });
  await expect(editor(page)).toHaveCount(0);
  await capsules(page).nth(1).click({ modifiers: ['Shift'] });
  await expect(editor(page)).toBeVisible();
  await capsules(page).nth(1).press('Space');
  await expect(capsules(page).nth(1)).toHaveAttribute('aria-pressed', 'false');
  await capsules(page).nth(0).click();
  await capsules(page).nth(0).press('Shift+ArrowRight');
  await expect(editor(page)).toBeVisible();
  await capsules(page).nth(1).press('Escape');
  await expect(page.getByText('0 capsules selected', { exact: true })).toBeVisible();
  await capsules(page).nth(0).click();
  await page.getByRole('button', { name: 'Select puck', exact: true }).click();
  await expect(page.getByText('2 capsules selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await expect(page.getByText('2 capsules selected', { exact: true })).toBeVisible();
  expect(await writes(page)).toEqual([]);
});

test('chemistry partial edit, preview cancellation, exact POST and undo', async ({ page }) => {
  await start(page); await selectTwo(page);
  const step = batch.steps.find(s => s.method_code !== 'SP-TIMS-SPIKE')!;
  await editor(page).getByLabel('Group step').selectOption(step.id);
  await editor(page).getByLabel('Performed on', { exact: true }).fill('2026-11-27');
  await editor(page).getByRole('button', { name: 'Preview group edit', exact: true }).click();
  await expect(editor(page).getByLabel('Group edit preview')).toContainText('Apply to 2 capsules: performed on → 2026-11-27');
  expect(await writes(page)).toEqual([]);
  await editor(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  const input: BulkInput = { target: 'step_record', step_id: step.id, fraction_ids: batch.fractions.map(f => f.id), set: { performed_on: '2026-11-27' }, expected: Object.fromEntries(batch.fractions.map(f => [f.id, null])) };
  const result = stepResult(input);
  await reply(page, `POST ${bulkPath}`, result);
  await editor(page).getByRole('button', { name: 'Preview group edit', exact: true }).click();
  await editor(page).getByRole('button', { name: 'Confirm group edit' }).click();
  await expect(editor(page)).toContainText('Group edit saved.');
  expect((await writes(page))[0]).toMatchObject({ method: 'POST', path: bulkPath, body: input });
  expect((await writes(page))[0].body).toEqual(input);
  await reply(page, `POST ${bulkPath}`, { ...result, batch, previous: {} });
  await editor(page).getByRole('button', { name: 'Undo last group edit' }).click();
  await expect(editor(page)).toContainText('Last group edit undone.');
  expect((await writes(page))[1].body).toEqual({ target: 'step_record', step_id: step.id, fraction_ids: batch.fractions.map(f => f.id), set: {}, restore: result.previous,
    expected: Object.fromEntries(batch.fractions.map(f => [f.id, '2026-11-27T12:00:00Z'])) });
});

test('Mixed values stay out of the payload; 409 requires a refreshed review', async ({ page }) => {
  const detail = structuredClone(batch);
  detail.fractions[0].notes = 'One'; detail.fractions[1].notes = 'Two';
  await start(page, detail); await selectTwo(page);
  await expect(editor(page).getByLabel('Fraction notes')).toHaveAttribute('placeholder', 'Mixed');
  await editor(page).getByRole('combobox', { name: 'Status', exact: true }).selectOption('transferred');
  await reply(page, `POST ${bulkPath}`, { code: 'bulk_changed', detail: 'Selected capsule changed.' }, 409);
  await editor(page).getByRole('button', { name: 'Preview group edit', exact: true }).click();
  await editor(page).getByRole('button', { name: 'Confirm group edit' }).click();
  await expect(editor(page)).toContainText('Refresh the batch');
  await expect(editor(page).getByRole('button', { name: 'Preview group edit', exact: true })).toBeDisabled();
  expect((await writes(page))[0].body.set).toEqual({ status: 'transferred' });
  await reply(page, path, detail);
  await page.getByRole('button', { name: 'Refresh batch', exact: true }).click();
  await expect(editor(page).getByLabel('Fraction notes')).toBeEnabled();
});

test('group spike version and weighing metadata, then Tab/Enter weights and Shift+Tab', async ({ page }) => {
  await start(page); await selectTwo(page);
  const step = batch.steps.find(s => s.method_code === 'SP-TIMS-SPIKE')!;
  const card = editor(page);
  await card.getByLabel('Group step').selectOption(step.id);
  await card.getByRole('button', { name: 'Choose spike version' }).click();
  const picker = card.getByRole('region', { name: 'Spike version picker' });
  await picker.getByLabel('Solution', { exact: true }).selectOption(publishedVersion.solution_id);
  await picker.getByLabel('Subfraction', { exact: true }).selectOption(publishedVersion.subfraction_id);
  await picker.getByLabel('Version', { exact: true }).selectOption(publishedVersion.id);
  await picker.getByRole('button', { name: 'Apply reviewed version' }).click();
  await card.getByLabel('Weighed at (UTC)', { exact: true }).fill('2026-11-27T12:00');
  await card.getByLabel('Weighed by', { exact: true }).fill('Synthetic analyst');
  await card.getByLabel('Balance readability (g)').fill('0.00001');
  const set = { spike_version_id: publishedVersion.id, weighed_at: '2026-11-27T12:00:00.000Z', weighed_by_name: 'Synthetic analyst', weighed_by_id: null, balance_readability_g: '0.00001' };
  const input: BulkInput = { target: 'spike', step_id: step.id, fraction_ids: batch.fractions.map(f => f.id), set, expected: Object.fromEntries(batch.fractions.map(f => [f.id, null])) };
  const updated = structuredClone(batch);
  updated.fraction_step_records = updated.fractions.map(f => ({ ...f, id: `pending-${f.id}`, updated_at: '2026-11-27T12:00:00Z', fraction_id: f.id, step_id: step.id, parameters: {}, skipped: false, outcome: '', outcome_note: '', spike_metadata: set }));
  await reply(page, `POST ${bulkPath}`, { batch: updated, previous: {}, previous_default: null, skipped_fraction_ids: [] });
  await card.getByRole('button', { name: 'Preview group edit', exact: true }).click();
  await expect(card.getByLabel('Group edit preview')).toContainText(`${publishedVersion.solution_name} ${publishedVersion.version}`);
  await card.getByRole('button', { name: 'Confirm group edit' }).click();
  await expect(card).toContainText('Group edit saved.');
  expect((await writes(page))[0].body).toEqual(input);
  const additions: SpikeAddition[] = updated.fractions.map((f, i) => ({ ...original.spikes[0], ...set, id: `addition-${i}`, fraction_id: f.id, step_id: step.id, spike_weight_g: `0.00${i+1}`, updated_at: '2026-11-27T13:00:00Z' }));
  for (const addition of additions) await reply(page, `PUT ${path}/fractions/${addition.fraction_id}/steps/${step.id}/spike`, addition);
  await card.getByRole('button', { name: 'Enter weights', exact: true }).click();
  const entry = card.getByLabel('Selected capsule weight entry');
  await entry.getByLabel('Spike weight (g)').fill('0.001');
  await entry.getByLabel('Spike weight (g)').press('Tab');
  await expect(entry).toContainText('K2');
  await expect(entry.getByLabel('Spike weight (g)')).toBeFocused();
  await entry.getByLabel('Spike weight (g)').press('Shift+Tab');
  await expect(entry).toContainText('K1');
  await entry.getByLabel('Spike weight (g)').press('Enter');
  await expect(entry).toContainText('K2');
  await entry.getByLabel('Spike weight (g)').fill('0.002');
  await entry.getByLabel('Spike weight (g)').press('Enter');
  await expect(card).toContainText('Selected capsule weights saved.');
  const requests = await writes(page);
  expect(requests[1].body).toMatchObject({ spike_weight_g: '0.001', expected_updated_at: '2026-11-27T12:00:00Z', expected_absent: true });
  expect(requests[2].body).toMatchObject({ spike_weight_g: '0.001', expected_updated_at: additions[0].updated_at, expected_absent: false });
  expect(requests[3].body).toMatchObject({ spike_weight_g: '0.002', expected_updated_at: '2026-11-27T12:00:00Z' });
});

test('completed batch group editor stays read only', async ({ page }) => {
  await start(page, { ...batch, completed_at: '2026-11-27T12:00:00Z' }); await selectTwo(page);
  await expect(editor(page)).toContainText('Completed batch · read only');
  await expect(editor(page).getByLabel('Fraction notes')).toBeDisabled();
  await expect(editor(page).getByRole('button', { name: 'Preview group edit', exact: true })).toBeDisabled();
  expect(await writes(page)).toEqual([]);
});
for (const viewport of [{ width:1440,height:900 }, { width:1280,height:800 }, { width:1024,height:640 }]) {
  test(`no jump: one → many → clear and group step at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); await start(page);
    const regions = await timsRegionBoxes(page), wells = await timsWellBoxes(page);
    await capsules(page).nth(0).click(); await expectTimsRegionsStable(page, regions); await expectTimsWellsStable(page, wells);
    await capsules(page).nth(1).click({ modifiers: ['ControlOrMeta'] });
    await expect(editor(page)).toBeVisible(); await expectTimsRegionsStable(page, regions); await expectTimsWellsStable(page, wells);
    await editor(page).getByLabel('Group step').selectOption(batch.steps[0].id);
    await expectTimsRegionsStable(page, regions); await expectTimsWellsStable(page, wells);
    await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
    await expectTimsRegionsStable(page, regions); await expectTimsWellsStable(page, wells);
  });
}
