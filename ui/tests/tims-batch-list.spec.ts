import { test, expect, type Page } from '@playwright/test';
import { installFakeTauri, type FakeOptions } from './fake-tauri';
import { fixtures, batch, lab } from './fixtures/tims';
import { expectTimsListFits, timsRegionBoxes, expectTimsRegionsStable } from './tims-layout';
import type { BatchOut } from '../src/lib/tims-api';
// Entirely invented batches, capsule sets and samples.
const sets = ['Krogh', 'Fable', 'Story', 'Myth'].map((name, i) => ({ ...batch.capsule_set, id: `list-set-${i}`, name, code: `X${i}` }));
const dates = ['2026-11-25', '2026-11-25', '2026-11-25', '2026-11-25', '2026-11-20', '2026-11-16', '2026-11-01', '2026-09-01'];
const batches: BatchOut[] = dates.map((started_on, i) => {
  const set = sets[i === 7 ? 3 : i === 6 ? 2 : i < 4 ? 0 : i % 3];
  return { ...batch, id: `list-batch-${i}`, started_on, capsule_set_id: set.id, capsule_set_name: set.name, capsule_set_code: set.code,
    completed_at: i === 2 ? '2026-11-25T12:00:00Z' : i === 7 ? '2026-09-05T12:00:00Z' : null,
    counts: i === 6 ? undefined : { positions: 15, capsules: i === 3 ? 0 : 5, grain: 5, spike: i === 1 ? 5 : 2, ready: i === 1 ? 5 : 0 },
    schedule: [{ step_id: 'diss-step', method_code: 'SP-TIMS-DISS', step_name: 'Dissolution', date: started_on, capsule_count: 5, minerals: ['zircon'], temperature_c: 210 }],
    samples: [{ id: 'list-sample-a', name: 'Invented sample A' }, { id: 'list-sample-b', name: 'Invented sample B' }], recipe_name: 'Invented recipe', operator_name: 'Invented analyst' };
});
const rowsPath = `/v1/tims/batches?limit=200&lab=${lab}&order=-started_on`;
const calendarPath = `/v1/tims/batches?limit=200&lab=${lab}&schedule_after=2026-11-01&schedule_before=2026-11-30&order=-started_on`;
const octoberPath = `/v1/tims/batches?limit=200&lab=${lab}&schedule_after=2026-10-01&schedule_before=2026-10-31&order=-started_on`;
const lanesPath = `/v1/tims/batches?limit=200&lab=${lab}&schedule_after=2026-09-30&schedule_before=2026-12-23&order=-started_on`;
async function start(page: Page, rows = batches, options: Partial<FakeOptions> = {}) {
  await page.clock.setFixedTime(new Date('2026-11-25T12:00:00Z'));
  await page.route('**/modules/manifest.json', route => route.fulfill({ json: { modules: [] } }));
  await page.addInitScript(installFakeTauri, { signedIn: true, ...options,
    store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'tims', ...options.store },
    fixtures: { ...fixtures, '/v1/tims/capsule-sets?limit=500&lab=synthetic-lab': sets,
      [rowsPath]: rows, [calendarPath]: rows, [octoberPath]: [], [`/v1/tims/batches?limit=200&lab=${lab}&schedule_after=2026-09-01&schedule_before=2026-09-30&order=-started_on`]: [], [lanesPath]: rows,
      ...Object.fromEntries(rows.map(row => [`/v1/tims/batches/${row.id}`, { ...batch, ...row, capsule_set: sets.find(set => set.id === row.capsule_set_id) ?? batch.capsule_set }])), ...options.fixtures } });
  await page.goto('./');
  await expect(page.getByRole('region', { name: 'Batch list', exact: true })).toBeVisible();
  await expect(page.getByTestId('tims-batch-row')).toHaveCount(rows.length);
}
async function view(page: Page, name: 'Rows' | 'Calendar' | 'Lanes') {
  await page.getByRole('radiogroup', { name: 'Batch list view' }).getByRole('radio', { name, exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Loading batches…' })).toHaveCount(0);
}
const reads = (page: Page) => page.evaluate(() => (window as unknown as { __fake: { calls: [string, { path?: string }][] } }).__fake.calls.filter(([cmd]) => cmd === 'api_get').map(([, args]) => args.path!));
test('rows show stored summaries and states, preserve row names and toggle aria-sort', async ({ page }) => {
  await start(page);
  const list = page.getByRole('region', { name: 'Batch list', exact: true });
  for (const state of ['Complete', 'Ready to complete', 'Empty', 'In progress', 'Open']) await expect(list.getByText(state, { exact: true }).first()).toBeVisible();
  await expect(list.getByText('2 of 5 spiked').first()).toBeVisible();
  await expect(list.locator('[title="Invented sample A, Invented sample B"]').first()).toBeVisible();
  const date = list.getByRole('columnheader', { name: /Start date/ });
  await expect(date).toHaveAttribute('aria-sort', 'descending'); await date.getByRole('button').click(); await expect(date).toHaveAttribute('aria-sort', 'ascending');
  const set = list.getByRole('columnheader', { name: /Capsule set/ });
  await set.getByRole('button').click(); await expect(set).toHaveAttribute('aria-sort', 'ascending');
  await set.getByRole('button').click(); await expect(set).toHaveAttribute('aria-sort', 'descending');
  expect((await reads(page)).filter(path => /^\/v1\/tims\/batches\//.test(path))).toHaveLength(0);
});
test('calendar step pills, in-flow overflow, Escape focus return and session month cache', async ({ page }) => {
  await start(page); await view(page, 'Calendar');
  await expect(page.getByText('November 2026', { exact: true })).toBeVisible();
  const calendar = page.getByRole('region', { name: 'Batch calendar' });
  await expect(calendar.locator('[aria-current="date"]')).toHaveAttribute('datetime', '2026-11-25');
  const more = calendar.getByRole('button', { name: '2 more steps on 2026-11-25' }); await expect(more).toHaveText('+2 more'); await more.click();
  const overflow = page.getByRole('region', { name: 'More steps on 2026-11-25' }); await expect(overflow.getByRole('button')).toHaveCount(3);
  await expect(overflow).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(overflow).toHaveCount(0); await expect(more).toBeFocused();
  await page.getByRole('button', { name: 'Previous month' }).click(); await expect(page.getByText('October 2026', { exact: true })).toBeVisible();
  await expect.poll(async () => (await reads(page)).filter(path => path === octoberPath).length).toBe(1);
  await page.getByRole('button', { name: 'Next month' }).click(); await expect(more).toBeVisible();
  expect((await reads(page)).filter(path => path === calendarPath)).toHaveLength(1);
});
test('lanes stack overlaps, show free sets and change drawing zoom', async ({ page }) => {
  await start(page); await view(page, 'Lanes');
  const krogh = page.getByTestId('tims-batch-lane').filter({ hasText: 'Krogh' });
  await expect(krogh.getByTestId('tims-batch-bar')).toHaveCount(4);
  await expect(krogh.locator('[data-track="1"]')).toHaveCount(1);
  await expect(page.getByTestId('tims-batch-lane').filter({ hasText: 'Myth' })).toContainText('free');
  await page.getByRole('radio', { name: 'Months', exact: true }).click(); await expect(page.getByRole('radio', { name: 'Months', exact: true })).toHaveAttribute('aria-checked', 'true');
  expect((await reads(page)).filter(path => path === lanesPath)).toHaveLength(1);
});
for (const theme of ['light', 'dark']) test(`lanes show step kinds and dates at 1280×800 ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const rows = batches.map((row, i) => ({ ...row, schedule: row.schedule!.map(item => i === 0 ? { ...item, method_code: 'SP-TIMS-CA', step_name: 'Chemical abrasion', temperature_c: 210 } : item) }));
  await start(page, rows, { store: { theme, themeChosen: true } }); await view(page, 'Lanes');
  const lanes = page.getByRole('region', { name: 'Batch lanes', exact: true });
  const ca = lanes.getByRole('button', { name: 'Krogh · CA 210 °C · 5', exact: true });
  const diss = lanes.getByRole('button', { name: 'Krogh · Z1 · 5', exact: true }).first();
  await expect(ca).toHaveAttribute('data-kind', 'abrasion'); await expect(diss).toHaveAttribute('data-kind', 'dissolution');
  expect(await ca.evaluate(bar => getComputedStyle(bar).backgroundColor)).not.toBe(await diss.evaluate(bar => getComputedStyle(bar).backgroundColor));
  await expect(ca).toBeInViewport();
  await page.getByRole('radio', { name: 'Months', exact: true }).click();
  await expect(ca).toBeInViewport();
  await page.getByRole('radio', { name: 'Weeks', exact: true }).click();
  await lanes.evaluate(container => { container.scrollLeft = 0; });
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(ca).toBeInViewport();
});
for (const selected of ['Rows', 'Calendar', 'Lanes'] as const) test(`${selected} opens a batch with one click`, async ({ page }) => {
  await start(page); if (selected !== 'Rows') await view(page, selected);
  const target = selected === 'Rows' ? page.getByTestId('tims-batch-row').first() : selected === 'Calendar' ? page.getByRole('region', { name: 'Batch calendar' }).getByRole('button', { name: 'Krogh · Z1 · 5', exact: true }).first() : page.getByTestId('tims-batch-bar').first();
  await target.click(); await expect(page.getByRole('region', { name: 'Chemistry batch', exact: true })).toBeVisible();
});
test('the viewer view choice survives reload', async ({ page }) => {
  await start(page); await view(page, 'Calendar'); await page.reload();
  await expect(page.getByRole('radio', { name: 'Calendar', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('region', { name: 'Batch calendar' }).getByRole('button').first()).toBeVisible();
});
test('older mirror replies render all views without summaries or detail requests', async ({ page }) => {
  const older = batches.map(row => { const { schedule, counts, samples, capsule_set_name, capsule_set_code, recipe_name, completed_by_name, ...old } = row; return old; });
  await start(page, older, { offlineCopy: 'Invented read-only mirror' });
  await expect(page.getByTestId('tims-batch-row').first()).toContainText('—');
  await expect(page.getByTestId('tims-batch-row').first()).toHaveAccessibleDescription(/Open/);
  await view(page, 'Calendar'); await expect(page.getByRole('region', { name: 'Batch calendar' }).getByRole('button').first()).toHaveText('Story');
  await view(page, 'Lanes'); await expect(page.getByText(/Older server: step dates/)).toBeVisible();
  await expect(page.getByTestId('tims-batch-bar').first()).toHaveAttribute('title', /Started/);
  expect((await reads(page)).filter(path => path === lanesPath)).toHaveLength(1);
  expect((await reads(page)).filter(path => /^\/v1\/tims\/batches\//.test(path))).toHaveLength(0);
});
for (const [width, height] of [[1440, 900], [1280, 800], [1024, 640]]) for (const theme of ['light', 'dark']) test(`all batch views fit ${width}×${height} ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width, height }); await start(page, batches, { store: { theme, themeChosen: true } });
  for (const selected of ['Rows', 'Calendar', 'Lanes'] as const) { if (selected !== 'Rows') await view(page, selected); await expectTimsListFits(page); }
});
test('500 rows page progressively with no per-row requests, reporting request count and time', async ({ page }, info) => {
  const many = Array.from({ length: 500 }, (_, i) => ({ ...batches[0], id: `scale-${i}`, started_on: `2026-11-${String(25 - i % 25).padStart(2, '0')}` }));
  const after = (cursor: string) => `/v1/tims/batches?limit=200&after=${cursor}&lab=${lab}&order=-started_on`;
  const started = Date.now();
  await start(page, many.slice(0, 200), { apiReplies: { [rowsPath]: { status: 200, body: many.slice(0, 200), nextCursor: 'scale-2' }, [after('scale-2')]: { status: 200, body: many.slice(200, 400), nextCursor: 'scale-3' }, [after('scale-3')]: { status: 200, body: many.slice(400) } } });
  for (const count of [400, 500]) { await page.getByRole('button', { name: 'Load more batches' }).click(); await expect(page.getByTestId('tims-batch-row')).toHaveCount(count); }
  const calls = await reads(page);
  expect(calls.filter(path => path.startsWith('/v1/tims/batches?'))).toHaveLength(3);
  expect(calls.filter(path => /^\/v1\/tims\/batches\//.test(path))).toHaveLength(0);
  await info.attach('batch-list-scale', { body: `500 rows: 3 list requests, 0 detail requests, ${Date.now() - started} ms. Previous page size: 500 (1 list request). New page size: 200 (1 first-page request; 3 for 500).`, contentType: 'text/plain' });
});

const stepSchedule = [
  { step_id: 'load-step', method_code: 'SP-TIMS-LOAD', step_name: 'Filament load', date: '2026-11-10', capsule_count: 15, minerals: ['zircon'] },
  { step_id: 'ca-step', method_code: 'SP-TIMS-CA', step_name: 'Chemical abrasion', date: '2026-11-11', capsule_count: 15, minerals: ['zircon'], temperature_c: 210 },
  { step_id: 'diss-step', method_code: 'SP-TIMS-DISS', step_name: 'Total dissolution', date: '2026-11-12', capsule_count: 9, minerals: ['zircon'] },
  { step_id: 'diss-step', method_code: 'SP-TIMS-DISS', step_name: 'Total dissolution', date: '2026-11-13', capsule_count: 6, minerals: ['zircon', 'apatite'] },
  { step_id: 'chlor-step', method_code: 'SP-TIMS-CHLOR', step_name: 'Chloride conversion', date: '2026-11-14', capsule_count: 15, minerals: ['zircon'] },
  ...[1, 2, 3, 4].map(n => ({ step_id: `p${n}`, method_code: `SP-TIMS-P${n}`, step_name: `Cleaning ${n}`, date: `2026-11-${14 + n}`, capsule_count: 15, minerals: ['zircon'] })),
];
test('each step date has a pill, including split capsule dates, and opens the selected step', async ({ page }) => {
  const rows = [{ ...batches[0], started_on: '2025-01-01', schedule: stepSchedule }];
  await start(page, rows); await view(page, 'Calendar');
  const calendar = page.getByRole('region', { name: 'Batch calendar' });
  for (const [date, label] of [['10', 'Load · 15'], ['11', 'CA 210 °C · 15'], ['12', 'Z1 · 9'], ['13', 'Z1/A1 · 6'], ['14', 'Z2 · 15'], ['15', 'P1 HCl · 15'], ['16', 'P2 HF · 15'], ['17', 'P3 HCl · 15'], ['18', 'P4 HF · 15']]) {
    const day = calendar.locator('.day').filter({ has: page.locator(`time[datetime="2026-11-${date}"]`) });
    await expect(day.getByRole('button', { name: `Krogh · ${label}`, exact: true })).toBeVisible();
  }
  await expect(calendar.getByRole('button', { name: 'Krogh · CA 210 °C · 15', exact: true })).toHaveAttribute('title', /Chemical abrasion · 2026-11-11 · 15 capsules · 210 °C/);
  await calendar.getByRole('button', { name: 'Krogh · Z1 · 9', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Choose a batch step' }).getByRole('button', { name: /Dissolution/ })).toHaveAttribute('aria-pressed', 'true');
});
for (const [width, height] of [[1440, 900], [1280, 800], [1024, 640]]) test(`calendar month and overflow regions stay within 2 px at ${width}×${height}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height }); await start(page); await view(page, 'Calendar');
  const before = await timsRegionBoxes(page, ['Batch calendar', 'Calendar overflow']);
  const workspace = page.locator('.tims > .workspace');
  const measurements: unknown[] = [];
  async function measure(action: string) {
    const geometry = await workspace.evaluate(node => {
      const calendar = node.querySelector<HTMLElement>('.calendar')!;
      const overflow = node.querySelector<HTMLElement>('.calendar-overflow')!;
      const close = overflow.querySelector('button');
      const bounds = node.getBoundingClientRect();
      return { scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
        calendarY: calendar.getBoundingClientRect().y, overflowY: overflow.getBoundingClientRect().y,
        overflowHeight: overflow.getBoundingClientRect().height,
        workspaceBottom: bounds.top + node.clientTop + node.clientHeight, closeBottom: close?.getBoundingClientRect().bottom ?? null };
    });
    measurements.push({ action, ...geometry });
    return geometry;
  }
  // Keep viewport positions and scrollTop: content coordinates would hide a jump.
  const initial = await measure('before opening overflow');
  async function expectNoScroll(action: string) {
    const after = await measure(action);
    expect(Math.abs(after.scrollTop - initial.scrollTop), `.workspace scrollTop after ${action}: ${JSON.stringify(measurements)}`).toBeLessThanOrEqual(2);
    return after;
  }
  try {
    await page.getByRole('button', { name: '2 more steps on 2026-11-25' }).click();
    await expect(page.getByRole('region', { name: 'More steps on 2026-11-25' })).toBeFocused();
    const opened = await expectNoScroll('opening overflow');
    // Close must be visible without first scrolling the workspace to reach it.
    expect(opened.closeBottom).not.toBeNull();
    expect(opened.closeBottom!).toBeLessThanOrEqual(opened.workspaceBottom);
    // Compare the same reserved overflow region under its expanded accessible name.
    const calendarBefore = { 'Batch calendar': before['Batch calendar'] };
    await expectTimsRegionsStable(page, calendarBefore);
    const expanded = await timsRegionBoxes(page, ['More steps on 2026-11-25']);
    for (const field of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(expanded['More steps on 2026-11-25'][field] - before['Calendar overflow'][field])).toBeLessThanOrEqual(2);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expectNoScroll('closing overflow');
    await expectTimsRegionsStable(page, before);
    await page.getByRole('button', { name: '2 more steps on 2026-11-25' }).click();
    await expect(page.getByRole('region', { name: 'More steps on 2026-11-25' })).toBeFocused();
    await expectNoScroll('reopening overflow');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '2 more steps on 2026-11-25' })).toBeFocused();
    await expectNoScroll('Escape focus return');
    await expectTimsRegionsStable(page, before);
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByText('October 2026', { exact: true })).toBeVisible();
    await expect(page.getByText('October 2026', { exact: true })).toBeFocused();
    await expectNoScroll('previous month (October)');
    await expectTimsRegionsStable(page, before);
    await expect(page.getByRole('status').filter({ hasText: 'Loading batches…' })).toHaveCount(0);
    await expectNoScroll('October loaded');
    await expectTimsRegionsStable(page, before);
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByText('September 2026', { exact: true })).toBeVisible();
    await expectNoScroll('previous month (September)');
    await expectTimsRegionsStable(page, before);
    await expect(page.getByRole('status').filter({ hasText: 'Loading batches…' })).toHaveCount(0);
    await expectNoScroll('September loaded');
    await expectTimsRegionsStable(page, before);
  } finally {
    await info.attach('calendar-scroll-measurements', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  }
});
test('date and set/status filters request step dates without per-batch reads', async ({ page }) => {
  const path = `/v1/tims/batches?limit=200&lab=${lab}&capsule_set=${sets[0].id}&status=picked&schedule_after=2026-11-12&schedule_before=2026-11-13&order=-started_on`;
  await start(page, [{ ...batches[0], started_on: '2025-01-01', schedule: stepSchedule }], { fixtures: { [path]: [{ ...batches[0], schedule: stepSchedule }] } });
  await view(page, 'Calendar');
  await page.getByLabel('Started after', { exact: true }).fill('2026-11-12');
  await page.getByLabel('Started before', { exact: true }).fill('2026-11-13');
  await page.getByLabel('Capsule set', { exact: true }).selectOption(sets[0].id);
  await page.getByLabel('Fraction status', { exact: true }).selectOption('picked');
  await expect.poll(async () => (await reads(page)).includes(path)).toBe(true);
  const calendar = page.getByRole('region', { name: 'Batch calendar' });
  await expect(calendar.locator('.calendar-chip')).toHaveCount(2);
  expect((await reads(page)).filter(path => /^\/v1\/tims\/batches\//.test(path))).toHaveLength(0);
});

test('1800 scheduled batches page progressively with 9 list requests and no detail reads', async ({ page }, info) => {
  const many = Array.from({ length: 1800 }, (_, i) => ({ ...batches[0], id: `schedule-scale-${i}`, schedule: stepSchedule }));
  const path = (page: number) => page === 0 ? calendarPath : `/v1/tims/batches?limit=200&after=schedule-${page}&lab=${lab}&schedule_after=2026-11-01&schedule_before=2026-11-30&order=-started_on`;
  const replies = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [path(i), { status: 200, body: many.slice(i * 200, (i + 1) * 200), ...(i < 8 ? { nextCursor: `schedule-${i + 1}` } : {}) }]));
  await start(page, many.slice(0, 200), { apiReplies: replies });
  const started = Date.now(); await view(page, 'Calendar');
  await expect(page.getByRole('button', { name: '1798 more steps on 2026-11-12' })).toBeVisible();
  const calls = await reads(page);
  expect(calls.filter(path => path.includes('schedule_after='))).toHaveLength(9);
  expect(calls.filter(path => /^\/v1\/tims\/batches\//.test(path))).toHaveLength(0);
  await info.attach('schedule-scale', { body: `1800 batches / 16200 dated items: 9 paged list requests, 0 detail reads, ${Date.now() - started} ms. Before and after: one list request per 200 batches; schedule adds zero requests.`, contentType: 'text/plain' });
});
