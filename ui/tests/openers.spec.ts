import { test, expect, type Page } from '@playwright/test';
import { calls, openReview, inside } from './review-helpers';
import { session, mount, runs, table } from './fixtures/review';

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const details = (page: Page) => page.getByTestId('review-details');
const launches = async (page: Page, name: string) => (await calls(page)).filter(([c]) => c === name);
const projectPath = '/v1/atlas/projects/project-demo';
const atlas = { mount_id: mount.id, revision: 1, atlas_version: 1 };
const fixtures = { [projectPath]: atlas, [`/v1/sessions/${session.id}`]: session, [`/v1/runs/${runs[1].id}`]: runs[1] };
async function select(page: Page, key = 'acq-2') {
  await page.locator(`[data-spot-key="${key}"]`).click();
  await expect(details(page).getByRole('heading', { name: 'Zircon_2', exact: true })).toBeVisible();
}
async function focusPage(page: Page) { await page.evaluate(() => window.dispatchEvent(new Event('focus'))); }

test('details open both apps at the selected analysis and leave Review active', async ({ page }) => {
  await openReview(page, { studioFound: true, fixtures });
  await select(page);
  await details(page).getByRole('button', { name: 'Edit in grainatlas', exact: true }).click();
  await expect.poll(async () => (await launches(page, 'grainatlas_launch')).at(-1)?.[1]).toMatchObject({ project: 'project-demo', spot: 'atlas-2', code: 'ONE-TIME-FIXTURE' });
  await expect(tab(page, 'Review')).toHaveAttribute('aria-selected', 'true');
  await details(page).getByRole('button', { name: 'Open in Studio', exact: true }).click();
  await expect.poll(async () => (await launches(page, 'studio_launch')).length).toBe(1);
  const url = new URL((await launches(page, 'studio_launch'))[0][1]!.url as string);
  expect(url.host + url.pathname).toBe('run/run-preferred');
  expect(url.searchParams.get('acquisition')).toBe('acq-2');
  expect(url.searchParams.get('via')).toBe('upblab');
  expect(url.searchParams.get('code')).toBe('ONE-TIME-FIXTURE');
  await expect(tab(page, 'Review')).toHaveAttribute('aria-selected', 'true');
});

test('plot context menu selects the point, stays in its tile and supports keyboard access', async ({ page }) => {
  await openReview(page, { studioFound: true, fixtures });
  const point = page.locator('.point-target[data-point-key="acq-2"]').first();
  await point.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Spot actions' });
  await expect(menu).toBeVisible();
  await expect(details(page).getByRole('heading', { name: 'Zircon_2', exact: true })).toBeVisible();
  await inside(menu, page.locator('[data-review-panel="plots"]'));
  await expect(menu.getByRole('menuitem', { name: 'Show in Images', exact: true })).toBeVisible();
  await menu.getByRole('menuitem', { name: /Edit in grainatlas/ }).click();
  await expect.poll(async () => (await launches(page, 'grainatlas_launch')).length).toBe(1);
  await point.focus();
  await point.press('Shift+F10');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /Open in Studio/ }).click();
  await expect.poll(async () => (await launches(page, 'studio_launch')).length).toBe(1);
  await point.focus(); await point.press('ContextMenu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await expect(point).toBeFocused();
});

test('E and S open the selected spot; typing, modifiers and other tabs do not', async ({ page }) => {
  await openReview(page, { studioFound: true, fixtures });
  await select(page);
  await page.keyboard.press('e'); await page.keyboard.press('s');
  await expect.poll(async () => (await launches(page, 'grainatlas_launch')).length).toBe(1);
  await expect.poll(async () => (await launches(page, 'studio_launch')).length).toBe(1);
  await page.getByLabel('Filter spots').fill('es');
  await page.getByLabel('Filter spots').press('e');
  await page.getByLabel('Filter spots').fill('');
  await page.getByLabel('Filter spots').blur();
  await page.keyboard.press('Shift+E');
  await tab(page, 'Home').click();
  await page.keyboard.press('e'); await page.keyboard.press('s');
  expect((await launches(page, 'grainatlas_launch')).length).toBe(1);
  expect((await launches(page, 'studio_launch')).length).toBe(1);
});

test('missing grainatlas gives inline installation guidance and an Images fallback', async ({ page }) => {
  await openReview(page, { fixtures, grainatlasLaunchErrors: ['GrainAtlas is not installed (looked in /Applications and ~/Applications)'] });
  await details(page).getByRole('button', { name: 'Edit in grainatlas', exact: true }).click();
  const guidance = details(page).getByRole('status');
  await expect(guidance).toContainText('~/Applications');
  await expect(tab(page, 'Review')).toHaveAttribute('aria-selected', 'true');
  await guidance.getByRole('button', { name: 'Show in Images', exact: true }).click();
  await expect(tab(page, 'Images')).toHaveAttribute('aria-selected', 'true');
});

test('missing Studio stays inline in Review', async ({ page }) => {
  await openReview(page, { fixtures });
  await details(page).getByRole('button', { name: 'Open in Studio', exact: true }).click();
  await expect(details(page).getByRole('status')).toContainText('Studio is not installed');
  await expect(tab(page, 'Review')).toHaveAttribute('aria-selected', 'true');
});

test('Home mount editor and session Reduce keep their context', async ({ page }) => {
  await openReview(page, { studioFound: true, fixtures });
  await tab(page, 'Home').click();
  await page.getByTestId('mount-card').getByRole('button', { name: 'Edit in grainatlas', exact: true }).click();
  await expect.poll(async () => (await launches(page, 'grainatlas_launch')).length).toBe(1);
  const args = (await launches(page, 'grainatlas_launch'))[0][1]!;
  expect(args.project).toBe('project-demo'); expect(args.spot).toBeUndefined(); expect(args.grain).toBeUndefined();
  const reduce = page.getByTestId('session-card').getByRole('button', { name: 'Reduce', exact: true });
  await expect(reduce).not.toHaveAttribute('title', /Studio/);
  await reduce.click();
  await expect.poll(async () => (await launches(page, 'studio_launch')).length).toBe(1);
  const url = new URL((await launches(page, 'studio_launch'))[0][1]!.url as string);
  expect(url.host + url.pathname).toBe(`session/${session.id}`);
  expect(url.searchParams.get('via')).toBe('upblab');
  await expect(tab(page, 'Home')).toHaveAttribute('aria-selected', 'true');
});

test('Reduce lists not started, in progress and submitted sessions', async ({ page }) => {
  const fresh = { ...session, id: 'session-fresh', session_key: 'Fresh demo', run_count: 0 };
  const opened = { ...fresh, id: 'session-opened', session_key: 'Opened demo' };
  await openReview(page, { studioFound: true, store: { studioOpened: { [opened.id]: '2026-11-13T10:00:00Z' } }, fixtures: {
    ...fixtures, '/v1/sessions': [session, fresh, opened], [`/v1/sessions/${fresh.id}`]: fresh, [`/v1/sessions/${opened.id}`]: opened,
    [`/v1/sessions/${fresh.id}/reductions`]: [], [`/v1/sessions/${opened.id}/reductions`]: [],
  } });
  await tab(page, 'Reduce').click();
  const list = page.getByTestId('reduce-sessions');
  await expect(list.locator('article').filter({ hasText: session.session_key })).toContainText('submitted');
  await expect(list.locator('article').filter({ hasText: 'Fresh demo' })).toContainText('not started');
  await expect(list.locator('article').filter({ hasText: 'Opened demo' })).toContainText('in progress');
  await expect(list.locator('article').filter({ hasText: session.session_key }).getByRole('button', { name: 'Review', exact: true })).toBeVisible();
  await list.locator('article').filter({ hasText: 'Fresh demo' }).getByRole('button', { name: 'Open in Studio', exact: true }).click();
  await expect(list.locator('article').filter({ hasText: 'Fresh demo' })).toContainText('in progress');
});

test('submitted run link opens Review on that run with the same acquisition selected', async ({ page }) => {
  await openReview(page, { fixtures }); await select(page);
  await tab(page, 'Home').click();
  // The same plugin event used by the desktop OS deep-link delivery.
  await page.evaluate(() => (window as unknown as { __emit(e: string, p: unknown): Promise<void> }).__emit('deep-link://new-url', ['laicpmsdb://run/run-newer']));
  await expect(tab(page, 'Review')).toHaveAttribute('aria-selected', 'true');
  await expect(details(page).getByRole('heading', { name: 'Zircon_2', exact: true })).toBeVisible();
  await expect(details(page)).toContainText('run-newer');
  await expect.poll(async () => (await calls(page)).some(([c, a]) => c === 'api_get' && a?.path === `/v1/sessions/${session.id}/results?run=run-newer`)).toBe(true);
});

test('watched revision refreshes Review without a v4 notice and preserves selection', async ({ page }) => {
  await openReview(page, { fixtures }); await select(page);
  await details(page).getByRole('button', { name: 'Edit in grainatlas', exact: true }).click();
  await expect.poll(async () => (await calls(page)).filter(([c, a]) => c === 'api_get' && a?.path === projectPath).length).toBe(1);
  const count = (await calls(page)).filter(([c, a]) => c === 'api_get' && a?.path === `/v1/sessions/${session.id}/results?run=preferred`).length;
  await page.evaluate(({ path, body, results }) => {
    const fake = (window as unknown as { __fake: { fixtures: Record<string, unknown> } }).__fake;
    fake.fixtures[path] = body;
    fake.fixtures['/v1/sessions/session-demo/results?run=preferred'] = results;
  }, { path: projectPath, body: { ...atlas, revision: 2 }, results: { ...table, rows: table.rows.map(r => ({ ...r, preferred_date: 777 })) } });
  await focusPage(page);
  await expect.poll(async () => (await calls(page)).filter(([c, a]) => c === 'api_get' && a?.path === `/v1/sessions/${session.id}/results?run=preferred`).length).toBeGreaterThan(count);
  await expect(details(page).getByRole('heading', { name: 'Zircon_2', exact: true })).toBeVisible();
  await expect(details(page)).toContainText('777');
  await expect(page.locator('[data-spot-key="acq-2"]')).toHaveClass(/selected/);
});

test('a watched session submission refreshes its Home row and Review selection', async ({ page }) => {
  await openReview(page, { fixtures, studioFound: true }); await select(page);
  await details(page).getByRole('button', { name: 'Open in Studio', exact: true }).click();
  await expect.poll(async () => (await launches(page, 'studio_launch')).length).toBe(1);
  await expect.poll(async () => (await calls(page)).filter(([c, a]) => c === 'api_get' && a?.path === `/v1/sessions/${session.id}/reductions`).length).toBeGreaterThan(1);
  await page.evaluate(({ session, runs, table }) => {
    const data = (window as unknown as { __fake: { fixtures: Record<string, unknown> } }).__fake.fixtures;
    data[`/v1/sessions/${session.id}/reductions`] = [...runs.map(r => ({ ...r, is_preferred_for_session: false })), { ...runs[0], id: 'run-submitted', pipeline_version: '0.2.0', started_at: '2026-11-14T10:00:00Z', completed_at: '2026-11-14T11:00:00Z' }];
    data[`/v1/sessions/${session.id}/results?run=preferred`] = { ...table, rows: table.rows.map(r => ({ ...r, preferred_date: 888 })) };
  }, { session, runs, table });
  // A focus after the initial baseline has settled sees the appended run id.
  await expect.poll(async () => { await focusPage(page); return await details(page).textContent(); }).toContain('888');
  await expect(details(page).getByRole('heading', { name: 'Zircon_2', exact: true })).toBeVisible();
  await tab(page, 'Home').click();
  await expect(page.getByTestId('session-card')).toContainText('UPbRPy 0.2.0');
});

test('Home missing-grainatlas fallback remains clickable within the card', async ({ page }) => {
  await openReview(page, { fixtures, grainatlasLaunchErrors: ['GrainAtlas is not installed (looked in /Applications and ~/Applications)'] });
  await tab(page, 'Home').click();
  const card = page.getByTestId('mount-card');
  await card.getByRole('button', { name: 'Edit in grainatlas', exact: true }).click();
  await expect(card.getByRole('status')).toContainText('~/Applications');
  await card.getByRole('button', { name: 'Show in Images', exact: true }).click();
  await expect(tab(page, 'Images')).toHaveAttribute('aria-selected', 'true');
});

test('geochemistry point menus offer the same in-context actions', async ({ page }) => {
  await openReview(page, { fixtures, studioFound: true });
  await tab(page, 'Geochemistry').click();
  // Points outside a panel's axes are clipped by the chart; right-click one that is drawn.
  const drawn = () => page.locator('.point-target').evaluateAll(nodes => nodes.findIndex(n => {
    const r = n.getBoundingClientRect(), c = n.closest('.chart')!.getBoundingClientRect();
    return r.width > 0 && r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom;
  }));
  // Wait for the board's panels to settle before choosing a point.
  await expect.poll(drawn).toBeGreaterThanOrEqual(0);
  await page.waitForTimeout(300);
  const index = await drawn();
  await page.locator('.point-target').nth(index).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Spot actions' });
  await expect(menu.getByRole('menuitem', { name: /Edit in grainatlas/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Open in Studio/ })).toBeVisible();
  await inside(menu, page.locator('[data-review-panel="plots"]'));
});


test('failed Studio launch gives inline guidance in Review', async ({ page }) => {
  await openReview(page, { fixtures, studioFound: true, studioLaunchErrors: ['Could not open Studio: fixture launch failure'] });
  await details(page).getByRole('button', { name: 'Open in Studio', exact: true }).click();
  await expect(details(page).getByRole('status')).toContainText('fixture launch failure');
  await expect(tab(page, 'Review')).toHaveAttribute('aria-selected', 'true');
});
