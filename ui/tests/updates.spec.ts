import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function openPreview(page: Page, theme: 'light' | 'dark', state: string) {
  await page.addInitScript((theme) => {
    localStorage.setItem('upbstudio.settings', JSON.stringify({ theme, themeChosen: true, mode: 'server', lastTab: 'home' }));
  }, theme);
  await page.route('**/modules/manifest.json', (route) => route.fulfill({ json: { modules: [
    { name: 'grainatlas', version: '0.11.0-test', source: 'local', sha256: 'invented', entry: 'modules/grainatlas/index.html' },
  ] } }));
  await page.route('http://localhost:8000/**', (route) => route.fulfill({ json: {} }));
  await page.goto(`./?update-preview=${state}`);
}
async function insideViewport(page: Page) {
  for (const selector of ['[data-testid="version-chip"]', 'header .account', 'header button[aria-label="Settings"]']) {
    const box = await page.locator(selector).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  expect(await page.evaluate(() => ({
    x: window.scrollX, y: window.scrollY,
    width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
  }))).toEqual({ x: 0, y: 0, ...{ width: page.viewportSize()!.width, height: page.viewportSize()!.height } });
}
for (const [width, height] of [[1440, 900], [1280, 800]]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`updates ready ${theme} ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openPreview(page, theme, 'ready');
      const chip = page.getByTestId('version-chip');
      await expect(chip).toHaveText('Update ready, restart');
      await expect(page.locator('header').getByTestId('version-chip')).toBeVisible();
      expect((await chip.boundingBox())!.width).toBeLessThanOrEqual(200);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await insideViewport(page);
      if (process.env.SCREENSHOTS === '1') {
        await mkdir('../docs/screenshots', { recursive: true });
        await page.screenshot({ path: `../docs/screenshots/updates-ready-${theme}-${width}x${height}.png` });
      }
      await chip.click();
      const panel = page.getByTestId('updates-panel');
      await expect(panel).toBeInViewport({ ratio: 1 });
      await expect(panel).toContainText('ready to install');
      await expect(panel.getByRole('button', { name: 'Restart to update' })).toBeVisible();
      await expect(panel.getByRole('table', { name: 'In this build' })).toBeVisible();
      await expect(panel).toContainText('0.11.0-test (local build)');
      await expect(panel).toContainText('Review tab, faster module switching');
      await insideViewport(page);
      if (process.env.SCREENSHOTS === '1') await page.screenshot({ path: `../docs/screenshots/updates-panel-${theme}-${width}x${height}.png` });
    });
    for (const [state, text] of [['available', 'Update available'], ['none', 'Up to date']]) {
      test(`updates ${state} ${theme} ${width}x${height}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await openPreview(page, theme, state);
        await expect(page.getByTestId('version-chip')).toHaveText(text);
        await insideViewport(page);
        if (state === 'none') await expect(page.getByTestId('version-chip')).toHaveText('v0.1.0', { timeout: 7000 });
      });
    }
  }
}
