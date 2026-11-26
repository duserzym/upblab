import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from 'node:process';
import { installFakeTauri } from './fake-tauri';
import { fixtures, batch, lab, solutions } from './fixtures/tims';
import type { BatchOut } from '../src/lib/tims-api';
import { demoHomeFixtures, demoSessions, demoMount } from './fixtures/home';
import { session } from './fixtures/review';
import { routeTimsAtlas } from './tims-atlas-helpers';

// Intentionally use only selectors/helpers present at 32e5600: the supervisor
// also copies this file into that baseline to capture matching before pictures.
const directory = env.STYLE_SHOTS_DIR;
test.use({ viewport: { width: 1440, height: 900 } });
test.skip(!directory, 'Opt in with STYLE_SHOTS_DIR=/path/to/pictures');

async function start(page: Page, tab: 'tims' | 'review' | 'home', theme: 'light' | 'dark', extraFixtures: Record<string, unknown> = {}) {
  // Like theme.spec.ts: a fresh System preference follows the emulated OS.
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.route('http://localhost:8000/**', route => route.fulfill({ json: {} }));
  await routeTimsAtlas(page);
  await page.route('**/modules/manifest.json', route => route.fulfill({ json: { modules: [] } }));
  await page.addInitScript(installFakeTauri, { signedIn: true,
    store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: tab,
      reviewScope: JSON.stringify({ kind: 'session', id: session.id, run: 'preferred' }) },
    fixtures: { ...demoHomeFixtures, ...fixtures,
      '/v1/sessions': demoSessions, '/v1/mounts': [demoMount],
      [`/v1/tims/column-protocols?limit=2&lab=${lab}`]: [], ...extraFixtures } });
  await page.goto('./');
  await page.waitForFunction(() => (window as unknown as {
    __fake: { listeners: Map<string, unknown> };
  }).__fake.listeners.has('lab-bridge://notify'));
  await expect(page.getByRole('tab', { name: tab === 'tims' ? 'TIMS' : tab === 'review' ? 'Review' : 'Home', exact: true }))
    .toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function capture(page: Page, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode().catch(() => undefined)));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await mkdir(directory!, { recursive: true });
  await page.screenshot({ path: resolve(directory!, name), animations: 'disabled' });
}

for (const theme of ['light', 'dark'] as const) {
  test(`TIMS batch list ${theme}`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Style pictures use Chromium only');
    // Small, invented list summaries only; existing captures retain their fixtures.
    const batches: BatchOut[] = ['Krogh', 'Fable', 'Story', 'Myth'].map((name, index) => ({
      ...batch, id: `style-batch-${index}`, capsule_set_id: `style-set-${index}`,
      capsule_set_name: name, capsule_set_code: `X${index + 1}`,
      started_on: `2026-11-0${6 - index}`,
      completed_at: index === 1 ? '2026-11-06T12:00:00Z' : null,
      counts: { positions: 15, capsules: 12, grain: 12, spike: [8, 12, 4, 12][index], ready: index === 1 || index === 3 ? 12 : 0 },
      samples: [{ id: `style-sample-${index}`, name: `Invented sample ${index + 1}` }],
      operator_name: 'Invented analyst', recipe_name: 'Invented zircon recipe',
    }));
    await start(page, 'tims', theme, {
      [`/v1/tims/batches?limit=200&lab=${lab}&order=-started_on`]: batches,
    });
    await expect(page.getByRole('radio', { name: 'Rows', exact: true })).toHaveAttribute('aria-checked', 'true');
    const list = page.getByRole('region', { name: 'Batch list', exact: true });
    await expect(list.getByTestId('tims-batch-row')).toHaveCount(4);
    await expect(list.getByText('8 of 12 spiked', { exact: true })).toBeVisible();
    await expect(list.getByText('Complete', { exact: true })).toBeVisible();
    await capture(page, `tims-batch-list-${theme}.png`);
  });

  test(`TIMS capsule ${theme}`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Style pictures use Chromium only');
    await start(page, 'tims', theme);
    await page.getByRole('region', { name: 'Batch list', exact: true })
      .getByRole('button', { name: 'Krogh · 2026-11-06', exact: true }).click();
    await expect(page.getByTestId('tims-capsule')).toHaveCount(15);
    await page.getByTestId('tims-capsule').first().click();
    const inspector = page.getByRole('region', { name: 'Capsule details', exact: true });
    await expect(inspector).toContainText('Invented grain one');
    await expect(inspector.getByTestId('tims-grain-image')).toHaveAttribute('data-image-state', 'ready');
    await capture(page, `tims-batch-capsule-${theme}.png`);
  });

  test(`Review concordia ${theme}`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Style pictures use Chromium only');
    await start(page, 'review', theme);
    await expect(page.locator('[data-spot-key]')).toHaveCount(8);
    const plot = page.getByTestId('review-plot');
    await expect(plot.locator('.uplot canvas').first()).toBeVisible();
    await expect(plot).toHaveAttribute('data-point-count', /^[1-9]\d*$/);
    // Match the existing concordia specs: allow the 100 ms ResizeObserver
    // debounce to finish after the real canvas and point targets have arrived.
    await page.waitForTimeout(250);
    await capture(page, `review-plot-${theme}.png`);
  });
}

test('TIMS spikes light', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Style pictures use Chromium only');
  await start(page, 'tims', 'light');
  await page.getByRole('navigation', { name: 'TIMS sections', exact: true }).getByRole('button', { name: 'Spikes', exact: true }).click();
  await expect(page.getByRole('button', { name: solutions[0].name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: solutions[0].name, exact: true }).click();
  await expect(page.getByRole('heading', { name: solutions[0].name, exact: true })).toBeVisible();
  await capture(page, 'tims-spikes-light.png');
});

test('Home light', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Style pictures use Chromium only');
  await start(page, 'home', 'light');
  await expect(page.getByTestId('session-card')).toHaveCount(demoSessions.length);
  await expect(page.getByTestId('mount-card')).toHaveCount(1);
  await expect(page.getByText(/loading reductions|checking…/)).toHaveCount(0);
  await capture(page, 'home-light.png');
});

test('Settings light', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Style pictures use Chromium only');
  await start(page, 'home', 'light');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'System', exact: true })).toBeChecked();
  await capture(page, 'settings-light.png');
});
