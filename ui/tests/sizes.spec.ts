import { expect, test, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';
import { problems } from './problems';

// ux-conventions rule 7 (grainatlas docs/ux-conventions.md): every screen of
// the shell fits a 14-inch laptop (1280 x 800 CSS pixels) as well as
// 1440 x 900, and the smallest window (1024 x 640) still has no sideways
// overflow. Module tabs get all the height under the tab bar. Content inside
// a scrolling area counts as reachable.

const SIZES = [
  [1440, 900],
  [1280, 800],
] as const;
const MIN = [1024, 640] as const;
const BAR = 48;

const PKG = '/Users/lab/Github/grainatlas/tests/fixtures/tm4000/Mount_XS_150X';
const QTEGRA = '/Users/lab/Github/laicpmsdb/tests/fixtures/qtegra/Apatite_demo';
const scans = {
  [PKG]: {
    scan: 's1',
    roots: [{ path: PKG, name: 'Mount_XS_150X', dir: true }],
    entries: [
      { root: 0, rel: '001_HJ-GC1/001_HJ-GC1_0000.jpg', size: 41000 },
      { root: 0, rel: '001_HJ-GC1/001_HJ-GC1_0000.txt', size: 900 },
      { root: 0, rel: 'Mount_XS_150X.zag', size: 400 },
    ],
    truncated: false,
    missing: [],
  },
  [QTEGRA]: {
    scan: 's2',
    roots: [{ path: QTEGRA, name: 'Apatite_demo', dir: true }],
    entries: [
      { root: 0, rel: 'Apatite_demo_1.csv', size: 9000 },
      { root: 0, rel: 'Apatite_demo_10.csv', size: 9000 },
    ],
    truncated: false,
    missing: [],
  },
};

const manifest = {
  modules: [
    {
      name: 'grainatlas',
      version: '0.11.0-9b2b2cc',
      source: 'https://github.com/duserzym/grainatlas/releases/download/web-9b2b2cc/grainatlas-web.tar.gz',
      sha256: '5d41402abc4b2a76b9719d911017c592ae0c3d5e5a8f0c6b0a1f6e3e0b9c2d1f',
      entry: 'modules/grainatlas/index.html',
    },
  ],
};

async function serveModules(page: Page) {
  await page.route('**/modules/manifest.json', (r) => r.fulfill({ json: manifest }));
  await page.route('**/modules/grainatlas/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>grainatlas</title><p>grainatlas</p>' }));
  await page.route('http://localhost:8000/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>laicpmsdb</title><p>laicpmsdb</p>' }));
}

async function desktop(page: Page, store: Record<string, string>) {
  await serveModules(page);
  await page.addInitScript(installFakeTauri, { store, scans });
  await page.goto('./');
  if (store.mode) {
    // The shell listens for host events once settings, modules and links are set up.
    await page.waitForFunction(() => (window as unknown as { __fake: { listeners: Map<string, unknown> } }).__fake.listeners.has('shell://drop'));
  }
}

type Call = [string, Record<string, unknown> | undefined];
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __fake: { calls: Call[] } }).__fake.calls);
const emit = (page: Page, event: string, payload: unknown) =>
  page.evaluate(([e, p]) => (window as unknown as { __emit(e: string, p: unknown): void }).__emit(e as string, p), [event, payload] as const);

/** The rectangle the shell last asked the host to lay a module webview over. */
async function moduleBounds(page: Page, module: string) {
  const all = await calls(page);
  const last = all.filter(([c, a]) => (c === 'module_open' || c === 'module_bounds') && a?.module === module).pop();
  return last?.[1]?.bounds as { x: number; y: number; width: number; height: number } | undefined;
}

for (const [w, h] of SIZES) {
  test.describe(`${w} x ${h}`, () => {
    test.beforeEach(async ({ page }) => page.setViewportSize({ width: w, height: h }));

    test('desktop: first-run wizard', async ({ page }) => {
      await desktop(page, { mode: '' });
      await expect(page.getByRole('heading', { name: 'Welcome to UPb Lab' })).toBeVisible();
      expect(await problems(page, 'wizard, choose')).toEqual([]);
      await page.getByRole('button', { name: /^Lab server/ }).click();
      await expect(page.getByLabel('laicpmsdb server URL')).toBeVisible();
      expect(await problems(page, 'wizard, lab server')).toEqual([]);
      await page.getByRole('button', { name: 'Back' }).click();
      await page.getByRole('button', { name: /^This computer/ }).click();
      await expect(page.getByLabel('Repeat password')).toBeVisible();
      expect(await problems(page, 'wizard, this computer')).toEqual([]);
      await page.getByRole('button', { name: 'Set up' }).click(); // empty form: every field shows its error
      expect(await problems(page, 'wizard, this computer with errors')).toEqual([]);
    });

    test('desktop: tabs, module areas, Settings and the sign-in dialog', async ({ page }) => {
      await desktop(page, { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'home' });
      await expect(page.getByRole('heading', { name: 'UPb Lab', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Upload LA-ICP-MS session…', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Upload image set…', exact: true })).toBeVisible();
      expect(await problems(page, 'Home')).toEqual([]);

      await emit(page, 'shell://drag', true);
      await expect(page.locator('.drop-hint')).toBeVisible();
      expect(await problems(page, 'tab bar while dragging')).toEqual([]);
      await emit(page, 'shell://drag', false);

      for (const [tab, module] of [
        ['Images', 'images'],
        ['Sessions', 'sessions'],
      ] as const) {
        await page.getByRole('tab', { name: tab }).click();
        await expect.poll(() => moduleBounds(page, module)).toEqual({ x: 0, y: BAR, width: w, height: h - BAR, viewportHeight: h });
        expect(await problems(page, tab)).toEqual([]);
      }
      await page.getByRole('tab', { name: 'Review', exact: true }).click();
      expect(await problems(page, 'Review')).toEqual([]);
      await page.getByRole('tab', { name: 'Reduce' }).click();
      expect(await problems(page, 'Reduce')).toEqual([]);
      await page.getByRole('button', { name: 'Settings' }).click();
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      expect(await problems(page, 'Settings')).toEqual([]);

      await page.getByRole('button', { name: 'Sign in' }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign in with ORCID' })).toBeVisible();
      expect(await problems(page, 'sign-in dialog')).toEqual([]);
      await page.keyboard.press('Escape');
    });

    test('web delivery: Home, Settings and module frames', async ({ page }) => {
      await serveModules(page);
      await page.goto('./');
      await expect(page.getByRole('heading', { name: 'UPb Lab', exact: true })).toBeVisible();
      expect(await problems(page, 'web Home')).toEqual([]);
      for (const tab of ['Images', 'Sessions']) {
        await page.getByRole('tab', { name: tab }).click();
        const frame = page.locator('iframe.surface:visible');
        await expect(frame).toBeVisible();
        const box = (await frame.boundingBox())!;
        expect({ x: box.x, y: box.y, width: box.width, height: box.height }).toEqual({ x: 0, y: BAR, width: w, height: h - BAR });
      }
      await page.getByRole('tab', { name: 'Review', exact: true }).click();
      expect(await problems(page, 'web Review')).toEqual([]);
      await page.getByRole('button', { name: 'Settings' }).click();
      expect(await problems(page, 'web Settings')).toEqual([]);
    });
  });
}

test(`the smallest window (${MIN[0]} x ${MIN[1]}) has no sideways overflow`, async ({ page }) => {
  await page.setViewportSize({ width: MIN[0], height: MIN[1] });
  await desktop(page, { mode: 'server', serverUrl: 'http://localhost:8000' });
  await expect(page.getByRole('heading', { name: 'UPb Lab', exact: true })).toBeVisible();
  expect(await problems(page, 'Home')).toEqual([]);
  await page.getByRole('button', { name: 'Settings' }).click();
  expect(await problems(page, 'Settings')).toEqual([]);
});

test('desktop: drops go to the tab that reads them, never asking', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await desktop(page, { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'home' });
  await expect(page.getByRole('heading', { name: 'UPb Lab', exact: true })).toBeVisible();

  await emit(page, 'shell://drop', { paths: [PKG], over: 'shell' });
  await expect(page.getByRole('tab', { name: 'Images' })).toHaveAttribute('aria-selected', 'true');
  const offer = (await calls(page)).find(([c]) => c === 'files_offer')![1]!;
  expect(offer).toMatchObject({ module: 'images', kind: 'package', name: 'Mount_XS_150X', path: PKG, nudge: true });

  await emit(page, 'shell://drop', { paths: [QTEGRA], over: 'grainatlas' });
  await expect(page.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(async () => (await calls(page)).filter(([c, a]) => c === 'module_open' && a?.module === 'sessions').pop()?.[1]?.url)
    .toContain(`#/ingest?path=${encodeURIComponent(QTEGRA)}`);

  await page.getByRole('tab', { name: 'Home' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Apatite_demo' })).toContainText('Qtegra export Apatite_demo, 2 files');
  expect(await problems(page, 'Home after drops')).toEqual([]);
});
