import { test, expect, type Page } from '@playwright/test';
import { installFakeTauri, type FakeOptions } from './fake-tauri';
import { fixtures, batch, lab } from './fixtures/tims';
import { expectTimsListFits } from './tims-layout';
import type { BatchOut } from '../src/lib/tims-api';
// Entirely invented batches, capsule sets and samples.
const sets = ['Krogh', 'Fable', 'Story', 'Myth'].map((name, i) => ({ ...batch.capsule_set, id: `list-set-${i}`, name, code: `X${i}` }));
const dates = ['2026-11-25', '2026-11-25', '2026-11-25', '2026-11-25', '2026-11-20', '2026-11-16', '2026-11-01', '2026-09-01'];
const batches: BatchOut[] = dates.map((started_on, i) => {
  const set = sets[i === 7 ? 3 : i === 6 ? 2 : i < 4 ? 0 : i % 3];
  return { ...batch, id: `list-batch-${i}`, started_on, capsule_set_id: set.id, capsule_set_name: set.name, capsule_set_code: set.code,
    completed_at: i === 2 ? '2026-11-25T12:00:00Z' : i === 7 ? '2026-09-05T12:00:00Z' : null,
    counts: i === 6 ? undefined : { positions: 15, capsules: i === 3 ? 0 : 5, grain: 5, spike: i === 1 ? 5 : 2, ready: i === 1 ? 5 : 0 },
    samples: [{ id: 'list-sample-a', name: 'Invented sample A' }, { id: 'list-sample-b', name: 'Invented sample B' }], recipe_name: 'Invented recipe', operator_name: 'Invented analyst' };
});
const rowsPath = `/v1/tims/batches?limit=200&lab=${lab}&order=-started_on`;
const calendarPath = `/v1/tims/batches?limit=200&lab=${lab}&started_after=2026-11-01&started_before=2026-11-30&order=-started_on`;
const octoberPath = `/v1/tims/batches?limit=200&lab=${lab}&started_after=2026-10-01&started_before=2026-10-31&order=-started_on`;
const lanesPath = `/v1/tims/batches?limit=200&lab=${lab}&started_before=2026-12-23&active_after=2026-09-30&order=-started_on`;
const legacyLanesPath = `/v1/tims/batches?limit=200&lab=${lab}&started_after=2026-06-02&started_before=2026-12-23&active_after=2026-09-30&order=-started_on`;
async function start(page: Page, rows = batches, options: Partial<FakeOptions> = {}) {
  await page.clock.setFixedTime(new Date('2026-11-25T12:00:00Z'));
  await page.route('**/modules/manifest.json', route => route.fulfill({ json: { modules: [] } }));
  await page.addInitScript(installFakeTauri, { signedIn: true, ...options,
    store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'tims', ...options.store },
    fixtures: { ...fixtures, '/v1/tims/capsule-sets?limit=500&lab=synthetic-lab': sets,
      [rowsPath]: rows, [calendarPath]: rows, [octoberPath]: [], [lanesPath]: rows, [legacyLanesPath]: rows,
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
test('calendar chips, overflow dialog, Escape focus return and session month cache', async ({ page }) => {
  await start(page); await view(page, 'Calendar');
  await expect(page.getByText('November 2026', { exact: true })).toBeVisible();
  const calendar = page.getByRole('region', { name: 'Batch calendar' });
  await expect(calendar.locator('[aria-current="date"]')).toHaveAttribute('datetime', '2026-11-25');
  const more = calendar.getByRole('button', { name: '2 more batches on 2026-11-25' }); await expect(more).toHaveText('+2 more'); await more.click();
  const dialog = page.getByRole('dialog', { name: 'More batches on 2026-11-25' }); await expect(dialog.getByRole('button')).toHaveCount(3);
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(more).toBeFocused();
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
for (const theme of ['light', 'dark']) test(`lanes show state colours, today and stacked open batches at 1280×800 ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const tilton = { ...sets[2], name: 'Tilton' };
  const overlaps = batches.map((row, i) => i === 4 || i === 5 ? { ...row, capsule_set_id: tilton.id, capsule_set_name: tilton.name, capsule_set_code: tilton.code, started_on: i === 4 ? '2026-11-24' : '2026-11-16' } : row);
  await start(page, overlaps, { store: { theme, themeChosen: true }, fixtures: {
    '/v1/tims/capsule-sets?limit=500&lab=synthetic-lab': sets.map(set => set.id === tilton.id ? tilton : set),
  } });
  await view(page, 'Lanes');
  const lanes = page.getByRole('region', { name: 'Batch lanes', exact: true });
  const todayVisible = () => lanes.evaluate(container => {
    const bounds = container.getBoundingClientRect();
    const line = container.querySelector('.today-line')!.getBoundingClientRect();
    return line.left >= bounds.left + container.clientLeft + 130 && line.right <= bounds.left + container.clientLeft + container.clientWidth
      && line.top >= bounds.top + container.clientTop && line.bottom <= bounds.top + container.clientTop + container.clientHeight;
  });
  await expect.poll(todayVisible).toBe(true);
  const complete = lanes.getByRole('button', { name: 'Krogh · 2026-11-25 · Complete', exact: true });
  const inProgress = lanes.getByRole('button', { name: 'Krogh · 2026-11-25 · In progress', exact: true });
  expect(await complete.evaluate(bar => getComputedStyle(bar).backgroundColor)).not.toBe(await inProgress.evaluate(bar => getComputedStyle(bar).backgroundColor));
  const openBars = ['2026-11-16', '2026-11-24'].map(date => lanes.getByRole('button', { name: `Tilton · ${date} · In progress`, exact: true }));
  for (const bar of openBars) await expect(bar).toBeInViewport({ ratio: 1 });
  const [first, second] = await Promise.all(openBars.map(bar => bar.boundingBox()));
  expect(first!.y + first!.height, 'overlapping open batches occupy separate vertical tracks').toBeLessThanOrEqual(second!.y);
  expect(await openBars[0].getAttribute('data-track')).not.toBe(await openBars[1].getAttribute('data-track'));
  await page.getByRole('radio', { name: 'Months', exact: true }).click();
  await expect.poll(todayVisible).toBe(true);
  await page.getByRole('radio', { name: 'Weeks', exact: true }).click();
  await expect.poll(todayVisible).toBe(true);
  await lanes.evaluate(container => { container.scrollLeft = 0; });
  await expect.poll(todayVisible).toBe(false);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect.poll(todayVisible).toBe(true);
});
for (const selected of ['Rows', 'Calendar', 'Lanes'] as const) test(`${selected} opens a batch with one click`, async ({ page }) => {
  await start(page); if (selected !== 'Rows') await view(page, selected);
  const target = selected === 'Rows' ? page.getByTestId('tims-batch-row').first() : selected === 'Calendar' ? page.getByRole('region', { name: 'Batch calendar' }).getByRole('button', { name: 'Krogh · 2026-11-25 · In progress', exact: true }) : page.getByTestId('tims-batch-bar').first();
  await target.click(); await expect(page.getByRole('region', { name: 'Chemistry batch', exact: true })).toBeVisible();
});
test('the viewer view choice survives reload', async ({ page }) => {
  await start(page); await view(page, 'Calendar'); await page.reload();
  await expect(page.getByRole('radio', { name: 'Calendar', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('region', { name: 'Batch calendar' }).getByRole('button').first()).toBeVisible();
});
test('older mirror replies render all views without summaries or detail requests', async ({ page }) => {
  const older = batches.map(row => { const { counts, samples, capsule_set_name, capsule_set_code, recipe_name, completed_by_name, ...old } = row; return old; });
  await start(page, older, { offlineCopy: 'Invented read-only mirror' });
  await expect(page.getByTestId('tims-batch-row').first()).toContainText('—');
  await expect(page.getByTestId('tims-batch-row').first()).toHaveAccessibleDescription(/Open/);
  await view(page, 'Calendar'); await expect(page.getByRole('region', { name: 'Batch calendar' }).getByRole('button').first()).toHaveText('Story');
  await view(page, 'Lanes'); await expect(page.getByText(/Older server: scanning/)).toBeVisible();
  await expect(page.getByTestId('tims-batch-bar').first()).toHaveAttribute('title', /—/);
  expect((await reads(page)).filter(path => path === legacyLanesPath)).toHaveLength(1);
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
