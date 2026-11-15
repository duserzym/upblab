import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';

async function preview(page: Page, scenario: string, manifest = true) {
  await page.addInitScript(() => {
    localStorage.setItem('upbstudio.settings', JSON.stringify({ mode: 'server', lastTab: 'home', updateAuto: false }));
  });
  await page.route('**/modules/manifest.json', (route) => manifest ? route.fulfill({ json: { modules: [
    { name: 'grainatlas', version: '0.1.0', source: 'local', commit: 'abc1234'.padEnd(40, '0'), sha256: 'a'.repeat(64), entry: 'modules/grainatlas/index.html' },
    { name: 'upbdb', version: '0.3.0', source: 'release', sha256: 'b'.repeat(64), entry: 'modules/upbdb/index.html' },
  ] } }) : route.fulfill({ status: 404, body: '' }));
  await page.route('http://localhost:8000/**', (route) => route.fulfill({ json: {} }));
  await page.goto(`./?server=http://localhost:8000&update-preview=${scenario}`);
  await expect(page.getByTestId('check-updates')).toBeVisible();
}

async function insideViewport(page: Page, locator: Locator) {
  await expect(locator).toBeInViewport({ ratio: 1 });
  const box = (await locator.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

async function screenshot(page: Page, info: TestInfo, state: string) {
  if (process.env.SCREENSHOTS !== '1' || info.project.name !== 'chromium') return;
  const directory = process.env.SHOT_DIR ?? '../docs/screenshots';
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `check-updates-${state}.png`) });
}

test('idle button has a version tooltip, no badge and an exact accessible name', async ({ page }, info) => {
  await page.setViewportSize({ width: 1512, height: 982 });
  await preview(page, 'idle');
  const button = page.getByTestId('check-updates');
  await expect(button).toHaveAccessibleName('Check for updates');
  await expect(button).toHaveAttribute('title', /Check for updates · UPb Lab v0\.1\.0/);
  await expect(button).not.toHaveAttribute('data-badge');
  await expect(button.locator('.dot')).toHaveCount(0);
  await screenshot(page, info, 'idle');
});

for (const [width, height] of [[1512, 982], [1024, 640]]) {
  test(`available popover fits ${width}x${height} and closes with Escape, outside click and a second click`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await preview(page, 'available');
    const button = page.getByTestId('check-updates');
    const popup = page.getByTestId('check-updates-popover');
    await expect(button).toHaveAttribute('data-badge', 'true');
    await expect(button.locator('.dot')).toBeVisible();
    await insideViewport(page, button);
    await button.click();
    await expect(popup).toContainText('Update available: v0.2.0');
    await expect(popup).toContainText('UPb Lab v0.1.0');
    await expect(popup.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
    await expect(popup).toContainText('Modules: grainatlas 0.1.0 (local abc1234), UPbDB 0.3.0');
    await expect(popup).toContainText('Modules update with UPb Lab.');
    await insideViewport(page, popup);
    const settingsBox = (await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox())!;
    expect(settingsBox.y).toBe((await button.boundingBox())!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    if (width === 1512) await screenshot(page, info, 'available');

    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    await expect(popup).toBeVisible();
    await button.click();
    await expect(popup).toBeHidden();
    await button.click();
    await expect(popup).toBeVisible();
    await page.locator('.brand').click();
    await expect(popup).toBeHidden();
  });
}

for (const [scenario, text] of [
  ['none', 'Up to date (v0.1.0)'],
  ['error', 'Updates are not configured for this build yet.'],
  ['checking', 'Checking for updates…'],
  ['downloading', 'Downloading v0.2.0… 43%'],
  ['ready', 'v0.2.0 is ready'],
  ['unsupported', 'Update available: v0.2.0'],
]) {
  test(`${scenario} shows its result beside the button`, async ({ page }) => {
    await preview(page, scenario);
    const button = page.getByTestId('check-updates');
    await button.click();
    const popup = page.getByTestId('check-updates-popover');
    await expect(popup).toContainText(text);
    await expect(popup.getByRole('link', { name: 'Update settings…' })).toBeVisible();
    if (scenario === 'checking') {
      await expect(button).toHaveAttribute('aria-busy', 'true');
      await expect(button.locator('svg')).toHaveClass(/busy/);
      await expect(button.locator('svg')).toHaveCSS('animation-name', /update-spin/);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(button.locator('svg')).toHaveCSS('animation-name', 'none');
      await expect(popup).toContainText('Checking for updates…');
    }
    if (scenario === 'ready') await expect(popup.getByRole('button', { name: 'Restart to update' })).toBeVisible();
    if (scenario === 'unsupported') await expect(popup.getByRole('link', { name: 'Open download page' })).toHaveAttribute('href', /\/releases$/);
    if (scenario === 'none' || scenario === 'error' || scenario === 'checking' || scenario === 'downloading') {
      await expect(button).not.toHaveAttribute('data-badge');
    }
  });
}

test('Download and Restart use the shared updater and settings link opens the existing panel', async ({ page }) => {
  await preview(page, 'available');
  await page.getByTestId('check-updates').click();
  const popup = page.getByTestId('check-updates-popover');
  await popup.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(popup).toContainText('v0.2.0 is ready');
  await expect(page.getByTestId('check-updates')).toHaveAttribute('data-badge', 'true');
  await popup.getByRole('button', { name: 'Restart to update' }).click();
  await expect(popup).toContainText('Installing and restarting…');
  await popup.getByRole('link', { name: 'Update settings…' }).click();
  await expect(popup).toBeHidden();
  await expect(page.getByTestId('updates-panel')).toBeInViewport({ ratio: 0.9 });
});

test('missing module manifest omits the module list', async ({ page }) => {
  await preview(page, 'none', false);
  await page.getByTestId('check-updates').click();
  const popup = page.getByTestId('check-updates-popover');
  await expect(popup).toContainText('Up to date (v0.1.0)');
  await expect(popup).not.toContainText('Modules:');
});

test('desktop standards warning survives the fold and the popover hides native module views', async ({ page }) => {
  await page.addInitScript(installFakeTauri, {
    store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'home' },
    standards: { warning: true, message: 'Invented standards differ.', changed: ['invented.toml'] },
  });
  await page.route('**/modules/manifest.json', (route) => route.fulfill({ json: { modules: [
    { name: 'grainatlas', version: '0.1.0', source: 'local', sha256: 'a'.repeat(64), entry: 'modules/grainatlas/index.html' },
  ] } }));
  await page.route('**/modules/grainatlas/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>grainatlas</title><p>grainatlas</p>' }));
  await page.goto('./');
  // The shell listens for host events once settings, modules and links are set up.
  await page.waitForFunction(() => (window as unknown as { __fake: { listeners: Map<string, unknown> } }).__fake.listeners.has('shell://drop'));
  await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fake: { calls: [string, unknown][] } }).__fake.calls.some(([c]) => c === 'module_open'))).toBe(true);
  const button = page.getByTestId('check-updates');
  await button.click();
  await expect(page.getByTestId('check-updates-popover')).toContainText('Standards warning: Invented standards differ.');
  await expect(button).toHaveAttribute('data-badge', 'true');
  await expect(button.locator('.dot')).toHaveClass(/warning/);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fake: { calls: [string, unknown][] } }).__fake.calls.some(([c]) => c === 'module_hide'))).toBe(true);
  const opens = await page.evaluate(() => (window as unknown as { __fake: { calls: [string, unknown][] } }).__fake.calls.filter(([c]) => c === 'module_open').length);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fake: { calls: [string, unknown][] } }).__fake.calls.filter(([c]) => c === 'module_open').length)).toBeGreaterThan(opens);
});
