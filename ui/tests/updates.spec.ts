import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function openPreview(page: Page, theme: 'light' | 'dark', state: string) {
  await page.addInitScript((theme) => {
    localStorage.setItem('upbstudio.settings', JSON.stringify({ theme, themeChosen: true, mode: 'server', lastTab: 'home', updateAuto: false }));
  }, theme);
  await page.route('**/modules/manifest.json', (route) => route.fulfill({ json: { modules: [
    { name: 'grainatlas', version: '0.11.0-test', source: 'local', sha256: 'invented', entry: 'modules/grainatlas/index.html' },
  ] } }));
  await page.route('http://localhost:8000/**', (route) => route.fulfill({ json: {} }));
  await page.goto(`./?server=http://localhost:8000&update-preview=${state}`);
}
async function insideViewport(page: Page) {
  for (const selector of ['[data-testid="check-updates"]', 'header .account', 'header button[aria-label="Settings"]']) {
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
      const button = page.getByTestId('check-updates');
      await expect(button).toHaveAttribute('data-badge', 'true');
      await expect(page.locator('header').getByTestId('check-updates')).toBeVisible();
      expect((await button.boundingBox())!.width).toBeLessThanOrEqual(36);
      await button.click();
      const popover = page.getByTestId('check-updates-popover');
      await expect(popover).toContainText('v0.2.0 is ready');
      await expect(popover.getByRole('button', { name: 'Restart to update' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await insideViewport(page);
      if (process.env.SCREENSHOTS === '1') {
        await mkdir('test-results', { recursive: true });
        await page.screenshot({ path: `test-results/updates-ready-${theme}-${width}x${height}.png` });
      }
      await popover.getByRole('link', { name: 'Update settings…' }).click();
      const panel = page.getByTestId('updates-panel');
      await expect(panel).toBeInViewport({ ratio: 1 });
      await expect(panel).toContainText('ready to install');
      await expect(panel.getByRole('button', { name: 'Restart to update' })).toBeVisible();
      await expect(panel.getByRole('table', { name: 'In this build' })).toBeVisible();
      await expect(panel).toContainText('0.11.0-test (local build)');
      await expect(panel).toContainText('Review tab, faster module switching');
      await insideViewport(page);
      if (process.env.SCREENSHOTS === '1') await page.screenshot({ path: `test-results/updates-panel-${theme}-${width}x${height}.png` });
    });
    for (const [state, text] of [['available', 'Update available: v0.2.0'], ['none', 'Up to date (v0.1.0)']]) {
      test(`updates ${state} ${theme} ${width}x${height}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        // A controllable clock replaces a 5 s sleep for the feedback timer below.
        if (state === 'none') await page.clock.install();
        await openPreview(page, theme, state);
        const button = page.getByTestId('check-updates');
        await button.click();
        await expect(page.getByTestId('check-updates-popover')).toContainText(text);
        await insideViewport(page);
        if (state === 'none') {
          // The result stays in the popover after the old chip's five-second feedback expires.
          await page.clock.fastForward(5100);
          await expect(page.getByTestId('check-updates-popover')).toContainText(text);
          await expect(button).not.toHaveAttribute('data-badge');
        }
      });
    }
  }
}
