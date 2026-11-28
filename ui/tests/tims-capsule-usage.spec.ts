import { expect, test, type Page } from '@playwright/test';
import { batch, fixtures, lab } from './fixtures/tims';
import type { BatchOut, ScheduleItem } from '../src/lib/tims-api';
import { expectTimsListFits } from './tims-layout';

// Invented records only; pages are generated from an index, never lab data.
const sets = [batch.capsule_set, { ...batch.capsule_set, id: 'inactive-set', name: 'Fable', code: 'F', active: false }];
const schedule: ScheduleItem[] = [
  { step_id: 'ca-step', method_code: 'SP-TIMS-CA', step_name: 'Chemical abrasion', date: '2026-11-10', capsule_count: 15, minerals: ['zircon'], temperature_c: 190 },
  { step_id: 'diss-step', method_code: 'SP-TIMS-DISS', step_name: 'Dissolution', date: '2026-11-12', capsule_count: 9, minerals: ['zircon'] },
  { step_id: 'diss-step', method_code: 'SP-TIMS-DISS', step_name: 'Dissolution', date: '2026-11-13', capsule_count: 6, minerals: ['zircon', 'apatite'] },
];
const row = (index: number, set = sets[0].id): BatchOut => ({ ...batch, id: index ? `usage-${index}` : batch.id, capsule_set_id: set, started_on: '2025-01-01', schedule });
const history = (page: Page) => page.getByRole('region', { name: 'Capsule set history', exact: true });
const month = (page: Page) => page.getByRole('region', { name: 'Set usage month', exact: true });
type Read = { query: URLSearchParams; etag?: string; status: number; ms: number };
async function start(page: Page, options: { total?: number; readOnly?: boolean; legacy?: boolean; theme?: string } = {}) {
  // Playwright's WebKit interception rejects fulfillment with a 304. Verify
  // conditional headers in both engines and exercise the 304 path in Chromium.
  const revalidatedStatus = page.context().browser()?.browserType().name() === 'webkit' ? 200 : 304;
  await page.clock.setFixedTime(new Date('2026-11-25T12:00:00Z'));
  await page.route('**/modules/manifest.json', route => route.fulfill({ json: { modules: [] } }));
  const reads: Read[] = [], details: string[] = [], writes: string[] = [];
  let failure = false, heldMonth = '';
  const releases: (() => void)[] = [];
  await page.route('**/v1/**', async route => {
    const req = route.request(), url = new URL(req.url()), headers: Record<string, string> = {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type, If-None-Match',
      'Access-Control-Expose-Headers': 'ETag, X-Next-Cursor', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (req.method() !== 'GET') writes.push(url.pathname);
    let body: unknown = fixtures[url.pathname + url.search] ?? fixtures[url.pathname] ?? [], status = 200;
    if (url.pathname === '/v1/tims/capsule-sets') body = sets;
    if (url.pathname === '/v1/labs') body = [{ id: lab, name: 'Invented lab', my_role: 'member' }];
    if (url.pathname === '/v1/accounts' && url.searchParams.get('view_as') === 'true') body = [{ id: 'viewer', username: 'invented-viewer', display_name: 'Invented viewer' }];
    if (url.pathname === '/v1/tims/batches' && url.searchParams.has('capsule_set')) {
      const begin = Date.now(), query = url.searchParams, selected = query.get('capsule_set')!;
      expect(query.get('lab')).toBe(lab); expect(query.get('limit')).toBe('200'); expect(query.get('order')).toBe('-started_on');
      expect(query.get('schedule_after')).toMatch(/^\d{4}-\d{2}-01$/); expect(query.get('schedule_before')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (query.get('schedule_after') === heldMonth) await new Promise<void>(resolve => releases.push(resolve));
      const offset = Number(query.get('after') ?? 0), total = options.total ?? 3;
      const inNovember = query.get('schedule_after') === '2026-11-01';
      body = inNovember ? Array.from({ length: Math.min(200, total - offset) }, (_, n) => row(offset + n, selected)) : [];
      if (options.legacy) body = [{ ...row(0, selected), started_on: '2026-11-06', schedule: undefined }];
      // Inject a wrong-set record to prove client-side scoping as well as query scoping.
      if (inNovember && !options.legacy && !options.total) (body as BatchOut[]).push(row(999, 'wrong-set'));
      if (inNovember && offset + 200 < total) headers['X-Next-Cursor'] = String(offset + 200);
      const tag = `"usage-${selected}-${query.get('schedule_after')}-${offset}"`;
      headers.ETag = tag;
      if (failure) { status = 503; body = { detail: 'Invented schedule outage' }; }
      else if (req.headers()['if-none-match'] === tag) status = revalidatedStatus;
      reads.push({ query, etag: req.headers()['if-none-match'], status, ms: Date.now() - begin });
    } else if (/^\/v1\/tims\/batches\//.test(url.pathname)) { details.push(url.pathname); body = batch; }
    else if (url.pathname === '/v1/tims/batches') body = [batch];
    await route.fulfill({ status, headers, ...(status === 304 ? {} : { json: body }) });
  });
  await page.addInitScript(({ theme }) => {
    localStorage.setItem('upbstudio.settings', JSON.stringify({ mode: 'server', lastTab: 'tims', theme, themeChosen: true }));
    sessionStorage.setItem('upbstudio.token:http://localhost:8000', 'invented-usage-token');
  }, { theme: options.theme ?? 'light' });
  await page.goto('./?server=http://localhost:8000');
  if (options.readOnly) await page.getByLabel('View as', { exact: true }).selectOption('invented-viewer');
  await page.getByRole('navigation', { name: 'TIMS sections' }).getByRole('button', { name: 'Capsule sets', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Usage calendar for Krogh K', exact: true })).toBeVisible();
  return { reads, details, writes, revalidatedStatus, fail: (value: boolean) => failure = value, hold: (value: string) => heldMonth = value, release: () => { heldMonth = ''; for (const release of releases.splice(0)) release(); } };
}
async function open(page: Page, name = 'Krogh K') {
  await page.getByRole('button', { name: `Usage calendar for ${name}`, exact: true }).click();
  await expect(history(page)).toBeVisible();
  await expect(history(page).getByText('Loading usage…', { exact: true })).toHaveCount(0);
}

test('set history keeps editor/audit actions and shows step counts, overflow and exact batch/step navigation', async ({ page }) => {
  const state = await start(page); await open(page);
  await expect(history(page).getByRole('heading', { name: 'Krogh K · active' })).toBeVisible();
  await expect(history(page).getByRole('heading', { name: 'Krogh K · active' })).toBeFocused();
  await expect(history(page)).toContainText('Counts show how many capsules were recorded for each step');
  await expect(month(page).locator('.day').filter({ has: page.locator('time[datetime="2026-11-10"]') }).locator('.calendar-chip').first()).toHaveText('CA 190 °C · 15');
  const more = month(page).getByRole('button', { name: '1 more steps on 2026-11-12' });
  await more.click();
  const overflow = page.getByRole('region', { name: 'More steps on 2026-11-12' });
  await expect(overflow).toBeFocused(); await expect(overflow.locator('.calendar-chip')).toHaveCount(1);
  await page.keyboard.press('Escape'); await expect(more).toBeFocused();
  await expect(month(page).getByRole('button', { name: /Batch usage-999/ })).toHaveCount(0);
  expect(state.details).toHaveLength(0); expect(state.reads).toHaveLength(1);
  await page.getByRole('button', { name: 'Krogh K', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Capsule set editor' }).getByRole('button', { name: 'History', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close set', exact: true }).click();
  await month(page).getByRole('button', { name: /Z1 · 9 capsules · Batch batch-synthetic/ }).click();
  await expect(page.getByRole('group', { name: 'Choose a batch step' }).getByRole('button', { name: /Dissolution/ })).toHaveAttribute('aria-pressed', 'true');
  expect(state.details).toContain(`/v1/tims/batches/${batch.id}`); expect(state.writes).toHaveLength(0);
});

test('inactive sets are readable without edit permission; switch, close and reopen revalidate ETags', async ({ page }) => {
  const state = await start(page, { readOnly: true });
  await expect(page.getByRole('button', { name: 'New capsule set', exact: true })).toBeDisabled();
  await open(page, 'Fable F');
  await expect(history(page).getByRole('heading', { name: 'Fable F · inactive' })).toBeVisible();
  expect(state.reads[0].query.get('capsule_set')).toBe('inactive-set');
  await history(page).getByLabel('History for capsule set').selectOption('set-k');
  await expect(history(page).getByRole('heading', { name: 'Krogh K · active' })).toBeVisible();
  await expect.poll(() => state.reads.length).toBe(2);
  await page.getByRole('button', { name: 'Close usage calendar' }).click(); await expect(history(page)).toHaveCount(0);
  await open(page, 'Fable F'); await expect.poll(() => state.reads.length).toBe(3);
  expect(state.reads[2]).toMatchObject({ status: state.revalidatedStatus, etag: '"usage-inactive-set-2026-11-01-0"' });
  expect(state.writes).toHaveLength(0); expect(state.details).toHaveLength(0);
});

test('month/year jump, empty, error/retry and late month/set/view replies', async ({ page }) => {
  const state = await start(page); await open(page);
  state.hold('2026-10-01'); await history(page).getByRole('button', { name: 'Previous month' }).click();
  await expect(history(page).getByText('Loading usage…', { exact: true })).toBeVisible();
  await history(page).getByLabel('History for capsule set').selectOption('inactive-set');
  await history(page).getByRole('button', { name: 'Current month' }).click();
  await expect(month(page).locator('.calendar-chip').first()).toBeVisible(); state.release();
  await expect(history(page).getByRole('heading', { name: 'Fable F · inactive' })).toBeVisible();
  await expect(month(page).locator('.calendar-chip').first()).toBeVisible();
  await history(page).getByLabel('Month / year').fill('2020-02');
  await history(page).getByLabel('Month / year').dispatchEvent('change');
  await expect(history(page).getByText('February 2020', { exact: true })).toBeVisible();
  await expect(history(page)).toContainText('No recorded usage in the loaded batches for this month.');
  expect(state.reads.at(-1)!.query.get('schedule_before')).toBe('2020-02-29');
  state.fail(true); await history(page).getByRole('button', { name: 'Next month' }).click();
  await expect(history(page).getByRole('status')).toContainText(/503.*Invented schedule outage/);
  state.fail(false); await history(page).getByRole('button', { name: 'Retry usage' }).click();
  await expect(history(page).getByRole('button', { name: 'Retry usage' })).toHaveCount(0);
  await expect(history(page)).toContainText('No recorded usage');
  state.hold('2020-04-01'); await history(page).getByRole('button', { name: 'Next month' }).click();
  await expect(history(page).getByText('Loading usage…', { exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'TIMS sections' }).getByRole('button', { name: 'Recipes', exact: true }).click();
  state.release(); await expect(history(page)).toHaveCount(0);
  expect(state.details).toHaveLength(0);
});

test('account view changes discard a late reply and start with a separate ETag scope', async ({ page }) => {
  const state = await start(page); await open(page);
  state.hold('2026-10-01');
  await history(page).getByRole('button', { name: 'Previous month' }).click();
  await expect(history(page).getByText('Loading usage…', { exact: true })).toBeVisible();
  await page.getByLabel('View as', { exact: true }).selectOption('invented-viewer');
  await expect(history(page)).toHaveCount(0);
  await open(page, 'Fable F');
  state.release();
  await expect(history(page).getByRole('heading', { name: 'Fable F · inactive' })).toBeVisible();
  await expect(month(page).locator('.calendar-chip').first()).toBeVisible();
  const scoped = state.reads.filter(read => read.query.get('as') === 'invented-viewer');
  expect(scoped).toHaveLength(1); expect(scoped[0].etag).toBeUndefined(); expect(scoped[0].status).toBe(200);
  expect(state.details).toHaveLength(0); expect(state.writes).toHaveLength(0);
});

test('legacy schedule fallback is only a batch start, never inferred steps or zero capsule values', async ({ page }) => {
  const state = await start(page, { legacy: true }); await open(page);
  await expect(history(page)).toContainText('Only loaded batch start dates');
  await expect(month(page).locator('.calendar-chip')).toHaveText('Batch start');
  await expect(month(page).locator('.calendar-chip')).toHaveAttribute('aria-label', /Batch start · Batch batch-synthetic.*2026-11-06/);
  await expect(month(page).locator('.calendar-chip')).toHaveAttribute('title', 'Batch batch-synthetic · started 2026-11-06 · Batch start · 2026-11-06');
  expect(state.details).toHaveLength(0);
});

test('2400 batches load only on demand; exact pages revalidate with ETags and no detail reads', async ({ page }, info) => {
  const state = await start(page, { total: 2400 }); const begin = Date.now(); await open(page);
  await expect(history(page)).toContainText('Showing 200 loaded batches');
  const firstMs = Date.now() - begin;
  expect(state.reads).toHaveLength(1);
  for (let i = 2; i <= 12; i++) {
    await history(page).getByRole('button', { name: 'Load more usage', exact: true }).click();
    await expect(month(page).getByRole('button', { name: `${i * 200 - 2} more steps on 2026-11-12` })).toBeVisible();
    expect(state.reads).toHaveLength(i);
  }
  await expect(history(page).getByRole('button', { name: 'Load more usage' })).toHaveCount(0);
  const allMs = Date.now() - begin;
  await history(page).getByRole('button', { name: 'Previous month' }).click();
  await expect(history(page)).toContainText('No recorded usage');
  await history(page).getByRole('button', { name: 'Next month' }).click();
  await expect(history(page)).toContainText('Showing 200 loaded batches');
  expect(state.reads.at(-1)).toMatchObject({ status: state.revalidatedStatus, etag: '"usage-set-k-2026-11-01-0"' });
  await history(page).getByRole('button', { name: 'Load more usage' }).click();
  await expect(history(page)).toContainText('Showing 400 loaded batches');
  expect(state.reads.at(-1)).toMatchObject({ status: state.revalidatedStatus, etag: '"usage-set-k-2026-11-01-200"' });
  expect(state.details).toHaveLength(0);
  await info.attach('capsule-usage-scale', { contentType: 'application/json', body: JSON.stringify({ total: 2400, firstPageRequests: 1, allPageRequests: 12, detailRequests: 0, firstMs, allMs, before: 'The existing batch calendar automatically reads up to ten pages and truncates the result. The set calendar reads the first page, then one page per Load more action.', reads: state.reads.map(read => ({ query: read.query.toString(), status: read.status, ms: read.ms })) }, null, 2) });
});

for (const [width, height] of [[1440, 900], [1280, 800]]) for (const theme of ['light', 'dark']) test(`set usage fits ${width}×${height} ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width, height }); await start(page, { theme }); await open(page);
  await expectTimsListFits(page);
  await month(page).getByRole('button', { name: '1 more steps on 2026-11-12' }).click();
  await expect(page.getByRole('region', { name: 'More steps on 2026-11-12' })).toBeFocused();
  await expectTimsListFits(page);
  await expect(history(page).getByRole('button', { name: 'Close usage calendar' })).toBeEnabled();
});
