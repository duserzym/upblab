import { expect, test, type Locator, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';
import { homeAtlasMounts, homeMounts, homeSessions, largeHomeFixtures } from './fixtures/home';
import { problems } from './problems';

async function home(page: Page, store: Record<string, unknown> = {}, desktop = true) {
  await page.route('http://localhost:8000/**', route => route.fulfill({ json: {} }));
  await page.route('**/modules/manifest.json', route => route.fulfill({ json: { modules: [] } }));
  await page.route('**/v1/**', route => {
    const url = new URL(route.request().url());
    const body = url.pathname === '/v1/accounts/me' ? { username: 'demo', display_name: 'Demo analyst' }
      : largeHomeFixtures[url.pathname + url.search] ?? (url.searchParams.get('limit') && !url.searchParams.has('after') ? largeHomeFixtures[url.pathname] : undefined);
    return route.fulfill({ status: body === undefined ? 404 : 200, json: body ?? {},
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Accept' } });
  });
  // No real images or module processes: the board uses the invented inventory.
  await page.route('**/atlas/projects/**', route => route.fulfill({ status: 404 }));
  const saved = { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'home', theme: 'light', themeChosen: true, ...store };
  if (desktop) {
    await page.addInitScript(installFakeTauri, { store: saved, fixtures: largeHomeFixtures, signedIn: true });
  } else {
    await page.addInitScript(saved => {
      localStorage.setItem('upbstudio.settings', JSON.stringify(saved));
      sessionStorage.setItem('upbstudio.token:http://localhost:8000', 'invented-token');
    }, saved);
  }
  await page.goto(desktop ? './' : './?server=http://localhost:8000');
  await expect(page.getByTestId('session-card')).toHaveCount(homeSessions.length);
  await expect(page.getByRole('region', { name: 'Mounts', exact: true })).toHaveCount(1);
  const filter = (store.homeSections as { mounts?: { atlasFilter?: string } } | undefined)?.mounts?.atlasFilter;
  await expect(page.getByRole('region', { name: 'Mounts', exact: true }).getByRole('status')).toHaveCount(0);
  await expect(page.getByTestId('mount-card')).toHaveCount(filter === 'with' ? homeAtlasMounts.length : filter === 'without' ? homeMounts.length - homeAtlasMounts.length : homeMounts.length);
  await expect(page.getByRole('region', { name: 'Atlases', exact: true })).toHaveCount(0);
}

const boxHeight = async (grid: Locator) => (await grid.boundingBox())!.height;
const storedSettings = (page: Page, desktop = true) => page.evaluate(desktop => desktop
  ? (window as unknown as { __fake: { store: Record<string, unknown> } }).__fake.store
  : JSON.parse(localStorage.getItem('upbstudio.settings') ?? '{}') as Record<string, unknown>, desktop);

async function rowHeight(grid: Locator) {
  return grid.evaluate(grid => {
    const card = grid.querySelector('article')!;
    return card.getBoundingClientRect().height + parseFloat(getComputedStyle(card.parentElement!).rowGap);
  });
}

// Count complete cards exposed by the grid, independent of the Home page's scroll position.
async function exposedCards(grid: Locator) {
  return grid.evaluate(grid => {
    const box = grid.getBoundingClientRect();
    return [...grid.querySelectorAll('article')].filter(card => {
      const r = card.getBoundingClientRect();
      return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
    }).length;
  });
}

async function dragDown(page: Page, handle: Locator, distance: number) {
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  // Leave room below the handle for the gesture even on the smallest window.
  await handle.evaluate(handle => handle.scrollIntoView({ block: 'center' }));
  const centered = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, centered.y + centered.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, centered.y + centered.height / 2 + distance, { steps: 12 });
  await page.mouse.up();
}

test('Mounts drag exposes more cards; keyboard rows and double-click reset its height', async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 982 });
  await home(page);
  const grid = page.getByTestId('mount-grid');
  const handle = page.getByRole('separator', { name: 'Resize Mounts', exact: true });
  const initial = await boxHeight(grid);
  const initialCards = await exposedCards(grid);
  await expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
  await dragDown(page, handle, 200);
  await expect.poll(() => boxHeight(grid)).toBeGreaterThan(initial + 180);
  expect(await exposedCards(grid)).toBeGreaterThan(initialCards);
  const dragged = await boxHeight(grid);
  const row = await rowHeight(grid);
  await handle.focus();
  await handle.press('ArrowDown');
  await expect.poll(async () => Math.abs(await boxHeight(grid) - dragged - row)).toBeLessThan(3);
  await handle.dblclick();
  await expect.poll(async () => Math.abs(await boxHeight(grid) - initial)).toBeLessThan(2);
});

test('keyboard limits, page steps, collapse and reset work independently for all sections', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await home(page);
  for (const [label, gridId, total] of [['Sessions', 'session-grid', homeSessions.length], ['Mounts', 'mount-grid', homeMounts.length]] as const) {
    const section = page.getByRole('region', { name: label, exact: true });
    const grid = page.getByTestId(gridId);
    const handle = page.getByRole('separator', { name: `Resize ${label}`, exact: true });
    const initial = await boxHeight(grid);
    const row = await rowHeight(grid);
    await handle.press('Home');
    const minimum = Number(await handle.getAttribute('aria-valuemin'));
    await expect.poll(async () => Math.abs(await boxHeight(grid) - minimum)).toBeLessThan(2);
    await handle.press('PageDown');
    const maximum = Number(await handle.getAttribute('aria-valuemax'));
    await expect.poll(async () => Math.abs(await boxHeight(grid) - Math.min(maximum, minimum + 3 * row))).toBeLessThan(3);
    await handle.press('PageUp');
    await expect.poll(async () => Math.abs(await boxHeight(grid) - minimum)).toBeLessThan(3);
    await handle.press('End');
    await expect.poll(() => grid.evaluate(grid => grid.scrollHeight - grid.clientHeight)).toBeLessThanOrEqual(1);
    await handle.press('ArrowUp');
    const resized = await boxHeight(grid);
    const disclosure = section.getByRole('button', { name: `Collapse ${label}`, exact: true });
    await expect(disclosure).toHaveAttribute('aria-controls', await grid.getAttribute('id') as string);
    await disclosure.click();
    await expect(grid).toBeHidden();
    await expect(handle).toBeHidden();
    await expect(section.locator('.toolbar')).toContainText(`${label} ${total}`);
    await expect(section.getByLabel(`Search ${label.toLowerCase()}`)).toBeVisible();
    await expect(section.getByLabel(`Sort ${label.toLowerCase()}`)).toBeVisible();
    const expand = section.getByRole('button', { name: `Expand ${label}`, exact: true });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expand.click();
    await expect.poll(async () => Math.abs(await boxHeight(grid) - resized)).toBeLessThan(2);
    await handle.press('Enter');
    await expect.poll(async () => Math.abs(await boxHeight(grid) - initial)).toBeLessThan(2);
  }
  await page.getByRole('button', { name: 'Collapse Sessions', exact: true }).click();
  await page.getByRole('separator', { name: 'Resize Mounts', exact: true }).press('ArrowDown');
  await page.getByRole('button', { name: 'Reset Home layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Collapse Sessions', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await storedSettings(page)).homeSections).toEqual({});
});

for (const desktop of [true, false]) test(`${desktop ? 'desktop' : 'web'} height, collapse and atlas filter survive a new page`, async ({ page, context }) => {
  await page.setViewportSize({ width: 1512, height: 982 });
  await home(page, {}, desktop);
  const grid = page.getByTestId('mount-grid');
  const handle = page.getByRole('separator', { name: 'Resize Mounts', exact: true });
  await handle.press('ArrowDown');
  const height = await boxHeight(grid);
  await page.getByRole('button', { name: 'With atlas', exact: true }).click();
  await expect(page.getByTestId('mount-card')).toHaveCount(homeAtlasMounts.length);
  await page.getByRole('button', { name: 'Collapse Sessions', exact: true }).click();
  await expect.poll(async () => (await storedSettings(page, desktop)).homeSections).toMatchObject({ sessions: { collapsed: true }, mounts: { atlasFilter: 'with' } });
  const saved = await storedSettings(page, desktop);
  const reopened = await context.newPage();
  await reopened.setViewportSize({ width: 1512, height: 982 });
  await home(reopened, saved, desktop);
  await expect.poll(async () => Math.abs(await boxHeight(reopened.getByTestId('mount-grid')) - height)).toBeLessThan(2);
  await expect(reopened.getByTestId('session-grid')).toBeHidden();
  await expect(reopened.getByRole('button', { name: 'Expand Sessions', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(reopened.getByRole('button', { name: 'With atlas', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await reopened.getByRole('button', { name: 'Reset Home layout', exact: true }).click();
  await expect(reopened.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(reopened.getByTestId('mount-card')).toHaveCount(homeMounts.length);
  await reopened.close();
});

for (const [width, height] of [[1512, 982], [1280, 800], [1024, 640]]) for (const theme of ['light', 'dark']) {
  test(`section controls fit ${width} x ${height} in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await home(page, { theme, homeSections: { sessions: { height: 4000 }, mounts: { height: 4000 }, atlases: { height: 300, collapsed: true } } });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const label of ['Sessions', 'Mounts']) {
      const handle = page.getByRole('separator', { name: `Resize ${label}`, exact: true });
      const grid = page.getByTestId(`${label === 'Sessions' ? 'session' : 'mount'}-grid`);
      expect(await boxHeight(grid)).toBeLessThanOrEqual(height * 0.8 + 1);
      await handle.scrollIntoViewIfNeeded();
      const box = (await handle.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(48);
      expect(box.y + box.height).toBeLessThanOrEqual(height + 1); // sub-pixel rounding after scrollIntoView
      await handle.press('End');
      expect(await problems(page, `Home ${label} expanded ${theme}`)).toEqual([]);
      await handle.press('Enter');
      await page.getByRole('button', { name: `Collapse ${label}`, exact: true }).click();
      expect(await problems(page, `Home ${label} collapsed ${theme}`)).toEqual([]);
    }
    await page.getByRole('button', { name: 'Reset Home layout', exact: true }).click();
    expect(await problems(page, `Home reset ${theme}`)).toEqual([]);
  });
}
