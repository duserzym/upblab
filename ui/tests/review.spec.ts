import { test, expect, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';
import { problems } from './problems';
import { reviewFixtures, session } from './fixtures/review';
type Call = [
  string,
  Record<string, unknown> | undefined
];
const calls = (page: Page) => page.evaluate(() => (window as unknown as {
  __fake: {
    calls: Call[];
  };
}).__fake.calls);
const emit = (page: Page, spot: string, via = 'user') => page.evaluate(({ spot, via }) => (window as unknown as {
  __emit: (e: string, p: unknown) => void;
}).__emit('lab-bridge://notify', { event: { type: 'lab.spot.selected', project: 'project-demo', spot, via }, source: 'grainatlas' }), { spot, via });
async function openReview(page: Page) {
  await page.route('**/modules/manifest.json', r => r.fulfill({ json: { modules: [{ name: 'grainatlas', version: 'demo', source: 'fixture', sha256: 'demo', entry: 'modules/grainatlas/index.html' }] } }));
  await page.addInitScript(installFakeTauri, { store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'review', reviewScope: JSON.stringify({ kind: 'session', id: session.id, run: 'preferred' }) }, fixtures: reviewFixtures, signedIn: true });
  await page.goto('./');
  await page.waitForFunction(() => (window as unknown as {
    __fake: {
      listeners: Map<string, unknown>;
    };
  }).__fake.listeners.has('lab-bridge://notify'));
  await expect(page.getByRole('treeitem').first()).toBeVisible();
}
for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test.describe(`${width} × ${height}`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width, height }); await openReview(page); });
    test('stored results, plots and image selections stay within the window', async ({ page }) => {
      expect(await problems(page, 'Review')).toEqual([]);
      await expect(page.getByRole('treeitem')).toHaveCount(8);
      await page.getByRole('treeitem', { name: /Zircon_2/ }).click();
      await expect.poll(async () => (await calls(page)).filter(([c]) => c === 'module_command').pop()?.[1]).toMatchObject({ module: 'images', command: { type: 'focus-spot', project: 'project-demo', spot: 'atlas-2', server: 'http://localhost:8000', via: 'review' } });
      await expect(page.getByRole('tab', { name: 'Review', exact: true })).toHaveAttribute('aria-selected', 'true');
      await page.getByLabel('Filter spots').fill('Zircon_2');
      await page.getByRole('tab', { name: 'Images', exact: true }).click();
      await emit(page, 'atlas-3');
      await page.getByRole('tab', { name: 'Review', exact: true }).click();
      await expect(page.getByRole('treeitem', { name: /Zircon_3/ })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('review-details').getByRole('heading', { name: 'Zircon_3', exact: true })).toBeVisible();
      const before = (await calls(page)).filter(([c]) => c === 'module_command').length;
      await emit(page, 'atlas-4', 'shell');
      await expect(page.getByRole('treeitem', { name: /Zircon_3/ })).toHaveAttribute('aria-selected', 'true');
      expect((await calls(page)).filter(([c]) => c === 'module_command')).toHaveLength(before);
      await page.getByRole('tab', { name: 'Geochemistry', exact: true }).click();
      expect(await problems(page, 'Geochemistry')).toEqual([]);
      await page.getByLabel('REE pattern').check();
      await expect(page.getByText('CI chondrite, McDonough and Sun (1995)')).toBeVisible();
      expect(await problems(page, 'REE')).toEqual([]);
      await page.getByRole('treeitem', { name: /Zircon_1/ }).click();
      await page.getByRole('tab', { name: 'Depth profile', exact: true }).click();
      await expect(page.getByLabel('Depth profile axis')).toBeVisible();
      expect(await problems(page, 'Depth profile')).toEqual([]);
      await page.getByLabel('Reference materials').check();
      await expect(page.getByRole('treeitem')).toHaveCount(12);
      await page.getByLabel('Review scope').selectOption('mount:mount-demo');
      await expect(page.getByRole('treeitem')).toHaveCount(13);
      await page.getByRole('treeitem', { name: /Zircon_13/ }).click();
      await expect(page.getByTestId('review-details')).toContainText('not measured yet');
      expect(await problems(page, 'Mount Review')).toEqual([]);
    });
    test('split uses the existing Images surface and follows the width threshold', async ({ page }) => {
      const toggle = page.getByLabel('Side by side');
      if (width < 1440) {
        await expect(toggle).toHaveCount(0);
        return;
      }
      await page.getByRole('tab', { name: 'Images', exact: true }).click();
      const surface = page.locator('[data-module="images"]');
      await expect(surface).toBeVisible();
      const instance = await surface.evaluate(el => { el.setAttribute('data-instance', 'original'); return true; });
      expect(instance).toBe(true);
      await page.getByRole('tab', { name: 'Review', exact: true }).click();
      await toggle.check();
      await expect(page.getByTestId('review-view')).toBeVisible();
      await expect(surface).toBeVisible();
      await expect(surface).toHaveAttribute('data-instance', 'original');
      const left = (await page.getByTestId('review-view').boundingBox())!, right = (await surface.boundingBox())!;
      expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1);
      expect(right.x + right.width).toBeLessThanOrEqual(width);
      expect(right.y + right.height).toBeLessThanOrEqual(height);
      expect(await problems(page, 'Split Review')).toEqual([]);
      await page.getByRole('button', { name: 'Show in Images', exact: true }).click();
      await expect(page.getByRole('tab', { name: 'Review', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(surface).toBeVisible();
      for (const tab of ['Geochemistry', 'Depth profile']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        expect(await problems(page, `Split ${tab}`)).toEqual([]);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(toggle).toHaveCount(0);
      await expect(surface).toBeHidden();
      expect(await problems(page, 'Review after narrowing')).toEqual([]);
    });
  });
}
