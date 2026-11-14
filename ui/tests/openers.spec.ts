import { test, expect, type Page } from '@playwright/test';
import { calls, openReview, inside } from './review-helpers';
import { atlasStatusFixture } from './fixtures/atlas-sync';
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

for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test(`Balanced SEM header edits the selected spot with details below images at ${width} x ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openReview(page, { fixtures, store: { reviewSplit: true } });
    await select(page);
    await expect(page.getByRole('button', { name: 'Balanced', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const images = page.locator('[data-review-panel="images"]');
    const metadata = page.locator('[data-review-panel="details"]');
    const edit = images.getByRole('button', { name: 'Edit in grainatlas', exact: true });
    await expect(edit).toBeEnabled();
    await expect(edit).toHaveAttribute('title', /\(E\)/);
    await inside(edit, images.locator('header'));
    await expect(metadata).toHaveAttribute('data-collapsed', 'false');
    await expect.poll(async () => {
      const image = (await images.boundingBox())!, info = (await metadata.boundingBox())!;
      return info.y >= image.y + image.height;
    }).toBe(true);
    const image = (await images.boundingBox())!, info = (await metadata.boundingBox())!;
    expect(info.x).toBe(image.x);
    expect(info.width).toBe(image.width);
    await edit.click();
    await expect.poll(async () => (await launches(page, 'grainatlas_launch')).at(-1)?.[1])
      .toMatchObject({ project: 'project-demo', spot: 'atlas-2', code: 'ONE-TIME-FIXTURE' });
    await expect(tab(page, 'Review')).toHaveAttribute('aria-selected', 'true');
  });
}

test('the collapsed details strip keeps the selected name and date and opens both apps at 1024 x 640', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await openReview(page, { fixtures, studioFound: true, store: { reviewSplit: true } });
  await page.locator('[data-spot-key="acq-2"]').click();
  const metadata = page.locator('[data-review-panel="details"]');
  await expect(metadata).toHaveAttribute('data-collapsed', 'true');
  const strip = metadata.locator('.details-summary');
  await expect(strip.getByText('Zircon_2', { exact: true })).toBeVisible();
  const date = strip.getByText('553 ± 9 Ma', { exact: true });
  await expect(date).toBeVisible();
  await inside(date, metadata);
  expect(await date.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const edit = strip.getByRole('button', { name: 'Edit in grainatlas', exact: true });
  await expect(edit).toBeEnabled();
  await inside(edit, metadata);
  await edit.click();
  await expect.poll(async () => (await launches(page, 'grainatlas_launch')).at(-1)?.[1])
    .toMatchObject({ project: 'project-demo', spot: 'atlas-2' });
  await strip.getByRole('button', { name: 'Open in Studio', exact: true }).click();
  await expect.poll(async () => (await launches(page, 'studio_launch')).length).toBe(1);
  const url = new URL((await launches(page, 'studio_launch'))[0][1]!.url as string);
  expect(url.host + url.pathname).toBe('run/run-preferred');
  expect(url.searchParams.get('acquisition')).toBe('acq-2');
  await strip.getByRole('button', { name: 'Expand Spot metadata', exact: true }).click();
  await expect(details(page).getByRole('heading', { name: 'Zircon_2', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(strip).toBeVisible();
});

test('SEM header explains when the selected spot has no published atlas', async ({ page }) => {
  await openReview(page, { store: { reviewSplit: true }, fixtures: {
    [`/v1/sessions/${session.id}/results?run=preferred`]: { ...table, rows: table.rows.map(row => ({ ...row, atlas_project_id: null })) },
  } });
  const edit = page.locator('[data-review-panel="images"]').getByRole('button', { name: 'Edit in grainatlas', exact: true });
  await expect(edit).toBeDisabled();
  await expect(edit).toHaveAttribute('title', /No published atlas.*\(E\)/);
});

for (const matchingProject of [true, false]) {
  test(`Images strip passes revision and ${matchingProject ? 'matching selected spot' : 'omits a spot from another project'}`, async ({ page }) => {
    await openReview(page, { fixtures });
    await select(page);
    await tab(page, 'Images').click();
    const project = matchingProject ? 'project-demo' : 'project-other';
    await page.evaluate(event => (window as unknown as { __emit(e: string, p: unknown): void })
      .__emit('lab-bridge://notify', { source: 'images', event }), { ...atlasStatusFixture, project, mode: 'view', state: 'in-sync' });
    const strip = page.getByTestId('atlas-status-strip');
    await strip.getByRole('button', { name: 'Edit in grainatlas', exact: true }).click();
    await expect.poll(async () => (await launches(page, 'grainatlas_launch')).length).toBe(1);
    const args = (await launches(page, 'grainatlas_launch'))[0][1]!;
    expect(args).toMatchObject({ project, revision: 41, code: 'ONE-TIME-FIXTURE' });
    if (matchingProject) expect(args.spot).toBe('atlas-2');
    else expect(args.spot).toBeUndefined();
  });
}


test('SEM header opens the displayed mount atlas without a selected spot', async ({ page }) => {
  await openReview(page, { fixtures: { ...fixtures, [`/v1/mounts/${mount.id}/results`]: { mount_id: mount.id, spots: [] } } });
  // Home's mount inventory already knows this published atlas.
  await tab(page, 'Home').click();
  await expect(page.getByTestId('mount-card').getByRole('button', { name: 'Edit in grainatlas', exact: true })).toBeEnabled();
  await tab(page, 'Review').click();
  await page.getByRole('checkbox', { name: 'SEM images', exact: true }).check();
  await page.getByRole('button', { name: 'Choose review scope', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search scopes', exact: true });
  await search.fill(mount.label);
  await search.press('ArrowDown');
  await expect(page.getByRole('listbox', { name: 'Mounts', exact: true }).getByRole('option')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(details(page)).toContainText('Select a spot');
  const edit = page.locator('[data-review-panel="images"]').getByRole('button', { name: 'Edit in grainatlas', exact: true });
  await expect(edit).toBeEnabled();
  await edit.click();
  await expect.poll(async () => (await launches(page, 'grainatlas_launch')).length).toBe(1);
  const args = (await launches(page, 'grainatlas_launch'))[0][1]!;
  expect(args.project).toBe('project-demo');
  expect(args.spot).toBeUndefined();
});

for (const [width, height] of [[1280, 800], [1440, 900]]) {
  test(`the fullest spot fits completely below SEM at ${width} x ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openReview(page, { fixtures, store: { reviewSplit: true } });
    // This row has every stored metric and both automatic flags.
    await page.locator('[data-spot-key="acq-4"]').click();
    const tile = page.locator('[data-review-panel="details"]');
    const info = details(page);
    await expect(info.getByRole('heading', { name: 'Zircon_4', exact: true })).toBeVisible();
    await expect(tile).toHaveAttribute('data-collapsed', 'false');
    await expect(info).toContainText('Sample A · grain area/2');
    await expect(info).toContainText('559 ± 9 Ma');
    await expect(info).toContainText('discordant');
    await expect(info).toContainText('high ratio scatter');
    await expect(info.locator('dd')).toHaveCount(10);
    await expect(info.locator('dt').filter({ hasText: /^206Pb\/238U date/ })).toHaveCount(0);
    await expect(info.locator('dt').filter({ hasText: /^207Pb\/206Pb date/ })).toHaveCount(1);
    await inside(info.getByRole('button', { name: 'Edit in grainatlas', exact: true }), tile);
    await inside(info.getByRole('button', { name: 'Open in Studio', exact: true }), tile);
    const run = info.getByTestId('spot-run');
    await expect(run).toContainText('run-preferre');
    await expect(run).toContainText('Pipeline 0.1.0 · Demo analyst');
    await expect.poll(async () => {
      const body = await info.evaluate(el => ({ scroll: el.scrollHeight, visible: el.clientHeight }));
      return body.scroll <= body.visible + 1;
    }).toBe(true);
    await inside(run, tile.locator('.body'));
    expect(await tile.locator('.body').evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    expect(await info.locator('dd').evaluateAll(nodes => nodes.every(el => el.scrollWidth <= el.clientWidth + 1))).toBe(true);
  });
}

const emitNotify = (page: Page, event: unknown, source = 'images') => page.evaluate(({ event, source }) =>
  (window as unknown as { __emit(e: string, payload: unknown): Promise<void> }).__emit('lab-bridge://notify', { event, source }), { event, source });
const presentations = async (page: Page) => (await calls(page)).filter(([name, args]) =>
  name === 'module_command' && args?.module === 'images' && (args.command as { type?: string })?.type === 'set-presentation')
  .map(([, args]) => (args!.command as { presentation: string }).presentation);

test('Images uses an editor and Review SEM uses a viewer, including module reloads and status readiness', async ({ page }) => {
  await openReview(page, { store: { reviewSplit: true } });
  await expect.poll(() => presentations(page)).toContain('viewer');
  await emitNotify(page, { ...atlasStatusFixture, mode: 'view', state: 'in-sync', changes: null });
  await expect(page.getByTestId('atlas-status-strip')).toHaveCount(0);
  let before = (await presentations(page)).length;
  await page.evaluate(() => (window as unknown as { __emit(e: string, p: unknown): Promise<void> }).__emit('lab-bridge://ready', { module: 'images' }));
  await expect.poll(async () => (await presentations(page)).length).toBeGreaterThan(before);
  expect((await presentations(page)).at(-1)).toBe('viewer');
  await tab(page, 'Images').click();
  await expect.poll(async () => (await presentations(page)).at(-1)).toBe('editor');
  await expect(page.getByTestId('atlas-status-strip')).toBeVisible();
  before = (await presentations(page)).length;
  await page.evaluate(() => (window as unknown as { __emit(e: string, p: unknown): Promise<void> }).__emit('lab-bridge://ready', { module: 'images' }));
  await expect.poll(async () => (await presentations(page)).length).toBeGreaterThan(before);
  expect((await presentations(page)).at(-1)).toBe('editor');
  await tab(page, 'Review').click();
  await expect.poll(async () => (await presentations(page)).at(-1)).toBe('viewer');
});

test('the Images leave guard completes before switching the surface to viewer', async ({ page }) => {
  await openReview(page, { store: { reviewSplit: true } });
  await tab(page, 'Images').click();
  await expect.poll(async () => (await presentations(page)).at(-1)).toBe('editor');
  await emitNotify(page, atlasStatusFixture);
  const before = (await presentations(page)).filter(p => p === 'viewer').length;
  await tab(page, 'Review').click();
  const guard = page.getByRole('dialog', { name: /Leave editing/ });
  await expect(guard).toBeVisible();
  await expect(tab(page, 'Images')).toHaveAttribute('aria-selected', 'true');
  expect((await presentations(page)).filter(p => p === 'viewer')).toHaveLength(before);
  await guard.getByRole('button', { name: 'Stay', exact: true }).click();
  await expect(guard).toHaveCount(0);
  expect((await presentations(page)).filter(p => p === 'viewer')).toHaveLength(before);
  await tab(page, 'Review').click();
  await guard.getByRole('button', { name: 'Keep draft and leave', exact: true }).click();
  const leave = async () => (await calls(page)).filter(([name, args]) => name === 'module_command' && (args?.command as { type: string })?.type === 'leave-edit').at(-1)?.[1]?.command as { id: string } | undefined;
  await expect.poll(leave).toBeTruthy();
  await page.evaluate(id => (window as unknown as { __commandResult(id: string, type: string, result: unknown): Promise<void> }).__commandResult(id, 'leave-edit', { ok: true }), (await leave())!.id);
  await expect(tab(page, 'Review')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(async () => (await presentations(page)).at(-1)).toBe('viewer');
});

test('image spot action notifications launch the requested spot in grainatlas and Studio', async ({ page }) => {
  await openReview(page, { fixtures, studioFound: true, store: { reviewSplit: true } });
  // The action names a different spot from the current selection.
  await emitNotify(page, { type: 'lab.spot.action', action: 'edit', project: 'project-demo', spot: 'atlas-4' });
  await expect.poll(async () => (await launches(page, 'grainatlas_launch')).at(-1)?.[1]).toMatchObject({ project: 'project-demo', spot: 'atlas-4' });
  await emitNotify(page, { type: 'lab.spot.action', action: 'studio', project: 'project-demo', spot: 'atlas-4' }, 'grainatlas');
  await expect.poll(async () => (await launches(page, 'studio_launch')).length).toBe(1);
  const url = new URL((await launches(page, 'studio_launch'))[0][1]!.url as string);
  expect(url.host + url.pathname).toBe('run/run-preferred');
  expect(url.searchParams.get('acquisition')).toBe('acq-4');
  await expect(tab(page, 'Review')).toHaveAttribute('aria-selected', 'true');
});

test('a Studio spot action resolves a result outside the loaded Review rows', async ({ page }) => {
  await openReview(page, { fixtures: { ...fixtures, [`/v1/sessions/${session.id}/results?run=preferred`]: { ...table, rows: table.rows.filter(row => row.acquisition_id !== 'acq-2') } }, studioFound: true });
  await expect(page.locator('[data-spot-key="acq-2"]')).toHaveCount(0);
  await emitNotify(page, { type: 'lab.spot.action', action: 'studio', project: 'project-demo', spot: 'atlas-2' });
  await expect.poll(async () => (await launches(page, 'studio_launch')).length).toBe(1);
  const url = new URL((await launches(page, 'studio_launch'))[0][1]!.url as string);
  expect(url.searchParams.get('acquisition')).toBe('acq-2');
  expect((await calls(page)).some(([name, args]) => name === 'api_get' && args?.path === '/v1/spots/by-atlas/atlas-2/results')).toBe(true);
  await expect(details(page).getByRole('heading', { name: 'Zircon_2', exact: true })).toBeVisible();
});

test('opening the Reduce tab does not block the page (effect loop regression)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Long-task timing is a Chromium API');
  await openReview(page, { studioFound: true, fixtures });
  await page.evaluate(() => {
    (window as unknown as { __long: number[] }).__long = [];
    new PerformanceObserver(list => { for (const e of list.getEntries()) (window as unknown as { __long: number[] }).__long.push(e.duration); }).observe({ type: 'longtask' });
  });
  await tab(page, 'Reduce').click();
  await expect(page.getByTestId('reduce-sessions')).toBeVisible();
  await page.waitForTimeout(500);
  expect(Math.max(0, ...await page.evaluate(() => (window as unknown as { __long: number[] }).__long))).toBeLessThan(2000);
});
