import { expect, test, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';
import { problems } from './problems';
import { reviewFixtures, session, runs } from './fixtures/review';
import { homeSessions, homeMounts, homeAtlasMounts, largeHomeFixtures } from './fixtures/home';

// Small, invented board inventory; the first session also has Review fixtures.
const sessions = Array.from({ length: 10 }, (_, i) => ({
  ...session, id: i === 0 ? session.id : `session-${i}`, session_key: `Demo session ${String.fromCharCode(74 - i)}`,
  started_at: `2026-11-${String(10 - i).padStart(2, '0')}T10:00:00Z`,
  material: i % 2 ? 'apatite' : 'zircon', analyst: i === 3 ? 'Analyst Moss' : 'Demo analyst',
  instrument: { name: i === 4 ? 'Instrument Cedar' : 'Demo instrument' }, acquisition_count: 12 + i,
}));
const mounts = Array.from({ length: 6 }, (_, i) => ({ id: `mount-${i}`, label: `Demo mount ${i + 1}`, mount_type: i % 2 ? 'glass' : 'epoxy', grain_count: 3 + i, spot_count: 12 + i }));
const fixtures: Record<string, unknown> = { ...reviewFixtures, '/v1/sessions': sessions, '/v1/mounts': mounts };
for (const s of sessions) {
  fixtures[`/v1/sessions/${s.id}`] = { ...s, kind_counts: { sample: s.acquisition_count - 4, primary_standard: 2, secondary_standard: 2 } };
  fixtures[`/v1/sessions/${s.id}/reductions`] = runs.map(r => ({ ...r, session_id: s.id }));
}
for (const [i, m] of mounts.entries()) fixtures[`/v1/mounts/${m.id}/atlas`] = {
  current: i < 3 ? { project_id: `project-${i}`, name: `Demo atlas ${i + 1}`, version: 3, uploaded_at: `2026-11-0${4 + i}T12:00:00Z` } : null,
  access: i < 3 ? `read-only-${i}` : null,
};
const thumbnail = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
// Keep optional screenshot configuration typed without Node globals in the UI tsconfig.
const screenshotEnv = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Call = [string, Record<string, unknown> | undefined];
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __fake: { calls: Call[] } }).__fake.calls);

/** grainatlas opens: desktop `grainatlas_launch` projects, web `window.open` URLs (recorded, not followed). */
async function atlasOpens(page: Page, desktop: boolean): Promise<string[]> {
  if (desktop) return (await calls(page)).filter(([c]) => c === 'grainatlas_launch').map(([, a]) => String(a?.project));
  return page.evaluate(() => (window as unknown as { __opened?: string[] }).__opened ?? []);
}

async function home(page: Page, desktop: boolean, inventory = fixtures, brokenThumbnail = false, detailsReady?: Promise<void>) {
  await page.route('http://localhost:8000/**', r => r.fulfill({ json: {} }));
  inventory = { ...inventory,
    '/v1/accounts': [], '/v1/groups': [], '/v1/labs': [], '/v1/projects': [], '/v1/samples': [],
    '/v1/sessions': (inventory['/v1/sessions'] as typeof sessions).map(s => {
      const detail = inventory[`/v1/sessions/${s.id}`] as { kind_counts?: Record<string, number> };
      const stored = inventory[`/v1/sessions/${s.id}/reductions`] as typeof runs | undefined;
      return { ...s, owner_name: 'Demo analyst', run_count: stored?.length ?? s.run_count, preferred_run: stored?.find(r => r.is_preferred_for_session) ?? s.preferred_run, spot_kinds: detail?.kind_counts };
    }),
    '/v1/mounts': (inventory['/v1/mounts'] as typeof mounts).map(m => {
      const detail = inventory[`/v1/mounts/${m.id}/atlas`] as { current: Record<string, unknown> | null; access?: string } | undefined;
      const atlas = detail?.current;
      return { ...m, owner_name: 'Demo analyst', atlas: atlas ? { ...atlas, thumbnail: `/atlas/projects/${atlas.project_id}/pyramid/area1/3/0_0.png?access=${detail?.access}` } : null };
    }),
  };
  await page.route('**/modules/manifest.json', r => r.fulfill({ json: { modules: [{ name: 'grainatlas', version: 'demo', source: 'fixture', sha256: 'demo', entry: 'modules/grainatlas/index.html' }] } }));
  await page.route('**/modules/grainatlas/**', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>grainatlas fixture</title>' }));
  await page.route('**/atlas/projects/**', r => {
    const url = new URL(r.request().url());
    if (!url.searchParams.get('access')?.startsWith('read-only-')) return r.fulfill({ status: 401 });
    if (url.pathname.endsWith('/atlas.json')) return r.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { areas: [{ id: 'area1' }], files: {
      'pyramid/area1/0/0_0.png': 'invented', 'pyramid/area1/3/0_0.png': 'invented', 'pyramid/area2/2/0_0.png': 'invented',
    } } });
    return brokenThumbnail ? r.fulfill({ status: 404 }) : r.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'image/svg+xml', body: thumbnail });
  });
  await page.route('**/v1/**', async r => {
    const url = new URL(r.request().url());
    if (/^\/v1\/(sessions|mounts)\//.test(url.pathname)) await detailsReady;
    const body = url.pathname === '/v1/accounts/me' ? { username: 'demo', display_name: 'Demo analyst' } : inventory[url.pathname + url.search] ?? (url.search === '?limit=500' ? inventory[url.pathname] : undefined);
    return r.fulfill({ status: body === undefined ? 404 : 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Accept' }, json: body ?? {} });
  });
  await page.route('**/app/**', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Sessions fixture</title>' }));
  if (desktop) {
    await page.addInitScript(installFakeTauri, { store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'home', theme: 'light', themeChosen: true }, fixtures: inventory, signedIn: true });
  } else {
    await page.addInitScript(() => {
      const opened: string[] = [];
      (window as unknown as { __opened: string[] }).__opened = opened;
      window.open = (url?: string | URL) => { opened.push(String(url)); return null; };
      localStorage.setItem('upbstudio.settings', JSON.stringify({ mode: 'server', lastTab: 'home', theme: 'light', themeChosen: true }));
      sessionStorage.setItem('upbstudio.token:http://localhost:8000', 'invented-token');
    });
  }
  await page.goto(desktop ? './' : './?server=http://localhost:8000');
  await expect(page.getByTestId('session-card')).toHaveCount(Math.min(500, (inventory['/v1/sessions'] as unknown[]).length));
}

for (const desktop of [true, false]) {
  for (const [width, height, columns] of [[1440, 900, 4], [1280, 800, 3], [1024, 640, 2]]) {
    test(`${desktop ? 'desktop' : 'web'} board fits ${width} x ${height} with ${columns} columns`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await home(page, desktop);
      const filters = page.getByRole('region', { name: 'Narrow data by person, team and project', exact: true });
      const selects = filters.getByRole('combobox');
      await expect(selects).toHaveCount(4);
      const filterBoxes = await selects.evaluateAll(elements => elements.map(el => {
        const { x, y, width, height } = el.getBoundingClientRect();
        return { x, y, width, height };
      }));
      for (const box of filterBoxes) {
        expect(box.width).toBeGreaterThanOrEqual(192);
        expect(box.height).toBeGreaterThanOrEqual(34);
      }
      if (width >= 1280) {
        expect(Math.max(...filterBoxes.map(box => box.y)) - Math.min(...filterBoxes.map(box => box.y))).toBeLessThanOrEqual(2);
        const clear = (await filters.getByRole('button', { name: 'Clear filters', exact: true }).boundingBox())!;
        expect(clear.x).toBeGreaterThanOrEqual(filterBoxes[3].x + filterBoxes[3].width);
        expect(clear.y).toBeLessThan(filterBoxes[3].y + filterBoxes[3].height);
        expect(clear.y + clear.height).toBeGreaterThan(filterBoxes[3].y);
      } else {
        expect(Math.abs(filterBoxes[0].y - filterBoxes[1].y)).toBeLessThanOrEqual(2);
        expect(Math.abs(filterBoxes[2].y - filterBoxes[3].y)).toBeLessThanOrEqual(2);
        expect(filterBoxes[2].y).toBeGreaterThan(filterBoxes[0].y);
      }
      const sorts = page.getByRole('combobox', { name: /^Sort / }).filter({ visible: true });
      expect(await sorts.count()).toBeGreaterThanOrEqual(2);
      for (const sort of await sorts.all()) {
        const box = (await sort.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(144);
        expect(box.height).toBeGreaterThanOrEqual(30);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await expect(page.getByTestId('open-panel').getByRole('button')).toHaveCount(4);
      const rows = await page.getByTestId('session-card').evaluateAll(cards => cards.map(c => ({ x: Math.round(c.getBoundingClientRect().x), y: Math.round(c.getBoundingClientRect().y) })));
      expect(new Set(rows.filter(r => r.y === rows[0].y).map(r => r.x)).size).toBe(columns);
      await expect(page.getByTestId('mount-card')).toHaveCount(6);
      await expect(page.getByRole('img', { name: 'Has a published atlas, version 3', exact: true })).toHaveCount(3);
      await expect(page.getByRole('img', { name: 'No published atlas', exact: true })).toHaveCount(3);
      expect(await problems(page, 'Home board')).toEqual([]);
      await page.getByRole('button', { name: 'Upload LA-ICP-MS session…', exact: true }).click();
      await expect(page.getByTestId('upload-sessions')).toBeVisible();
      expect(await problems(page, 'Home upload panel')).toEqual([]);
      await page.getByTestId('open-panel').getByRole('button', { name: 'Upload image set…', exact: true }).click();
      await expect(page.getByTestId('upload-images')).toBeVisible();
      await expect(page.getByTestId('upload-sessions')).toBeHidden();
      await page.getByRole('button', { name: 'Close image set upload panel' }).click();
      await expect(page.getByTestId('upload-images')).toBeHidden();
    });
  }
  test(`${desktop ? 'desktop' : 'web'} search, sort, navigation and thumbnails`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await home(page, desktop);
    await page.getByLabel('Search sessions').fill('Analyst Moss');
    await expect(page.getByTestId('session-card')).toHaveCount(1);
    await expect(page.getByTestId('session-card')).toContainText('Demo session G');
    await page.getByLabel('Search sessions').fill('Instrument Cedar');
    await expect(page.getByTestId('session-card')).toHaveCount(1);
    await page.getByLabel('Search sessions').fill('');
    await page.getByLabel('Sort sessions').selectOption('az');
    await expect(page.getByTestId('session-card').first()).toContainText('Demo session A');
    await page.getByLabel('Sort sessions').selectOption('za');
    await expect(page.getByTestId('session-card').first()).toContainText('Demo session J');
    await page.getByRole('button', { name: 'Open session Demo session J', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Sessions', exact: true })).toHaveAttribute('aria-selected', 'true');
    if (desktop) await expect.poll(async () => (await calls(page)).filter(([c, a]) => c === 'module_open' && a?.module === 'sessions').pop()?.[1]?.url).toContain(`#/sessions/${session.id}`);
    else await expect(page.locator('iframe.surface:visible')).toHaveAttribute('src', new RegExp(`#/sessions/${session.id}`));
    await page.getByRole('tab', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: `upbdb://session/${session.id}` })).toHaveCount(1);
    await page.getByTestId('session-card').filter({ hasText: 'Demo session J' }).getByRole('button', { name: 'Review', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Review', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('treeitem').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Home', exact: true }).click();
    await page.getByLabel('Search mounts').fill('Demo mount 1');
    await page.getByTestId('mount-card').scrollIntoViewIfNeeded();
    const thumbnail = page.getByTestId('mount-card').getByRole('img', { name: 'Atlas overview for Demo mount 1', exact: true });
    await expect(thumbnail).toBeVisible();
    const images = thumbnail.locator('img');
    // The list summary supplies one thumbnail; Home no longer reads atlas manifests per row.
    await expect(images).toHaveCount(1);
    await expect(images.first()).toHaveAttribute('src', /pyramid\/area1\/3\/0_0.png/);
    await expect.poll(() => images.evaluateAll(tiles => tiles.every(img => (img as HTMLImageElement).naturalWidth === 1))).toBe(true);
    // A published atlas opens in grainatlas itself: the standalone app on desktop, a new tab on the web.
    await page.getByRole('button', { name: 'Open images for Demo mount 1', exact: true }).click();
    await expect.poll(() => atlasOpens(page, desktop)).toEqual([expect.stringContaining('project-0')]);
    await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByLabel('Search mounts').fill('Demo mount 4');
    await page.getByRole('button', { name: 'Open mount details for Demo mount 4', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Sessions', exact: true })).toHaveAttribute('aria-selected', 'true');
    if (desktop) await expect.poll(async () => (await calls(page)).filter(([c, a]) => c === 'module_open' && a?.module === 'sessions').pop()?.[1]?.url).toContain('#/mounts/mount-3');
    else await expect(page.locator('iframe.surface:visible')).toHaveAttribute('src', /#\/mounts\/mount-3/);
    await page.getByRole('tab', { name: 'Home', exact: true }).click();
    await page.getByLabel('Search mounts').fill('glass');
    await expect(page.getByTestId('mount-card')).toHaveCount(3);
    await page.getByLabel('Search mounts').fill('Demo atlas 1');
    await expect(page.getByTestId('mount-card')).toHaveCount(1);
    await expect(page.getByTestId('mount-card')).toContainText('Atlas: Demo atlas 1');
    await page.getByRole('button', { name: 'Open images for Demo mount 1', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await atlasOpens(page, desktop)).length).toBe(2);
    expect((await atlasOpens(page, desktop))[1]).toContain('project-0');
    await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute('aria-selected', 'true');
  });
}

test('eight sessions and eight mounts leave the first row of every section in view', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const eightMounts = [...mounts, ...[7, 8].map(n => ({ ...mounts[0], id: `mount-${n}`, label: `Demo mount ${n}` }))];
  const inventory: Record<string, unknown> = { ...fixtures, '/v1/sessions': sessions.slice(0, 8), '/v1/mounts': eightMounts };
  for (const m of eightMounts.slice(6)) inventory[`/v1/mounts/${m.id}/atlas`] = { current: null };
  await home(page, true, inventory);
  for (const id of ['open-panel', 'session-card', 'mount-card']) {
    const box = (await page.getByTestId(id).first().boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(48);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
  }
  const box = (await page.getByRole('button', { name: /Sessions · UPbDB/ }).boundingBox())!;
  expect(box.y + box.height).toBeLessThan(900);
});

test('failed thumbnail falls back to a mount outline', async ({ page }) => {
  const failure = page.waitForResponse(response =>
    response.url().includes('/pyramid/area1/3/0_0.png') && response.status() === 404);
  await home(page, true, fixtures, true);
  const card = page.getByTestId('mount-card').filter({ hasText: 'Demo mount 1' });
  await card.scrollIntoViewIfNeeded();
  await failure;
  await expect(card.locator('img')).toHaveCount(0);
  await expect(card.getByRole('img', { name: 'No thumbnail for Demo mount 1', exact: true })).toBeVisible();
});


for (const desktop of [true, false]) {
  for (const [width, height] of [[1512, 982], [1280, 800], [1024, 640]]) {
    test(`${desktop ? 'desktop' : 'web'} full inventory opens and searches at ${width} x ${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await home(page, desktop, largeHomeFixtures);
      const sessions = page.getByRole('region', { name: 'Sessions', exact: true });
      const mounts = page.getByRole('region', { name: 'Mounts', exact: true });
      await expect(mounts).toHaveCount(1);
      await expect(page.getByRole('region', { name: 'Atlases', exact: true })).toHaveCount(0);
      await expect(page.locator('.board-section')).toHaveCount(2); // Sessions and the single Mounts section.
      await expect(page.getByTestId('session-card')).toHaveCount(homeSessions.length);
      await expect(page.getByTestId('mount-card')).toHaveCount(homeMounts.length);
      await expect(mounts.locator('.toolbar')).toContainText('Mounts 40');
      await expect(sessions.locator('.toolbar')).toContainText('Sessions 15');
      await expect(page.getByRole('button', { name: 'Show all', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Load the rest', exact: true })).toHaveCount(0);
      await expect(mounts.getByRole('status')).toHaveCount(0);
      await expect(mounts.locator('.toolbar')).toContainText(`Mounts 40 · ${homeAtlasMounts.length} with atlas`);
      for (const mount of homeMounts) {
        const card = page.getByTestId('mount-card').filter({ has: page.getByText(mount.label, { exact: true }) });
        const published = homeAtlasMounts.includes(mount);
        await expect(card.getByTestId('atlas-symbol')).toHaveAttribute('aria-label', published ? 'Has a published atlas, version 1' : 'No published atlas');
        await expect(card.getByTestId('atlas-symbol').locator('title')).toHaveText(published ? 'Has a published atlas, version 1' : 'No published atlas');
        if (!published) {
          await expect(card).toContainText('No atlas');
          await expect(card.getByRole('img', { name: `No thumbnail for ${mount.label}`, exact: true })).toHaveCount(1);
        }
      }
      const heights = await page.getByTestId('mount-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().height));
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
      const filter = mounts.getByRole('group', { name: 'Filter mounts by atlas' });
      await expect(filter.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await filter.getByRole('button', { name: 'With atlas', exact: true }).click();
      await expect(filter.getByRole('button', { name: 'With atlas', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('mount-card')).toHaveCount(homeAtlasMounts.length);
      await expect(page.getByTestId('atlas-symbol')).toHaveCount(homeAtlasMounts.length);
      await expect(page.getByRole('img', { name: 'No published atlas', exact: true })).toHaveCount(0);
      await expect(mounts.locator('.toolbar')).toContainText(`${homeAtlasMounts.length} matching`);
      expect(await problems(page, 'Home with atlas filter')).toEqual([]);
      await filter.getByRole('button', { name: 'Without atlas', exact: true }).click();
      await expect(page.getByTestId('mount-card')).toHaveCount(homeMounts.length - homeAtlasMounts.length);
      await expect(page.getByRole('img', { name: 'Has a published atlas, version 1', exact: true })).toHaveCount(0);
      expect(await problems(page, 'Home without atlas filter')).toEqual([]);
      await filter.getByRole('button', { name: 'All', exact: true }).click();
      await expect(page.getByTestId('mount-card')).toHaveCount(40);
      expect(await problems(page, 'Home full inventory before searching')).toEqual([]);
      await page.getByLabel('Search mounts').fill('Zircon_mount_37');
      await expect(page.getByTestId('mount-card')).toHaveCount(1);
      await expect(page.getByTestId('mount-card')).toContainText('Zircon_mount_37');
      await expect(mounts.locator('.toolbar')).toContainText('Mounts 40');
      await page.getByLabel('Search mounts').fill('Published images 37');
      await expect(page.getByTestId('mount-card')).toHaveCount(1);
      await expect(page.getByTestId('mount-card')).toContainText('Atlas: Published images 37');
      await expect(page.getByTestId('mount-card')).toContainText('Zircon_mount_37');
      await page.getByLabel('Search sessions').fill('Board session 14');
      await expect(page.getByTestId('session-card')).toHaveCount(1);
      expect(await problems(page, 'Home full inventory')).toEqual([]);
    });
  }
}

test('list summaries show complete rows without per-row details and thumbnails load lazily', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const details: string[] = [], manifests: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (/^\/v1\/(sessions|mounts)\//.test(path)) details.push(path);
    if (path.endsWith('/atlas.json')) manifests.push(path);
  });
  await home(page, false, largeHomeFixtures);
  await expect(page.getByTestId('session-card')).toHaveCount(15);
  await expect(page.getByTestId('mount-card')).toHaveCount(40);
  const mounts = page.getByRole('region', { name: 'Mounts', exact: true });
  await expect(mounts.getByRole('status')).toHaveCount(0);
  await page.getByLabel('Search mounts').fill('Zircon_mount_37');
  const card = page.getByTestId('mount-card'); await card.scrollIntoViewIfNeeded();
  await expect(card).toContainText('Atlas: Published images 37');
  await expect(card.getByRole('img', { name: 'Atlas overview for Zircon_mount_37', exact: true })).toBeVisible();
  expect(details).toEqual([]); expect(manifests).toEqual([]);
  await mounts.getByRole('button', { name: 'Without atlas', exact: true }).click(); await expect(card).toHaveCount(0);
  await mounts.getByRole('button', { name: 'With atlas', exact: true }).click(); await expect(card).toHaveCount(1);
});

// SCREENSHOTS=1: the Home board with the demo inventory, for docs/screenshots.
if (screenshotEnv.SCREENSHOTS) for (const [width, height] of [[1440, 900], [1280, 800], [1024, 640]]) {
  test(`screenshot home ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await home(page, true);
    await page.screenshot({ path: `${screenshotEnv.SCREENSHOTS_DIR ?? 'test-results'}/home-${width}-${info.project.name}.png` });
  });
}
