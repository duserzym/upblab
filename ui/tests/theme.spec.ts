import { expect, test, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';

const manifest = { modules: [{
  name: 'grainatlas', version: 'test', source: 'https://example.test/grainatlas.tar.gz',
  sha256: '0'.repeat(64), entry: 'modules/grainatlas/index.html',
}] };

// A module that records bridge delivery separately from the host attribute.
// Its marker is unique per document, so a reload cannot pass unnoticed.
const stub = `<!doctype html><html><head><script>
window.themeMarker = Math.random().toString(36);
window.themePushes = [];
window.loadTheme = new URLSearchParams(location.search).get('theme');
if (window.loadTheme) document.documentElement.dataset.theme = window.loadTheme;
window.addEventListener('message', (event) => {
  const m = event.data;
  if (event.source === parent && m?.tag === 'lab-bridge' && m.push === 'theme' &&
      (m.theme === 'light' || m.theme === 'dark')) {
    window.themePushes.push(m.theme);
    // Images deliberately ignores the push for styling, testing the host's
    // same-origin attribute fallback; Sessions applies the push.
    if (window.name !== 'lab-shell:images') document.documentElement.dataset.theme = m.theme;
  }
});
</script><style>
:root { color-scheme: light; background: white; color: black; }
:root[data-theme=dark] { color-scheme: dark; background: black; color: white; }
</style></head><body>Module theme stub</body></html>`;

async function serveModules(page: Page) {
  await page.route('http://localhost:8000/**', route => route.fulfill({ json: {} }));
  await page.route('**/modules/manifest.json', (route) => route.fulfill({ json: manifest }));
  await page.route('**/modules/grainatlas/**', (route) => route.fulfill({ contentType: 'text/html', body: stub }));
  await page.route('**/app/**', (route) => route.fulfill({ contentType: 'text/html', body: stub }));
}

const shellTheme = (page: Page, theme: string) => expect(page.locator('html')).toHaveAttribute('data-theme', theme);
async function visitTabs(page: Page, theme: string) {
  for (const tab of ['Home', 'Images', 'Sessions', 'Review', 'Reduce']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await shellTheme(page, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await shellTheme(page, theme);
}

async function moduleThemes(page: Page, theme: string) {
  await expect(page.locator('iframe.surface')).toHaveCount(2);
  for (const name of ['lab-shell:images', 'lab-shell:sessions']) {
    const frame = page.frame({ name });
    expect(frame).not.toBeNull();
    await expect(frame!.locator('html')).toHaveAttribute('data-theme', theme);
    await expect.poll(() => frame!.evaluate(() =>
      (window as unknown as { themePushes?: string[] }).themePushes?.at(-1))).toBe(theme);
  }
}

const appearance = (page: Page) => page.evaluate(() => ({
  bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
  body: getComputedStyle(document.body).backgroundColor,
}));
async function markers(page: Page) {
  return Promise.all(['lab-shell:images', 'lab-shell:sessions'].map(async (name) => {
    const frame = page.frame({ name })!;
    return frame.evaluate(() => (window as unknown as { themeMarker: string }).themeMarker);
  }));
}

for (const scheme of ['light', 'dark'] as const) {
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 640]]) {
    test(`web ${scheme} at ${width} × ${height}: System, all tabs, live switch without reload`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: scheme });
      await serveModules(page);
      // Playwright supplies a fresh context; no theme or settings are seeded.
      await page.goto('./?server=http://localhost:8000');
      await expect(page.getByRole('tab', { name: 'Home', exact: true })).toBeVisible();
      await visitTabs(page, scheme);
      await expect(page.getByRole('radio', { name: 'System', exact: true })).toBeChecked();
      await moduleThemes(page, scheme);
      for (const name of ['lab-shell:images', 'lab-shell:sessions']) {
        expect(await page.frame({ name })!.evaluate(() =>
          (window as unknown as { loadTheme: string }).loadTheme)).toBe(scheme);
      }
      const beforeMarkers = await markers(page);
      const before = await appearance(page);
      const opposite = scheme === 'light' ? 'dark' : 'light';
      await page.getByRole('radio', { name: opposite === 'light' ? 'Light' : 'Dark', exact: true }).click();
      await shellTheme(page, opposite);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('upbstudio.settings')!)))
        .toMatchObject({ theme: opposite, themeChosen: true });
      await moduleThemes(page, opposite);
      await expect.poll(() => appearance(page)).not.toEqual(before);
      expect((await appearance(page)).bg).not.toBe(before.bg);
      await visitTabs(page, opposite);
      expect(await markers(page)).toEqual(beforeMarkers);

      // System resolves immediately and then follows a live OS change.
      await page.getByRole('radio', { name: 'System', exact: true }).click();
      await shellTheme(page, scheme);
      await page.emulateMedia({ colorScheme: opposite });
      await shellTheme(page, opposite);
      await moduleThemes(page, opposite);
      expect(await markers(page)).toEqual(beforeMarkers);
    });
  }

  test(`desktop ${scheme}: publishes System and explicit choices to the host`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await serveModules(page);
    await page.addInitScript(installFakeTauri, { store: { mode: 'server', serverUrl: 'http://localhost:8000' } });
    await page.goto('./');
    await expect(page.getByRole('tab', { name: 'Home', exact: true })).toBeVisible();
    await visitTabs(page, scheme);
    const themes = () => page.evaluate(() =>
      (window as unknown as { __fake: { calls: [string, { theme?: string }?][] } }).__fake.calls
        .filter(([command]) => command === 'module_theme').map(([, args]) => args?.theme));
    await expect.poll(themes).toContain(scheme);
    const opposite = scheme === 'light' ? 'dark' : 'light';
    await page.getByRole('radio', { name: opposite === 'light' ? 'Light' : 'Dark', exact: true }).click();
    await shellTheme(page, opposite);
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __fake: { store: Record<string, unknown> } }).__fake.store.themeChosen)).toBe(true);
    await expect.poll(async () => (await themes()).at(-1)).toBe(opposite);
    await visitTabs(page, opposite);
    // Theme changes may re-show a native surface, but must not navigate it.
    expect(await page.evaluate(() =>
      (window as unknown as { __fake: { calls: [string, { module?: string; navigate?: boolean }?][] } }).__fake.calls
        .filter(([command, args]) => command === 'module_open' && args?.navigate)
        .map(([, args]) => args!.module))).toEqual(['images', 'sessions']);
    await page.getByRole('radio', { name: 'System', exact: true }).click();
    await page.emulateMedia({ colorScheme: opposite });
    await shellTheme(page, opposite);
    await expect.poll(async () => (await themes()).at(-1)).toBe(opposite);
  });
}
