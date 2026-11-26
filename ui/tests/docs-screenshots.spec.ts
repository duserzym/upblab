import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Frame, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';
import { demoAreas, demoAtlas, demoProject, demoSpots, drawDemoTiles } from './fixtures/demo-atlas';
import { demoApi } from './fixtures/demo-upbdb';
import { loadDocsData } from './fixtures/docs-data';
import { session } from './fixtures/review';

const server = 'http://localhost:8000';
const upbdbDist = fileURLToPath(new URL('../../../upbdb/ui/dist/', import.meta.url));
const atlasEntry = fileURLToPath(new URL('../public/modules/grainatlas/index.html', import.meta.url));
const output = fileURLToPath(new URL('../../docs/images/', import.meta.url));
const capture = process.env.DOCS_DATA ? loadDocsData(process.env.DOCS_DATA) : null;
// Names that must never show, kept beside the capture (outside the repository), one per line.
const denyFile = process.env.DOCS_DATA ? resolve(process.env.DOCS_DATA, 'deny.txt') : '';
const deny = denyFile && existsSync(denyFile) ? readFileSync(denyFile, 'utf8').split('\n').map(l => l.trim()).filter(Boolean) : [];
const api = capture?.api ?? demoApi;
const scope = capture?.scope ?? { session: session.id, project: 'project-demo',
  focusKey: 'acq-1', focusLabel: 'Zircon_1', sessions: 3, mounts: 1 };
const contentTypes: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.geojson': 'application/geo+json', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.webp': 'image/webp' };
const screens = ['home', 'sessions', 'images', 'review-concordia', 'review-geochemistry',
  'review-depth', 'review-images', 'review-groups', 'review-region', 'reduce', 'settings'] as const;
type Screen = typeof screens[number];
let bundle: Map<string, Buffer>;

test.skip(process.env.DOCS_SCREENSHOTS !== '1', 'Documentation images are opt-in: run pnpm docs-screenshots.');
test.skip(({ browserName }) => browserName !== 'chromium', 'Documentation images are Chromium only.');
test.beforeAll(async ({ browser }, info) => {
  if (info.project.name !== 'chromium') return;
  await mkdir(output, { recursive: true });
  if (capture) return;
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
  const shellOrigin = new URL(test.info().project.use.baseURL!).origin;
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
    if (url.origin === shellOrigin) return route.continue();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS' };
    if (url.origin === server) {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (request.method() === 'GET') {
        const atlasPrefix = `/atlas/projects/${scope.project}/`;
        if (url.pathname.startsWith(atlasPrefix)) {
          const relative = decodeURIComponent(url.pathname.slice(atlasPrefix.length));
          if (capture) {
            const path = resolve(capture.atlasRoot, relative);
            if (!relative.split(/[\\/]/).includes('..') && path.startsWith(capture.atlasRoot + sep) && existsSync(path)) {
              return route.fulfill({ body: await readFile(path), headers,
                contentType: contentTypes[extname(path)] ?? 'application/octet-stream' });
            }
          } else {
            const body = bundle.get(relative);
            if (body) return route.fulfill({ body, headers, contentType: relative.endsWith('.webp') ? 'image/webp' : 'application/json' });
          }
        }
        if (url.pathname.startsWith('/v1/')) {
          // Run-specific answers take precedence; timeline filters fall back to
          // the captured or invented inventory regardless of query order.
          const key = url.pathname + url.search;
          const body = Object.hasOwn(api, key) ? api[key] : api[url.pathname];
          if (body !== undefined) return route.fulfill({ json: body, headers });
        }
        if (url.pathname.startsWith('/app/')) {
          const relative = decodeURIComponent(url.pathname.slice('/app/'.length)) || 'index.html';
          const path = resolve(upbdbDist, relative);
          if (path.startsWith(upbdbDist.replace(/\/$/, '') + sep) && existsSync(path)) {
            return route.fulfill({ body: await readFile(path), contentType: contentTypes[extname(path)] ?? 'application/octet-stream', headers });
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
    const lower = visible.toLowerCase();
    expect(deny.filter(name => new RegExp(`(^|[^a-z0-9])${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(lower)), 'Names listed in deny.txt').toEqual([]);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function readyAtlas(page: Page, demo: Awaited<ReturnType<typeof serveDemo>>, theme: string, singleSpot = true) {
  const frame = await frameFor(page, 'images');
  await expect(frame.getByRole('application', { name: 'Mosaic canvas', exact: true })).toBeVisible();
  await expect(frame.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(frame.getByTestId('viewer-controls')).toBeVisible();
  if (singleSpot) await expect(frame.locator('[data-testid="spot"].sel').filter({ hasText: scope.focusLabel })).toBeVisible();
  await expect(frame.getByTestId('mount-inset-body')).toBeVisible();
  await expect.poll(demo.tileReads).toBeGreaterThan(0);
  await painted(page, demo);
  // The viewer uses canvas for pixels and SVG for spot/grain overlays.
  await expect(frame.locator('[aria-label="Mosaic canvas"] svg').first()).toBeVisible();
  await expect.poll(() => frame.locator('[aria-label="Mosaic canvas"] canvas').evaluate((el: HTMLCanvasElement, realImage: boolean) => {
    const data = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
    if (data.length < 8) return false;
    // Any real SEM image is acceptable; a blank or uniform canvas is not.
    if (realImage) {
      for (let i = 4; i < data.length; i += 4) {
        if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) return true;
      }
      return false;
    }
    let bright = 0;
    for (let i = 0; i < data.length; i += 16) if (data[i] > 100 && Math.abs(data[i] - data[i + 1]) < 3) bright++;
    return bright > 100;
  }, !!capture), { message: capture ? 'Real SEM pixels have painted into the mosaic' : 'Synthetic grains have painted into the mosaic' }).toBe(true);
}

async function readyGroups(frame: Frame) {
  // Probe the loaded module code so an older build can still supply screenshots,
  // while a build that supports groups must actually render its sample regions.
  const supportsGroups = await frame.evaluate(async () => {
    const scripts = new Set([...document.scripts].map(script => script.src).filter(Boolean));
    for (const entry of performance.getEntriesByType('resource')) {
      if (new URL(entry.name).pathname.endsWith('.js')) scripts.add(entry.name);
    }
    const sources = await Promise.all([...scripts].map(async src => (await fetch(src)).text()));
    return sources.some(source => source.includes('mount-inset-group'));
  });
  if (supportsGroups) await expect(frame.getByTestId('mount-inset-group').first()).toBeVisible();
  else console.info('review-groups: GrainAtlas build predates mount inset groups; skipping the sample-region wait.');
}

for (const theme of ['light', 'dark'] as const) for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test.describe(`${theme} ${width}x${height}`, () => {
    test.use({ viewport: { width, height }, colorScheme: theme, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' });
    for (const screen of screens) test(`${screen}`, async ({ page, context }) => {
      test.skip(screen === 'sessions' && !existsSync(resolve(upbdbDist, 'index.html')),
        'Sessions screenshot skipped: build the read-only ../upbdb/ui/dist UI first.');
      test.skip((screen === 'images' || screen === 'review-images' || screen === 'review-groups' || screen === 'review-region') && !existsSync(atlasEntry),
        'Atlas screenshot skipped: fetch/build ui/public/modules/grainatlas first.');
      test.setTimeout(60_000);
      const demo = await serveDemo(context);
      await page.clock.setFixedTime(new Date('2026-11-15T12:00:00Z'));
      await page.addInitScript(installFakeTauri, {
        store: { mode: 'server', serverUrl: server, lastTab: screen.startsWith('review-') || screen === 'images' ? 'review' : screen === 'settings' || screen === 'reduce' ? 'home' : screen,
          theme, themeChosen: true, updateAuto: false, reviewSplit: false,
          reviewScope: JSON.stringify({ kind: 'session', id: scope.session, run: 'preferred' }),
          reviewInset: { width: (screen === "review-groups" || screen === "review-region") ? 300 : 200, collapsed: false } },
        fixtures: api, signedIn: true, studioFound: true, renderModules: true,
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

/** Many samples collapse the tree: open the focus spot's sample first. */
async function showFocus(page: Page) {
  const spot = page.locator(`[data-spot-key="${scope.focusKey}"]`);
  if (!await spot.isVisible()) {
    const table = api[`/v1/sessions/${scope.session}/results?run=preferred`] as { rows: Record<string, unknown>[] };
    const row = table.rows.find(row => (row.acquisition_id ?? row.spot_id ?? row.atlas_spot_id ?? row.label) === scope.focusKey);
    const sample = row?.sample_name;
    expect(sample, `Sample for fixture spot ${scope.focusKey}`).toBeTruthy();
    await page.getByRole('button', { name: `Expand ${sample}`, exact: true }).click();
  }
  await expect(spot).toBeVisible();
  await spot.scrollIntoViewIfNeeded();
  return spot;
}

async function prepareScreen(page: Page, screen: Screen, demo: Awaited<ReturnType<typeof serveDemo>>, theme: string) {
  if (screen.startsWith('review-')) {
    if (screen === 'review-groups' || screen === 'review-region') {
      await page.getByRole('checkbox', { name: 'Group unregistered by spot name', exact: true }).check();
      await page.getByRole('button', { name: 'All', exact: true }).click();
      const samples = page.getByRole('treeitem', { name: 'Samples', exact: true });
      await samples.locator(':scope > .layer-row > button.name').click();
      await samples.locator(':scope > .layer-row > button.disclosure').click();
      await page.getByRole('checkbox', { name: 'SEM images', exact: true }).check();
      await readyAtlas(page, demo, theme, false);
      // Give the images room and enlarge the mount map, as a user would to read the regions.
      await page.getByRole('button', { name: 'Maximise SEM images', exact: true }).click();
      const frame = await frameFor(page, 'images');
      await readyGroups(frame);
      const enlarge = frame.getByTestId('mount-inset-enlarge');
      if (await enlarge.isEnabled() && await enlarge.getAttribute('aria-label') === 'Larger mount map') await enlarge.click();
      await readyAtlas(page, demo, theme, false);
      if (screen === 'review-region') {
        const supportsRegion = await frame.evaluate(async () => {
          const scripts = new Set([...document.scripts].map(script => script.src).filter(Boolean));
          for (const entry of performance.getEntriesByType('resource')) {
            if (new URL(entry.name).pathname.endsWith('.js')) scripts.add(entry.name);
          }
          const sources = await Promise.all([...scripts].map(async src => (await fetch(src)).text()));
          return sources.some(source => source.includes('lab.viewer.region'));
        });
        if (supportsRegion) {
          await frame.getByTestId('mount-inset-group').first().click();
        } else {
          console.info('review-region: GrainAtlas build predates lab.viewer.region; emitting a sample-region event.');
          const result = api[`/v1/sessions/${scope.session}/results?run=preferred`] as { rows: Record<string, unknown>[] };
          const first = result.rows.find(row => row.sample_name && row.kind === 'sample') ?? result.rows[0];
          const mounts = api['/v1/mounts'] as { id: string; label: string }[];
          const event = { type: 'lab.viewer.region', kind: 'sample', project: scope.project,
            mount: first.mount_id ?? mounts[0]?.id ?? null, mountLabel: mounts.find(mount => mount.id === first.mount_id)?.label ?? mounts[0]?.label ?? '',
            area: 'screenshot-area', areaLabel: 'Sample region', sample: String(first.sample_name ?? 'Sample'),
            spots: result.rows.filter(row => row.sample_name === first.sample_name).flatMap(row => typeof row.atlas_spot_id === 'string' ? [row.atlas_spot_id] : []) };
          await page.evaluate(event => (window as unknown as { __emit(name: string, payload: unknown): Promise<void> })
            .__emit('lab-bridge://notify', { event, source: 'images' }), event);
        }
        await page.getByRole('button', { name: 'Restore SEM images', exact: true }).click();
        const expand = page.getByRole('button', { name: 'Expand Spot metadata', exact: true });
        if (await expand.isVisible()) await expand.click();
        await expect(page.getByTestId('region-summary')).toBeVisible();
        await expect(page.getByTestId('region-summary').getByText('Loading…', { exact: true })).toHaveCount(0);
      }
    } else {
      await (await showFocus(page)).click();
    }
    if (screen === 'review-concordia') {
      // Two discordant outliers stretch the axes; frame the main cluster as a user would.
      await page.getByRole('button', { name: 'Fit cluster', exact: true }).click();
    }
    if (screen === 'review-geochemistry') {
      await page.getByRole('radio', { name: 'Geochemistry', exact: true }).click();
      await page.getByTestId('geochem-panel').first().getByRole('button', { name: 'Choose Y axis', exact: true }).click();
      await page.getByRole('group', { name: 'Choose Y quantity' }).getByRole('button', { name: 'REE pattern', exact: true }).click();
      await expect(page.getByText('CI chondrite, McDonough and Sun (1995)')).toBeVisible();
    } else if (screen === 'review-depth') {
      await page.getByRole('radio', { name: 'Depth profile', exact: true }).click();
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
    if (screen !== 'review-groups' && screen !== 'review-region') await expect(page.getByTestId('review-view').locator('.uplot canvas').first()).toBeVisible();
    if (screen !== 'review-depth' && screen !== 'review-groups' && screen !== 'review-region') await expect(page.getByTestId('review-view').locator(`[data-point-key="${scope.focusKey}"]`).first()).toBeAttached();
    return;
  }
  if (screen === 'images') {
    // The current shell hosts GrainAtlas in Review rather than an Images tab.
    // Its real maximise control gives the documentation an images-focused view.
    await (await showFocus(page)).click();
    await page.getByRole('checkbox', { name: 'SEM images', exact: true }).check();
    await page.getByRole('button', { name: 'Maximise SEM images', exact: true }).click();
    await readyAtlas(page, demo, theme);
    if (!capture) {
      const frame = await frameFor(page, 'images');
      await frame.getByTestId('viewer-controls').getByRole('button', { name: 'Fit', exact: true }).click();
      await readyAtlas(page, demo, theme);
    }
  } else if (screen === 'sessions') {
    const frame = await frameFor(page, 'sessions');
    await expect(frame.getByLabel('Session dashboard')).toBeVisible();
    await expect(frame.getByTestId('session-card')).toHaveCount(scope.sessions);
    await expect(frame.getByRole('application', { name: /^Sessions and spots over time/ })).toBeVisible();
    await expect(frame.locator('html')).toHaveAttribute('data-theme', theme);
    const account = api['/v1/accounts/me'] as { display_name: string };
    await expect(frame.getByRole('link', { name: account.display_name })).toBeVisible();
  } else if (screen === 'settings') {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Lab server', exact: true })).toHaveAttribute('aria-checked', 'true');
  } else if (screen === 'reduce') {
    // Opened from Home, as a user does: Reduce loads its list when its tab is shown.
    await expect(page.getByTestId('session-card')).toHaveCount(scope.sessions);
    await page.getByRole('tab', { name: 'Reduce', exact: true }).click();
    await expect(page.getByTestId('reduce-sessions').locator('article')).toHaveCount(scope.sessions);
    await expect(page.getByText('UPbRPy Studio is not installed')).toHaveCount(0);
  } else {
    await expect(page.getByTestId('session-card')).toHaveCount(scope.sessions);
    await expect(page.getByTestId('mount-card')).toHaveCount(scope.mounts);
    await expect(page.getByTestId('mount-card').locator('img').first()).toBeVisible();
    await expect(page.getByText(/loading reductions|checking…/)).toHaveCount(0);
  }
}
