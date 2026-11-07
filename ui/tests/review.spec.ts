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
      await page.getByTestId('geochem-panel').first().getByRole('button', {name:'Choose Y axis', exact:true}).click();
      await page.getByRole('dialog', {name:'Choose Y quantity'}).getByRole('button', {name:'REE pattern',exact:true}).click();
      await expect(page.getByText('CI chondrite, McDonough and Sun (1995)')).toBeVisible();
      expect(await problems(page, 'REE')).toEqual([]);
      await page.getByRole('treeitem', { name: /Zircon_1/ }).click();
      await page.getByRole('tab', { name: 'Depth profile', exact: true }).click();
      await expect(page.getByLabel('Depth profile axis')).toBeVisible();
      expect(await problems(page, 'Depth profile')).toEqual([]);
      await page.getByRole('button', {name:'Reference materials',exact:true}).click();
      await expect(page.getByRole('treeitem')).toHaveCount(12);
      await page.getByRole('button', {name:'Choose review scope',exact:true}).click();
      await page.getByLabel('Review scope', { exact: true }).selectOption('mount:mount-demo');
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

for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test.describe(`Geochemistry board ${width} × ${height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openReview(page);
      await page.getByRole('tab', { name: 'Geochemistry', exact: true }).click();
    });
    test('defaults follow the board width, with two rows and stored-only thermometry', async ({ page }) => {
      const board = page.getByTestId('geochem-board');
      const columns = width === 1440 ? 3 : 2;
      await expect(board).toHaveAttribute('data-columns', String(columns));
      await expect(page.getByTestId('geochem-panel')).toHaveCount(columns * 2);
      const boardWidth = (await board.boundingBox())!.width;
      expect(columns).toBe(boardWidth >= 880 ? 3 : boardWidth >= 460 ? 2 : 1);
      const cards = await page.getByTestId('geochem-panel').all();
      const first = (await cards[0].boundingBox())!;
      for (let i = 1; i < columns; i++) {
        const next = (await cards[i].boundingBox())!;
        expect(Math.abs(next.y - first.y)).toBeLessThan(1);
        expect(next.x).toBeGreaterThan(first.x);
      }
      const nextRow = (await cards[columns].boundingBox())!;
      expect(Math.abs(nextRow.x - first.x)).toBeLessThan(1);
      expect(nextRow.y).toBeGreaterThan(first.y);
      await expect(board).toContainText('Ti-in-zircon T is not stored for this run');
      expect(await problems(page, 'Default board')).toEqual([]);
    });
    test('quantity chips change axes, keyboard picking works, and the board persists', async ({ page }) => {
      let first = page.getByTestId('geochem-panel').first();
      await first.getByRole('button', { name: 'Choose Y axis', exact: true }).click();
      const picker = page.getByRole('dialog', { name: 'Choose Y quantity' });
      await picker.getByLabel('Filter quantities').fill('U/Yb');
      await picker.getByRole('button', { name: 'U/Yb', exact: true }).click();
      await expect(picker).toHaveCount(0);
      await expect(first.getByRole('button', { name: 'Choose Y axis', exact: true })).toContainText('U/Yb (from stored ppm)');
      await first.getByRole('button', { name: 'Choose X axis', exact: true }).click();
      const search = page.getByRole('dialog').getByLabel('Filter quantities');
      await search.fill('Hf');
      await search.press('ArrowDown');
      await expect(page.getByRole('dialog').getByRole('button', { name: 'Hf', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(first.getByRole('button', { name: 'Choose X axis', exact: true })).toContainText('Hf (ppm)');
      await page.reload();
      await expect(page.getByRole('treeitem').first()).toBeVisible();
      await page.getByRole('tab', { name: 'Geochemistry', exact: true }).click();
      first = page.getByTestId('geochem-panel').first();
      await expect(first.getByRole('button', { name: 'Choose Y axis', exact: true })).toContainText('U/Yb (from stored ppm)');
      await expect(first.getByRole('button', { name: 'Choose X axis', exact: true })).toContainText('Hf (ppm)');
    });
    test('presets replace panels, maximize restores by button and Escape, and REE is included', async ({ page }) => {
      await page.getByRole('button', { name: 'Presets', exact: true }).click();
      await page.getByRole('button', { name: 'Apply Zircon preset', exact: true }).click();
      await expect(page.getByTestId('geochem-panel')).toHaveCount(10);
      await expect(page.getByTestId('geochem-panel').filter({ hasText: 'REE pattern' })).toHaveCount(1);
      await expect(page.getByTestId('geochem-panel').filter({ hasText: 'Hf vs Preferred date' })).toHaveCount(1);
      const board = page.getByTestId('geochem-board');
      expect(await board.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
      await page.getByTestId('geochem-panel').first().getByRole('button', { name: 'Maximize panel', exact: true }).click();
      await expect(page.getByTestId('geochem-panel')).toHaveCount(1);
      await expect(page.getByTestId('geochem-panel')).toHaveAttribute('data-maximized', 'true');
      await page.getByRole('button', { name: 'Restore panel', exact: true }).click();
      await expect(page.getByTestId('geochem-panel')).toHaveCount(10);
      await page.getByTestId('geochem-panel').first().getByRole('button', { name: 'Maximize panel', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('geochem-panel')).toHaveCount(10);
      await page.getByRole('button', { name: 'Presets', exact: true }).click();
      await page.getByRole('button', { name: 'Apply Rutile preset', exact: true }).click();
      await expect(board).toHaveAttribute('data-mineral', 'Rutile');
      await expect(board).toContainText('Zr-in-rutile T is not stored for this run');
      expect(await problems(page, 'Preset board')).toEqual([]);
    });
    test('sample chips filter all points and rows; shared hover does not command Images', async ({ page }) => {
      const plots = page.getByTestId('review-plot');
      await expect(plots.first()).toHaveAttribute('data-point-count', '8');
      await page.getByRole('button', { name: 'Sample Sample A', exact: true }).click();
      await expect(plots.first()).toHaveAttribute('data-point-count', '4');
      await expect(page.getByRole('treeitem')).toHaveCount(4);
      await expect(page.locator('[data-point-key][data-sample="Sample B"]')).toHaveCount(0);
      const before = (await calls(page)).filter(([c]) => c === 'module_command').length;

      await plots.first().locator('[data-point-key="acq-1"]').hover();
      await expect(plots.nth(1).locator('[data-point-key="acq-1"]')).toHaveAttribute('data-hovered', 'true');
      await expect(page.locator('[data-spot-key="acq-1"]')).toHaveClass(/hovered/);
      expect((await calls(page)).filter(([c]) => c === 'module_command')).toHaveLength(before);
      await page.getByRole('button', { name: 'Sample Sample B', exact: true }).click({ modifiers: ['ControlOrMeta'] });
      await expect(plots.first()).toHaveAttribute('data-point-count', '8');
      await page.getByRole('button', { name: 'Clear', exact: true }).click();
      await expect(plots.first()).toHaveAttribute('data-point-count', '0');
      await expect(page.getByRole('treeitem')).toHaveCount(0);
      await expect(page.getByTestId('geochem-board')).toContainText('No samples shown');
      await page.getByRole('button', { name: 'All', exact: true }).click();
      await expect(plots.first()).toHaveAttribute('data-point-count', '8');
      await page.getByRole('button', { name: 'Sample Sample B', exact: true }).click();
      await emit(page, 'atlas-1');
      await expect(page.locator('[data-spot-key="acq-1"]')).toHaveAttribute('aria-selected', 'true');
    });
    test('side columns collapse and restore without losing the board', async ({ page }) => {
      await page.getByRole('button', { name: 'Collapse spot list', exact: true }).click();
      await expect(page.getByLabel('Filter spots')).toHaveCount(0);
      await page.getByRole('button', { name: 'Collapse details', exact: true }).click();
      expect(await problems(page, 'Collapsed board')).toEqual([]);
      await page.getByRole('button', { name: 'Expand spot list', exact: true }).click();
      await page.getByRole('button', { name: 'Expand details', exact: true }).click();
      await expect(page.getByLabel('Filter spots')).toBeVisible();
      await expect(page.getByTestId('review-details').getByRole('heading', { name: 'Zircon_1', exact: true })).toBeVisible();
    });
  });
}

test('Review has no sideways overflow at the minimum window or in compact split mode', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await openReview(page);
  for (const tab of ['Concordia', 'Geochemistry', 'Depth profile']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    expect(await problems(page, `Minimum ${tab}`)).toEqual([]);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel('Side by side').check();
  await expect(page.getByTestId('review-view')).toHaveClass(/compact/);
  await page.getByRole('tab', { name: 'Geochemistry', exact: true }).click();
  const board = page.getByTestId('geochem-board');
  const width = (await board.boundingBox())!.width;
  await expect(board).toHaveAttribute('data-columns', String(width >= 880 ? 3 : width >= 460 ? 2 : 1));
  expect(await problems(page, 'Compact board')).toEqual([]);
});

test('hidden Review releases plots and restores its chosen view', async ({ page }) => {
  await openReview(page);
  const diagram = page.getByRole('combobox', { name: 'Concordia diagram' });
  await diagram.selectOption('tw');
  await page.getByRole('tab', { name: 'Images', exact: true }).click();
  await expect(page.getByTestId('review-view').locator('.uplot')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  await expect(diagram).toHaveValue('tw');
  await page.getByRole('tab', { name: 'Geochemistry', exact: true }).click();
  const plots = page.getByTestId('review-view').locator('.uplot');
  await expect.poll(() => plots.count()).toBeGreaterThan(0);
  const count = await plots.count();
  const axis = await page.getByTestId('geochem-panel').first().getByRole('button', { name: 'Choose Y axis', exact: true }).textContent();
  await page.getByRole('tab', { name: 'Images', exact: true }).click();
  await expect(plots).toHaveCount(0);
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Geochemistry', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(plots).toHaveCount(count);
  await expect(page.getByTestId('geochem-panel').first().getByRole('button', { name: 'Choose Y axis', exact: true })).toHaveText(axis!);
});
