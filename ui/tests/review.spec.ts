import { test, expect, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';
import { problems } from './problems';
import { reviewFixtures, session, runs } from './fixtures/review';
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
async function openReview(page: Page, options: { signedIn?: boolean; store?: Record<string, unknown> } = {}) {
  await page.route('**/modules/manifest.json', r => r.fulfill({ json: { modules: [{ name: 'grainatlas', version: 'demo', source: 'fixture', sha256: 'demo', entry: 'modules/grainatlas/index.html' }] } }));
  await page.addInitScript(installFakeTauri, { store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'review', reviewScope: JSON.stringify({ kind: 'session', id: session.id, run: 'preferred' }), ...options.store }, fixtures: reviewFixtures, signedIn: options.signedIn ?? true });
  await page.goto('./');
  await page.waitForFunction(() => (window as unknown as {
    __fake: {
      listeners: Map<string, unknown>;
    };
  }).__fake.listeners.has('lab-bridge://notify'));
  // Signed out, Review has no stored results to show.
  if (options.signedIn !== false) await expect(page.locator('[data-spot-key]').first()).toBeVisible();
}
for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test.describe(`${width} × ${height}`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width, height }); await openReview(page); });
    test('stored results, plots and image selections stay within the window', async ({ page }) => {
      expect(await problems(page, 'Review')).toEqual([]);
      await expect(page.locator('[data-spot-key]')).toHaveCount(8);
      await page.locator('[data-spot-key="acq-2"]').click();
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
      await page.getByRole('group', {name:'Choose Y quantity'}).getByRole('button', {name:'REE pattern',exact:true}).click();
      await expect(page.getByText('CI chondrite, McDonough and Sun (1995)')).toBeVisible();
      expect(await problems(page, 'REE')).toEqual([]);
      await page.locator('[data-spot-key="acq-1"]').click();
      await page.getByRole('tab', { name: 'Depth profile', exact: true }).click();
      await expect(page.getByLabel('Depth profile axis')).toBeVisible();
      expect(await problems(page, 'Depth profile')).toEqual([]);
      await page.getByRole('button', {name:'Standard Demo reference',exact:true}).click({ modifiers: ['Alt'] });
      await expect(page.locator('[data-spot-key]')).toHaveCount(4);
      await page.getByRole('checkbox', {name:'Show Reference_1 in Review',exact:true}).click();
      await expect(page.getByRole('checkbox', {name:'Show Standards in Review',exact:true})).toHaveAttribute('aria-checked', 'mixed');
      await page.getByRole('checkbox', {name:'Show Standards in Review',exact:true}).click();
      await expect(page.getByRole('checkbox', {name:'Show Reference_1 in Review',exact:true})).toBeChecked();
      await page.getByRole('button', {name:'Choose review scope',exact:true}).click();
      await page.getByRole('listbox', { name: 'Mounts', exact: true }).getByRole('option', { name: /Demo zircon mount/ }).click();
      await expect(page.locator('[data-spot-key]')).toHaveCount(9);
      await page.getByLabel('Filter spots').fill('Zircon_13');
      await page.locator('[data-spot-key="spot-unmeasured"]').click();
      await expect(page.getByTestId('review-details')).toContainText('not measured yet');
      expect(await problems(page, 'Mount Review')).toEqual([]);
    });
    test('split keeps the same Images surface and fits a narrow window', async ({ page }) => {
      const toggle = page.getByRole('checkbox', { name: 'SEM images', exact: true });
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
      const left = (await page.getByRole('region', { name: 'Age & plots' }).boundingBox())!, right = (await surface.boundingBox())!;
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
      await expect(toggle).toBeChecked();
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
      const picker = page.getByRole('group', { name: 'Choose Y quantity' });
      await picker.getByLabel('Filter quantities').fill('U/Yb');
      await picker.getByRole('button', { name: 'U/Yb', exact: true }).click();
      await expect(picker).toHaveCount(0);
      await expect(first.getByRole('button', { name: 'Choose Y axis', exact: true })).toContainText('U/Yb (from stored ppm)');
      await first.getByRole('button', { name: 'Choose X axis', exact: true }).click();
      const search = page.getByRole('group', { name: 'Choose X quantity' }).getByLabel('Filter quantities');
      await search.fill('Hf');
      await search.press('ArrowDown');
      await expect(page.getByRole('group', { name: 'Choose X quantity' }).getByRole('button', { name: 'Hf', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(first.getByRole('button', { name: 'Choose X axis', exact: true })).toContainText('Hf (ppm)');
      await page.reload();
      await expect(page.locator('[data-spot-key]').first()).toBeVisible();
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
      await page.getByRole('button', { name: 'Sample Sample B', exact: true }).click();
      await expect(plots.first()).toHaveAttribute('data-point-count', '4');
      await expect(page.locator('[data-spot-key]')).toHaveCount(4);
      await expect(page.locator('[data-point-key][data-sample="Sample B"]')).toHaveCount(0);
      const before = (await calls(page)).filter(([c]) => c === 'module_command').length;

      await plots.first().locator('[data-point-key="acq-1"]').hover();
      await expect(plots.nth(1).locator('[data-point-key="acq-1"]')).toHaveAttribute('data-hovered', 'true');
      await expect(page.locator('[data-spot-key="acq-1"]')).toHaveClass(/hovered/);
      expect((await calls(page)).filter(([c]) => c === 'module_command')).toHaveLength(before);
      await page.getByRole('button', { name: 'Sample Sample B', exact: true }).click({ modifiers: ['ControlOrMeta'] });
      await expect(plots.first()).toHaveAttribute('data-point-count', '8');
      await page.getByRole('button', { name: 'None', exact: true }).click();
      await expect(plots.first()).toHaveAttribute('data-point-count', '0');
      await expect(page.locator('[data-spot-key]')).toHaveCount(0);
      await expect(page.getByTestId('geochem-board')).toContainText('No samples shown');
      await page.getByRole('button', { name: 'All', exact: true }).click();
      await expect(plots.first()).toHaveAttribute('data-point-count', '12');
      await page.getByRole('button', { name: 'Sample Sample B', exact: true }).click({ modifiers: ['Alt'] });
      await emit(page, 'atlas-1');
      await expect(page.getByRole('treeitem', { name: 'Zircon_1', exact: true })).toHaveAttribute('aria-selected', 'true');
    });
    test('panels can re-tile and return to the default without losing the selected spot', async ({ page }) => {
      const spots = page.getByRole('region', { name: 'Spots', exact: true });
      const metadata = page.getByRole('region', { name: 'Spot metadata', exact: true });
      const plots = page.getByRole('region', { name: 'Age & plots', exact: true });
      const original = (await spots.boundingBox())!;
      await page.getByRole('button', { name: 'Move Spot metadata', exact: true }).click();
      await page.getByRole('button', { name: 'Dock right of Age & plots', exact: true }).click();
      await expect.poll(async () => (await metadata.boundingBox())!.x).toBeGreaterThan((await plots.boundingBox())!.x);
      await page.getByRole('button', { name: 'Reset layout', exact: true }).click();
      await expect.poll(async () => (await metadata.boundingBox())!.x).toBe(original.x);
      await expect.poll(async () => (await metadata.boundingBox())!.y).toBeGreaterThan(original.y);
      await expect(page.getByTestId('review-details').getByRole('heading', { name: 'Zircon_1', exact: true })).toBeVisible();
    });
  });
}

test('sample toggles combine tree, concordia and image overlays; Alt solos by mouse and keyboard', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1512, height: 982 });
  await openReview(page);
  const a = page.getByRole('button', { name: 'Sample Sample A', exact: true });
  const b = page.getByRole('button', { name: 'Sample Sample B', exact: true });
  const standard = page.getByRole('button', { name: 'Standard Demo reference', exact: true });
  const all = page.getByRole('button', { name: 'All', exact: true });
  const none = page.getByRole('button', { name: 'None', exact: true });
  await expect(a).toHaveAttribute('aria-pressed', 'true');
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await expect(standard).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'All standards', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(all).toHaveAttribute('aria-pressed', 'false');
  await none.click();
  await expect(none).toHaveAttribute('aria-pressed', 'true');
  await expect(a).toHaveAttribute('aria-pressed', 'false');
  await expect(b).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-spot-key]')).toHaveCount(0);

  // All group and sample toggles are ordinary Tab stops; the only buttons are skipped.
  // macOS WebKit moves focus to buttons with Option-Tab (Safari's default), so use that there.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await none.focus();
  await page.keyboard.press(tab);
  await expect(page.getByRole('button', { name: 'All samples', exact: true })).toBeFocused();
  await page.keyboard.press(tab);
  await expect(a).toBeFocused();
  await page.keyboard.press(tab);
  await expect(b).toBeFocused();
  await page.keyboard.press(tab);
  await expect(page.getByRole('button', { name: 'All standards', exact: true })).toBeFocused();
  await page.keyboard.press(tab);
  await expect(standard).toBeFocused();
  await a.click();
  await expect(page.getByRole('button', { name: 'All samples', exact: true })).toHaveAttribute('aria-pressed', 'mixed');
  await b.click();
  await expect(a).toHaveAttribute('aria-pressed', 'true');
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await expect(none).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'All samples', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('review-details').getByRole('heading', { name: 'Zircon_1', exact: true })).toBeVisible();

  const plot = page.getByTestId('review-plot');
  const expectSamples = async (names: string[], ids: number[]) => {
    await expect(page.locator('[data-spot-key]')).toHaveCount(ids.length);
    for (const id of ids) await expect(page.locator(`[data-spot-key="acq-${id}"]`)).toBeVisible();
    for (const name of ['Sample A', 'Sample B', 'Demo reference'])
      await expect(plot.locator(`[data-point-key][data-sample="${name}"]`)).toHaveCount(names.includes(name) ? 4 : 0);
    await expect(page.getByLabel('Sample legend').locator('span')).toHaveText(names);
  };
  await expectSamples(['Sample A', 'Sample B'], [1, 2, 3, 4, 5, 6, 7, 8]);
  await page.getByRole('checkbox', { name: 'SEM images', exact: true }).check();
  const lastReviewCommand = async () => (await calls(page)).filter(([c, args]) =>
    c === 'module_command' && (args?.command as { type?: string })?.type === 'review-spots').pop()?.[1]?.command;
  const expectImages = async (ids: number[], colorCount: number) => {
    const spots = ids.map(id => `atlas-${id}`);
    await expect.poll(async () => {
      const command = await lastReviewCommand() as { projects: Record<string, string[]>; colors: Record<string, Record<string, string>> } | undefined;
      const colors = command?.colors?.['project-demo'] ?? {};
      return {
        spots: command?.projects['project-demo'], colored: Object.keys(colors),
        distinct: new Set(Object.values(colors)).size,
        valid: Object.values(colors).every(color => /^#[0-9a-f]{6}$/i.test(color)),
      };
    }).toEqual({ spots, colored: spots, distinct: colorCount, valid: true });
  };
  await expectImages([1, 2, 3, 4, 5, 6, 7, 8], 2);
  expect(await problems(page, 'Combined samples')).toEqual([]);
  await a.click({ modifiers: ['Alt'] });
  await expect(a).toHaveAttribute('aria-pressed', 'true');
  await expect(b).toHaveAttribute('aria-pressed', 'false');
  await expectSamples(['Sample A'], [1, 2, 3, 4]);
  await expectImages([1, 2, 3, 4], 1);
  await b.focus();
  await b.press('Alt+Enter');
  await expect(a).toHaveAttribute('aria-pressed', 'false');
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await expectSamples(['Sample B'], [5, 6, 7, 8]);
  await expectImages([5, 6, 7, 8], 1);
  await expect(page.getByTestId('review-details').getByRole('heading', { name: 'Zircon_5', exact: true })).toBeVisible();
  await a.focus();
  await a.press('Alt+Space');
  await expectSamples(['Sample A'], [1, 2, 3, 4]);
  await expectImages([1, 2, 3, 4], 1);
});

test('group toggles, ranges and Escape preserve display filters by scope and grouping mode', async ({ page }) => {
  await openReview(page);
  const a = page.getByRole('button', { name: 'Sample Sample A', exact: true });
  const b = page.getByRole('button', { name: 'Sample Sample B', exact: true });
  const samples = page.getByRole('button', { name: 'All samples', exact: true });
  const standards = page.getByRole('button', { name: 'All standards', exact: true });
  const spots = page.locator('[data-spot-key]');
  await samples.click();
  await expect(spots).toHaveCount(0);
  await samples.click();
  await expect(spots).toHaveCount(8);
  await standards.click();
  await expect(spots).toHaveCount(12);
  await standards.click();
  await a.click();
  await b.click({ modifiers: ['Shift'] });
  await expect(spots).toHaveCount(0);
  await b.click({ modifiers: ['Shift'] });
  await expect(spots).toHaveCount(8);
  await page.getByRole('tree', { name: 'Result spots', exact: true }).press('Escape');
  await expect(spots).toHaveCount(8);
  await page.getByRole('tree', { name: 'Result spots', exact: true }).press('ControlOrMeta+a');
  await expect(spots).toHaveCount(12);
  await page.getByRole('button', { name: 'None', exact: true }).click();
  await page.getByRole('tree', { name: 'Result spots', exact: true }).press('Escape');
  await expect(spots).toHaveCount(0);

  const grouping = page.getByRole('checkbox', { name: 'Group unregistered by spot name', exact: true });
  await grouping.uncheck();
  await expect(spots).toHaveCount(8);
  await b.click();
  await grouping.check();
  await expect(spots).toHaveCount(0);
  await grouping.uncheck();
  await expect(spots).toHaveCount(4);
  await a.hover();
  await page.getByRole('button', { name: 'Show only Sample A', exact: true }).click();
  await expect(a).toHaveAttribute('aria-pressed', 'true');
  await expect(b).toHaveAttribute('aria-pressed', 'false');
  const choose = async (scope: string) => {
    await page.getByRole('button', { name: 'Choose review scope', exact: true }).click();
    await page.getByRole('listbox', { name: scope.startsWith('mount:') ? 'Mounts' : 'Sessions', exact: true })
      .getByRole('option', { name: scope.startsWith('mount:') ? /Demo zircon mount/ : /Zircon_demo_06Nov26/ }).click();
  };
  await choose('mount:mount-demo');
  await expect(spots).toHaveCount(9);
  await choose(`session:${session.id}`);
  await expect(spots).toHaveCount(4);
  await expect(a).toHaveAttribute('aria-pressed', 'true');
  await expect(b).toHaveAttribute('aria-pressed', 'false');
});

test('Review has no sideways overflow at the minimum window or in compact split mode', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await openReview(page);
  for (const tab of ['Concordia', 'Geochemistry', 'Depth profile']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    expect(await problems(page, `Minimum ${tab}`)).toEqual([]);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('checkbox', { name: 'SEM images', exact: true }).check();
  await expect(page.getByRole('region', { name: 'SEM images' })).toBeVisible();
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

for (const [width, height] of [[1512, 982], [1024, 640]]) {
  test(`Review drawers stay above SEM images and support keyboard scope and run selection at ${width} × ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openReview(page);
    await page.getByRole('checkbox', { name: 'SEM images', exact: true }).check();
    const field = page.getByRole('button', { name: 'Choose review scope', exact: true });
    const run = page.getByRole('button', { name: 'Review run', exact: true });
    const drawer = page.getByTestId('review-picker-drawer');
    const search = page.getByRole('searchbox', { name: 'Search scopes', exact: true });
    await field.click();
    await expect(field).toHaveAttribute('aria-expanded', 'true');
    await expect(search).toBeFocused();
    if (width === 1512) {
      const surface = page.locator('[data-module="images"]');
      await expect(surface).toBeVisible();
      await expect.poll(async () => {
        const d = (await drawer.boundingBox())!, image = (await surface.boundingBox())!;
        return d.y + d.height <= image.y;
      }).toBe(true);
      // The native child must receive the new rectangle, not just the DOM placeholder.
      await expect.poll(async () => (await calls(page)).filter(([c, args]) => c === 'module_bounds' && args?.module === 'images').pop()?.[1]?.bounds)
        .toMatchObject({ y: Math.round((await surface.boundingBox())!.y) });
    }
    await expect.poll(() => problems(page, 'Open scope drawer')).toEqual([]);
    await search.fill('Demo zircon mount');
    await search.press('ArrowDown');
    await expect(page.getByRole('listbox', { name: 'Mounts', exact: true }).getByRole('option')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(field).toContainText('Demo zircon mount');
    await expect(run).toHaveCount(0);
    await expect(drawer).toHaveCount(0);
    await field.click();
    await expect(search).toBeFocused();
    await search.fill('Zircon_demo_06Nov26');
    await search.press('ArrowDown');
    await expect(page.getByRole('listbox', { name: 'Sessions', exact: true }).getByRole('option')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(field).toContainText('Zircon_demo_06Nov26');
    await expect(run).toContainText('run-pref');
    await run.click();
    await expect(page.getByRole('listbox', { name: 'Runs', exact: true }).getByRole('option', { name: /^Preferred run/ })).toBeFocused();
    await expect(drawer.getByText('made before spot names were re-parsed').first()).toBeVisible();
    // The dock and native bounds follow the drawer one frame later.
    await expect.poll(() => problems(page, 'Open run drawer')).toEqual([]);
    await page.getByRole('listbox', { name: 'Runs', exact: true }).locator('[data-run="run-newer"]').click();
    await expect(run).toContainText('run-newe');
    await expect.poll(async () => (await calls(page)).some(([c, args]) => c === 'api_get' && args?.path === `/v1/sessions/${session.id}/results?run=run-newer`)).toBe(true);
    await run.click();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(run).toBeFocused();
    await expect(run).toHaveAttribute('aria-expanded', 'false');
    await field.click();
    await search.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(field).toBeFocused();
    await field.click();
    await field.click();
    await expect(drawer).toHaveCount(0);
    await field.click();
    await page.getByRole('button', { name: 'Reset layout', exact: true }).click();
    await expect(drawer).toHaveCount(0);
    await field.click();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(drawer).toHaveCount(0);
  });
}

test('Review prompts once for an unsaved scope and keeps single-run sessions selectable', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.addInitScript(installFakeTauri, {
    store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'review', reviewScope: '' },
    fixtures: { ...reviewFixtures, [`/v1/sessions/${session.id}/reductions`]: runs.slice(0, 1) },
    signedIn: true,
  });
  await page.goto('./');
  const field = page.getByRole('button', { name: 'Choose review scope', exact: true });
  const drawer = page.getByTestId('review-picker-drawer');
  await expect(field).toContainText('Choose a session or mount');
  await expect(drawer).toBeVisible();
  await expect(page.getByLabel('Search scopes')).toBeFocused();
  expect(await problems(page, 'First scope drawer')).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await field.click();
  await page.getByRole('listbox', { name: 'Sessions', exact: true }).getByRole('option').click();
  const run = page.getByRole('button', { name: 'Review run', exact: true });
  await expect(run).toBeVisible();
  await run.click();
  await expect(page.getByRole('listbox', { name: 'Runs', exact: true }).getByRole('option')).toHaveCount(2);
});

async function contained(popup: ReturnType<Page['locator']>, owner: ReturnType<Page['locator']>) {
  await expect(popup).toBeVisible();
  const p = (await popup.boundingBox())!, b = (await owner.boundingBox())!;
  expect(p.x).toBeGreaterThanOrEqual(b.x - 1);
  expect(p.y).toBeGreaterThanOrEqual(b.y - 1);
  expect(p.x + p.width).toBeLessThanOrEqual(b.x + b.width + 1);
  expect(p.y + p.height).toBeLessThanOrEqual(b.y + b.height + 1);
}

for (const [width, split, dataWidth, side] of [[1440, true, 65, true], [1440, true, 50, false], [1280, false, 50, true]] as const) {
  test(`Depth channels take layout space at ${width}px, split ${split}, data width ${dataWidth}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
    await openReview(page, { store: { reviewDataWidth: dataWidth } });
    if (split) await page.getByRole('checkbox', { name: 'SEM images', exact: true }).check();
    await page.locator('[data-spot-key="acq-1"]').click();
    await page.getByRole('tab', { name: 'Depth profile', exact: true }).click();
    const plots = page.locator('section[aria-label="Age & plots"]');
    const button = page.getByRole('button', { name: /^Channels/ });
    const drawer = page.getByRole('group', { name: 'Depth profile channels' });
    const canvas = plots.locator('canvas').first();
    await expect(canvas).toBeVisible();
    // Make the initial state explicit even if the component was remounted.
    if (await button.getAttribute('aria-expanded') === 'true') await button.click();
    // Wait until the plot has taken its tile size (it starts at uPlot's 400 x 300).
    let closed = (await canvas.boundingBox())!;
    await expect.poll(async () => {
      const before = closed;
      await page.waitForTimeout(150);
      closed = (await canvas.boundingBox())!;
      return before.width === closed.width && before.height === closed.height;
    }).toBe(true);
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(button).toHaveAttribute('aria-controls', 'depth-channel-picker');
    await contained(drawer, plots);
    if (split) {
      const d = (await drawer.boundingBox())!, sem = (await page.locator('section[aria-label="SEM images"]').boundingBox())!;
      expect(d.x + d.width <= sem.x + 1 || d.x >= sem.x + sem.width - 1 || d.y + d.height <= sem.y + 1 || d.y >= sem.y + sem.height - 1).toBe(true);
    }
    await expect.poll(async () => (await canvas.boundingBox())![side ? 'width' : 'height']).toBeLessThan(closed[side ? 'width' : 'height'] - 20);
    const check = drawer.locator('input[type="checkbox"]').first();
    const wasChecked = await check.isChecked();
    await check.click();
    await expect(check).toBeChecked({ checked: !wasChecked });
    await expect(drawer).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const group = drawer.getByRole('checkbox', { name: /^Select all/ }).first();
    await expect(group).toHaveAttribute('aria-checked', 'mixed');
    await group.click();
    await expect(group).toHaveAttribute('aria-checked', 'true');
    await group.click();
    await expect(group).toHaveAttribute('aria-checked', 'false');
    await drawer.getByRole('button', { name: 'Restore defaults', exact: true }).click();
    await page.getByRole('tab', { name: 'Concordia', exact: true }).click();
    await page.getByRole('tab', { name: 'Depth profile', exact: true }).click();
    await expect(drawer).toBeVisible();
    await button.click();
    await expect(drawer).toHaveCount(0);
    await expect(page.getByLabel('Plotted depth channels')).toBeVisible();
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThanOrEqual(closed.width - 1);
    expect(await problems(page, 'Depth drawer')).toEqual([]);
  });
}

test('Review anchored menus stay inside every owning tile beside native SEM images', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReview(page);
  await page.getByRole('checkbox', { name: 'SEM images', exact: true }).check();
  const plots = page.getByRole('region', { name: 'Age & plots', exact: true });
  await page.getByRole('tab', { name: 'Geochemistry', exact: true }).click();
  await page.getByRole('button', { name: 'Presets', exact: true }).click();
  await contained(page.locator('#review-geochem-presets'), plots);
  await page.keyboard.press('Escape');
  for (const [pane, title] of [['spots', 'Spots'], ['plots', 'Age & plots'], ['details', 'Spot metadata'], ['images', 'SEM images']]) {
    await page.getByRole('button', { name: `Move ${title}`, exact: true }).click();
    await contained(page.locator(`#dock-${pane}`), page.getByRole('region', { name: title, exact: true }));
    if (pane === 'images') {
      const menu = (await page.locator('#dock-images').boundingBox())!, surface = (await page.locator('[data-module="images"]').boundingBox())!;
      expect(menu.y + menu.height).toBeLessThanOrEqual(surface.y + 1);
    }
    await page.keyboard.press('Escape');
  }
  expect(await problems(page, 'Contained dock menus')).toEqual([]);
});

test('Quantity drawer spans the board, pushes plots down, and returns focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReview(page);
  await page.getByRole('checkbox', { name: 'SEM images', exact: true }).check();
  await page.getByRole('tab', { name: 'Geochemistry', exact: true }).click();
  const panel = page.getByTestId('geochem-panel').first();
  const button = panel.getByRole('button', { name: 'Choose Y axis', exact: true });
  const before = (await panel.boundingBox())!;
  await button.click();
  const drawer = page.getByRole('group', { name: 'Choose Y quantity' });
  await expect(drawer.getByLabel('Filter quantities')).toBeFocused();
  await expect(drawer).toContainText('Y axis for panel 1');
  await contained(drawer, page.getByRole('region', { name: 'Age & plots', exact: true }));
  const d = (await drawer.boundingBox())!, board = (await page.getByTestId('geochem-board').boundingBox())!;
  expect(Math.abs(d.width - board.width)).toBeLessThan(1);
  expect((await panel.boundingBox())!.y).toBeGreaterThan(before.y + 20);
  expect(d.y + d.height).toBeLessThanOrEqual(board.y + 1);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(button).toBeFocused();
  await button.click();
  await panel.getByRole('button', { name: 'Choose X axis', exact: true }).click();
  await expect(page.getByRole('group', { name: /^Choose [XY] quantity$/ })).toHaveCount(1);
  const x = page.getByRole('group', { name: 'Choose X quantity' });
  await x.getByLabel('Filter quantities').fill('Hf');
  await x.getByLabel('Filter quantities').press('ArrowDown');
  await expect(x.getByRole('button', { name: 'Hf', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(x).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Choose X axis', exact: true })).toBeFocused();
});

for (const [tab, module] of [['Images', 'images'], ['Sessions', 'sessions']] as const) {
  test(`Sign-in hides and restores the visible ${tab} surface without changing its box`, async ({ page }) => {
    await openReview(page, { signedIn: false });
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const surface = page.locator(`[data-module="${module}"]`);
    await expect(surface).toBeVisible();
    await expect.poll(async () => (await calls(page)).some(([c, a]) => c === 'module_open' && a?.module === module)).toBe(true);
    const box = await surface.boundingBox();
    const start = (await calls(page)).length;
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Sign in to laicpmsdb' });
    await expect(dialog).toBeVisible();
    await expect.poll(async () => (await calls(page)).slice(start).some(([c, a]) => c === 'module_hide' && a?.module === module)).toBe(true);
    await expect(surface.getByRole('status')).toHaveText('Hidden while a dialog is open');
    expect(await surface.boundingBox()).toEqual(box);
    const closed = (await calls(page)).length;
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(surface.getByRole('status')).toHaveCount(0);
    await expect.poll(async () => (await calls(page)).slice(closed).some(([c, a]) => c === 'module_open' && a?.module === module && a.navigate === false)).toBe(true);
    expect(await surface.boundingBox()).toEqual(box);
  });
}
