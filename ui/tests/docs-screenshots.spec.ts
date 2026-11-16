import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Frame, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';
import { demoAreas, demoAtlas, demoProject, demoSpots, drawDemoTiles } from './fixtures/demo-atlas';
import { demoApi } from './fixtures/demo-upbdb';
import { session } from './fixtures/review';

const server = 'http://localhost:8000';
const upbdbDist = fileURLToPath(new URL('../../../upbdb/ui/dist/', import.meta.url));
const atlasEntry = fileURLToPath(new URL('../public/modules/grainatlas/index.html', import.meta.url));
const output = fileURLToPath(new URL('../../docs/images/', import.meta.url));
const screens = ['home', 'sessions', 'images', 'review-concordia', 'review-geochemistry',
  'review-depth', 'review-images', 'reduce', 'settings'] as const;
type Screen = typeof screens[number];
let bundle: Map<string, Buffer>;

test.skip(process.env.DOCS_SCREENSHOTS !== '1', 'Documentation images are opt-in: run pnpm docs-screenshots.');
test.skip(({ browserName }) => browserName !== 'chromium', 'Documentation images are Chromium only.');
test.beforeAll(async ({ browser }, info) => {
  if (info.project.name !== 'chromium') return;
  await mkdir(output, { recursive: true });
  // Use an isolated blank page. Pixels are generated in canvas at test time,
  // returned as bytes and served by routes; no binary fixture is committed.
  const generator = await browser.newPage();
  try {
    const encoded = await generator.evaluate(drawDemoTiles, { areas: demoAreas, spots: demoSpots });
    bundle = new Map(Object.entries(encoded).map(([path, data]) => [path, Buffer.from(data, 'base64')]));
    bundle.set('project.json', Buffer.from(JSON.stringify(demoProject)));
    bundle.set('spots.json', Buffer.from(JSON.stringify({ project_id: 'project-demo', documents: demoAreas.map(a => ({
      project_id: 'project-demo', sample: a.sample, spots: demoSpots.filter(s => s.area_id === a.id).map(s => ({
        id: s.id, name: s.name, grain: s.grain_number <= 3 ? `area/${s.grain_number}` : `reference/${s.grain_number}`,
        area: s.area_id, x_um: s.x_um, y_um: s.y_um, diameter_um: s.diameter_um, kind: s.kind,
      })),
    })) })));
    bundle.set('grains.geojson', Buffer.from(JSON.stringify({ type: 'FeatureCollection',
      features: Object.values(demoProject.grainatlas_ui.grains).flat().map(g => ({ type: 'Feature',
        properties: { ...g, area: g.area_id }, geometry: { type: 'Polygon', coordinates: [[...g.polygon_um, g.polygon_um[0]]] } })) })));
    bundle.set('scalebars.json', Buffer.from(JSON.stringify(demoAreas.map(a => ({ area: a.id, length_um: 50, anchor_um: [25, 350] })))));
    const files = [...bundle].map(([path, bytes]) => ({ path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
    bundle.set('atlas.json', Buffer.from(JSON.stringify({ ...demoAtlas, files })));
  } finally { await generator.close(); }
});

/** All server-origin traffic, including nested frames, terminates here. */
async function serveDemo(context: BrowserContext) {
  const unexpected: string[] = [];
  const pending = new Set<string>();
  let tileReads = 0;
  context.on('request', request => {
    if (request.url().startsWith(`${server}/atlas/projects/`) && request.url().includes('.webp')) {
      pending.add(request.url()); tileReads++;
    }
  });
  const finished = (request: { url(): string }) => pending.delete(request.url());
  context.on('requestfinished', finished);
  context.on('requestfailed', finished);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    // Vite and the bundled GrainAtlas build are the only unmocked origin.
    if (url.origin === 'http://localhost:1431') return route.continue();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS' };
    if (url.origin === server) {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (request.method() === 'GET') {
        if (url.pathname.startsWith('/atlas/projects/project-demo/')) {
          const path = url.pathname.slice('/atlas/projects/project-demo/'.length), body = bundle.get(path);
          if (body) return route.fulfill({ body, headers, contentType: path.endsWith('.webp') ? 'image/webp' : 'application/json' });
        }
        if (url.pathname.startsWith('/v1/')) {
          // Review fixtures include run-specific answers; timeline filters use
          // the same small invented inventory regardless of query order.
          const key = url.pathname + url.search;
          const body = demoApi[key] ?? demoApi[url.pathname];
          if (body !== undefined) return route.fulfill({ json: body, headers });
        }
        if (url.pathname.startsWith('/app/')) {
          const relative = decodeURIComponent(url.pathname.slice('/app/'.length)) || 'index.html';
          const path = resolve(upbdbDist, relative);
          if (path.startsWith(upbdbDist.replace(/\/$/, '') + sep) && existsSync(path)) {
            const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
              '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.webp': 'image/webp' };
            return route.fulfill({ body: await readFile(path), contentType: types[extname(path)] ?? 'application/octet-stream', headers });
          }
        }
      }
    }
    unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
    await route.fulfill({ status: 404, json: { detail: 'Not in the invented documentation fixture' }, headers });
  });
  await context.route('**/modules/manifest.json', route => route.fulfill({ json: { modules: [{
    name: 'grainatlas', version: 'demo', source: 'fixture', sha256: 'demo', entry: 'modules/grainatlas/index.html',
  }] } }));
  // Observe decode completion without changing module rendering or styling.
  await context.addInitScript(() => {
    const state = { pending: 0 };
    (window as unknown as { __docsBitmaps: typeof state }).__docsBitmaps = state;
    const decode = window.createImageBitmap.bind(window);
    window.createImageBitmap = ((...args: unknown[]) => {
      state.pending++;
      return (Reflect.apply(decode, window, args) as Promise<ImageBitmap>).finally(() => { state.pending--; });
    }) as typeof createImageBitmap;
  });
  return { unexpected, pending, tileReads: () => tileReads };
}

async function frameFor(page: Page, module: string): Promise<Frame> {
  const iframe = page.locator(`iframe[data-fake-module="${module}"]`);
  await expect(iframe).toBeVisible();
  const handle = await iframe.elementHandle();
  const frame = await handle!.contentFrame();
  expect(frame).toBeTruthy();
  await frame!.waitForLoadState('domcontentloaded');
  return frame!;
}

async function painted(page: Page, demo: Awaited<ReturnType<typeof serveDemo>>) {
  await page.waitForLoadState('networkidle');
  await expect.poll(() => demo.pending.size, { message: 'All atlas tile requests finish' }).toBe(0);
  for (const frame of page.frames()) {
    await frame.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(img => img.decode()));
    });
    await frame.waitForFunction(() => (window as unknown as { __docsBitmaps: { pending: number } }).__docsBitmaps.pending === 0);
    await frame.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  }
  expect(demo.unexpected, 'No request may fall through to a real service').toEqual([]);
  // A privacy guard in every frame, including form values and image descriptions.
  for (const frame of page.frames()) {
    const visible = await frame.evaluate(() => [document.body.innerText,
      ...[...document.querySelectorAll('input,textarea')].map(el => (el as HTMLInputElement).value),
      ...[...document.images].map(el => el.alt)].join('\n'));
    expect(visible).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\Users\\|\.ts\.net\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function readyAtlas(page: Page, demo: Awaited<ReturnType<typeof serveDemo>>, theme: string) {
  const frame = await frameFor(page, 'images');
  await expect(frame.getByRole('application', { name: 'Mosaic canvas', exact: true })).toBeVisible();
  await expect(frame.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(frame.getByTestId('viewer-controls')).toBeVisible();
  await expect(frame.locator('[data-testid="spot"].sel').filter({ hasText: 'Zircon_1' })).toBeVisible();
  await expect.poll(demo.tileReads).toBeGreaterThan(0);
  await painted(page, demo);
  // The viewer uses canvas for pixels and SVG for spot/grain overlays.
  await expect(frame.locator('[aria-label="Mosaic canvas"] svg').first()).toBeVisible();
  await expect.poll(() => frame.locator('[aria-label="Mosaic canvas"] canvas').evaluate((el: HTMLCanvasElement) => {
    const data = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
    let bright = 0;
    for (let i = 0; i < data.length; i += 16) if (data[i] > 100 && Math.abs(data[i] - data[i + 1]) < 3) bright++;
    return bright;
  }), { message: 'Synthetic grains have painted into the mosaic' }).toBeGreaterThan(100);
}

for (const theme of ['light', 'dark'] as const) for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test.describe(`${theme} ${width}x${height}`, () => {
    test.use({ viewport: { width, height }, colorScheme: theme, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' });
    for (const screen of screens) test(`${screen}`, async ({ page, context }) => {
      test.skip(screen === 'sessions' && !existsSync(resolve(upbdbDist, 'index.html')),
        'Sessions screenshot skipped: build the read-only ../upbdb/ui/dist UI first.');
      test.skip((screen === 'images' || screen === 'review-images') && !existsSync(atlasEntry),
        'Atlas screenshot skipped: fetch/build ui/public/modules/grainatlas first.');
      test.setTimeout(60_000);
      const demo = await serveDemo(context);
      await page.clock.setFixedTime(new Date('2026-11-15T12:00:00Z'));
      await page.addInitScript(installFakeTauri, {
        store: { mode: 'server', serverUrl: server, lastTab: screen.startsWith('review-') || screen === 'images' ? 'review' : screen === 'settings' ? 'home' : screen,
          theme, themeChosen: true, updateAuto: false, reviewSplit: false,
          reviewScope: JSON.stringify({ kind: 'session', id: session.id, run: 'preferred' }),
          reviewInset: { width: 180, collapsed: false } },
        fixtures: demoApi, signedIn: true, studioFound: true, renderModules: true,
      });
      await page.goto('./');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await prepareScreen(page, screen, demo, theme);
      await painted(page, demo);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: resolve(output, `${screen}-${theme}-${width}x${height}.png`), animations: 'disabled' });
    });
  });
}

async function prepareScreen(page: Page, screen: Screen, demo: Awaited<ReturnType<typeof serveDemo>>, theme: string) {
  if (screen.startsWith('review-')) {
    await expect(page.locator('[data-spot-key="acq-1"]')).toBeVisible();
    await page.locator('[data-spot-key="acq-1"]').click();
    if (screen === 'review-geochemistry') {
      await page.getByRole('tab', { name: 'Geochemistry', exact: true }).click();
      await page.getByTestId('geochem-panel').first().getByRole('button', { name: 'Choose Y axis', exact: true }).click();
      await page.getByRole('group', { name: 'Choose Y quantity' }).getByRole('button', { name: 'REE pattern', exact: true }).click();
      await expect(page.getByText('CI chondrite, McDonough and Sun (1995)')).toBeVisible();
    } else if (screen === 'review-depth') {
      await page.getByRole('tab', { name: 'Depth profile', exact: true }).click();
      await expect(page.getByLabel('Depth profile axis')).toBeVisible();
      await expect(page.getByLabel('Plotted depth channels')).toBeVisible();
    } else if (screen === 'review-images') {
      await page.getByRole('checkbox', { name: 'SEM images', exact: true }).check();
      await readyAtlas(page, demo, theme);
      await expect(page.getByRole('region', { name: 'Age & plots', exact: true })
        .getByRole('button', { name: 'Edit in UPbRPy Studio', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'SEM images', exact: true })
        .getByRole('button', { name: 'Edit in grainatlas', exact: true })).toBeVisible();
    }
    // Shell plots are uPlot canvases, not SVG. Wait for their real renderers.
    await expect(page.getByTestId('review-view').locator('.uplot canvas').first()).toBeVisible();
    if (screen !== 'review-depth') await expect(page.getByTestId('review-view').locator('[data-point-key="acq-1"]').first()).toBeAttached();
    return;
  }
  if (screen === 'images') {
    // The current shell hosts GrainAtlas in Review rather than an Images tab.
    // Its real maximise control gives the documentation an images-focused view.
    await expect(page.locator('[data-spot-key="acq-1"]')).toBeVisible();
    await page.locator('[data-spot-key="acq-1"]').click();
    await page.getByRole('checkbox', { name: 'SEM images', exact: true }).check();
    await page.getByRole('button', { name: 'Maximise SEM images', exact: true }).click();
    await readyAtlas(page, demo, theme);
    const frame = await frameFor(page, 'images');
    await frame.getByTestId('viewer-controls').getByRole('button', { name: 'Fit', exact: true }).click();
    await readyAtlas(page, demo, theme);
  } else if (screen === 'sessions') {
    const frame = await frameFor(page, 'sessions');
    await expect(frame.getByLabel('Session dashboard')).toBeVisible();
    await expect(frame.getByTestId('session-card')).toHaveCount(3);
    await expect(frame.getByRole('application', { name: /^Sessions and spots over time/ })).toBeVisible();
    await expect(frame.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(frame.getByRole('link', { name: /Demo analyst/ })).toBeVisible();
  } else if (screen === 'settings') {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Lab server', exact: true })).toHaveAttribute('aria-checked', 'true');
  } else if (screen === 'reduce') {
    await expect(page.getByTestId('reduce-sessions').locator('article')).toHaveCount(3);
    await expect(page.getByText('UPbRPy Studio is not installed')).toHaveCount(0);
  } else {
    await expect(page.getByTestId('session-card')).toHaveCount(3);
    await expect(page.getByTestId('mount-card')).toHaveCount(1);
    await expect(page.getByTestId('mount-card').locator('img').first()).toBeVisible();
    await expect(page.getByText(/loading reductions|checking…/)).toHaveCount(0);
  }
}
