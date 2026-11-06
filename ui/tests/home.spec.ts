import { expect, test, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';
import { problems } from './problems';
import { reviewFixtures, session, runs } from './fixtures/review';

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
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
type Call = [string, Record<string, unknown> | undefined];
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __fake: { calls: Call[] } }).__fake.calls);

async function home(page: Page, desktop: boolean, inventory = fixtures, brokenThumbnail = false) {
  await page.route('**/modules/manifest.json', r => r.fulfill({ json: { modules: [{ name: 'grainatlas', version: 'demo', source: 'fixture', sha256: 'demo', entry: 'modules/grainatlas/index.html' }] } }));
  await page.route('**/modules/grainatlas/**', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Images fixture</title>' }));
  await page.route('**/atlas/projects/**', r => {
    const url = new URL(r.request().url());
    if (!url.searchParams.get('access')?.startsWith('read-only-')) return r.fulfill({ status: 401 });
    if (url.pathname.endsWith('/atlas.json')) return r.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { areas: [{ id: 'area1' }], files: { 'pyramid/area1/0/0_0.png': 'invented' } } });
    return brokenThumbnail ? r.fulfill({ status: 404 }) : r.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'image/png', body: png });
  });
  await page.route('**/v1/**', r => {
    const url = new URL(r.request().url());
    const body = url.pathname === '/v1/accounts/me' ? { username: 'demo', display_name: 'Demo analyst' } : inventory[url.pathname + url.search];
    return r.fulfill({ status: body === undefined ? 404 : 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Accept' }, json: body ?? {} });
  });
  await page.route('**/app/**', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Sessions fixture</title>' }));
  if (desktop) {
    await page.addInitScript(installFakeTauri, { store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'home', theme: 'light', themeChosen: true }, fixtures: inventory, signedIn: true });
  } else {
    await page.addInitScript(() => {
      localStorage.setItem('upbstudio.settings', JSON.stringify({ mode: 'server', serverUrl: location.origin, lastTab: 'home', theme: 'light', themeChosen: true }));
      sessionStorage.setItem(`upbstudio.token:${location.origin}`, 'invented-token');
    });
  }
  await page.goto('./');
  await expect(page.getByTestId('session-card')).toHaveCount(Math.min(12, (inventory['/v1/sessions'] as unknown[]).length));
}

for (const desktop of [true, false]) {
  for (const [width, height, columns] of [[1440, 900, 4], [1280, 800, 3], [1024, 640, 2]]) {
    test(`${desktop ? 'desktop' : 'web'} board fits ${width} x ${height} with ${columns} columns`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await home(page, desktop);
      await expect(page.getByTestId('open-panel').getByRole('button')).toHaveCount(4);
      const rows = await page.getByTestId('session-card').evaluateAll(cards => cards.map(c => ({ x: Math.round(c.getBoundingClientRect().x), y: Math.round(c.getBoundingClientRect().y) })));
      expect(new Set(rows.filter(r => r.y === rows[0].y).map(r => r.x)).size).toBe(columns);
      await expect(page.getByTestId('mount-card')).toHaveCount(6);
      await expect(page.getByTestId('atlas-card')).toHaveCount(3);
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
    await expect(page.getByRole('row').filter({ hasText: `laicpmsdb://session/${session.id}` })).toHaveCount(1);
    await page.getByTestId('session-card').filter({ hasText: 'Demo session J' }).getByRole('button', { name: 'Review', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Review', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('treeitem').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Home', exact: true }).click();
    await page.getByLabel('Search mounts').fill('Demo mount 1');
    const thumbnail = page.getByTestId('mount-card').getByRole('img', { name: 'Atlas thumbnail for Demo mount 1', exact: true });
    await expect(thumbnail).toBeVisible();
    await expect.poll(() => thumbnail.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(1);
    await page.getByLabel('Search mounts').fill('glass');
    await expect(page.getByTestId('mount-card')).toHaveCount(3);
    await page.getByLabel('Search atlases').fill('Demo atlas 1');
    await expect(page.getByTestId('atlas-card')).toHaveCount(1);
    await page.getByRole('button', { name: 'Open atlas Demo atlas 1', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Images', exact: true })).toHaveAttribute('aria-selected', 'true');
    if (desktop) await expect.poll(async () => (await calls(page)).filter(([c, a]) => c === 'module_open' && a?.module === 'images').pop()?.[1]?.url).toContain('project-0');
    else await expect(page.locator('iframe.surface:visible')).toHaveAttribute('src', /project-0/);
  });
}

test('eight sessions and eight mounts leave the first row of every section in view', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const eightMounts = [...mounts, ...[7, 8].map(n => ({ ...mounts[0], id: `mount-${n}`, label: `Demo mount ${n}` }))];
  const inventory: Record<string, unknown> = { ...fixtures, '/v1/sessions': sessions.slice(0, 8), '/v1/mounts': eightMounts };
  for (const m of eightMounts.slice(6)) inventory[`/v1/mounts/${m.id}/atlas`] = { current: null };
  await home(page, true, inventory);
  for (const id of ['open-panel', 'session-card', 'mount-card', 'atlas-card']) {
    const box = (await page.getByTestId(id).first().boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(48);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
  }
  const box = (await page.getByRole('button', { name: /Sessions · laicpmsdb/ }).boundingBox())!;
  expect(box.y + box.height).toBeLessThan(900);
});

test('failed thumbnail falls back to a mount outline', async ({ page }) => {
  await home(page, true, fixtures, true);
  await expect(page.getByTestId('mount-card').getByRole('img', { name: 'No thumbnail for Demo mount 1', exact: true })).toBeVisible();
});


test('Show all expands the inventory and makes the remaining sessions searchable', async ({ page }) => {
  const extra = Array.from({ length: 4 }, (_, i) => ({ ...sessions[0], id: `extra-${i}`, session_key: `Earlier session ${i}` }));
  const inventory: Record<string, unknown> = { ...fixtures, '/v1/sessions': [...sessions, ...extra] };
  for (const s of extra) {
    inventory[`/v1/sessions/${s.id}/reductions`] = [];
    inventory[`/v1/sessions/${s.id}`] = { kind_counts: { sample: 12 } };
  }
  await home(page, true, inventory);
  const section = page.getByRole('region', { name: 'Sessions', exact: true });
  await expect(section).toContainText('Latest 12 of 14');
  await expect(section).toContainText('searching the latest 12');
  await section.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect(page.getByTestId('session-card')).toHaveCount(14);
  await page.getByLabel('Search sessions').fill('Earlier session');
  await expect(page.getByTestId('session-card')).toHaveCount(4);
  await expect(section).toContainText('4 of 14');
  await expect(section.getByRole('button', { name: 'Show all', exact: true })).toHaveCount(0);
});
