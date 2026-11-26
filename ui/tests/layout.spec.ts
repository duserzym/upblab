import { expect, test, type Page } from '@playwright/test';
import { defaultLayout, presetLayout, presets, type Layout } from '../src/lib/review-layout';
import { calls, inside, intersection, openReview } from './review-helpers';
import { problems } from './problems';

const tile = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const saved = (page: Page, key = 'reviewDockSplit') => page.evaluate(key => JSON.parse(String((window as unknown as {
  __fake: { store: Record<string, unknown> };
}).__fake.store[key] || 'null')), key);

for (const [width, height] of [[1512, 982], [1280, 800]]) {
  for (const preset of presets) {
    test(`${width}x${height} ${preset}: depth drawer stays in its tile beside SEM`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openReview(page, { store: { reviewSplit: true } });
      await page.getByRole('radio', { name: preset, exact: true }).click();
      await expect(page.getByRole('radio', { name: preset, exact: true })).toHaveAttribute('aria-checked', 'true');
      await expect.poll(() => saved(page)).toEqual(presetLayout(preset, true));
      await page.locator('[data-spot-key="acq-1"]').click();
      await page.getByRole('radio', { name: 'Depth profile', exact: true }).click();
      await page.getByRole('button', { name: /^Channels \(/ }).click();
      const drawer = page.getByRole('group', { name: 'Depth profile channels', exact: true });
      await expect(drawer).toBeVisible();
      await inside(drawer, tile(page, 'Age & plots'));
      expect(await intersection(drawer, tile(page, 'SEM images'))).toBe(0);
      await expect.poll(() => problems(page, `${preset} depth drawer`)).toEqual([]);
    });
  }

  test(`${width}x${height}: all tile headers maximise and restore; native SEM follows visibility and bounds`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openReview(page, { store: { reviewSplit: true } });
    const surface = page.locator('[data-module="images"]');
    for (const name of ['Spots', 'Age & plots', 'Spot metadata', 'SEM images']) {
      const original = (await tile(page, name).boundingBox())!;
      const before = (await calls(page)).length;
      await page.getByRole('button', { name: `Maximise ${name}`, exact: true }).click();
      const restore = page.getByRole('button', { name: `Restore ${name}`, exact: true });
      await expect(restore).toHaveAttribute('aria-pressed', 'true');
      await expect(restore).toHaveAccessibleName(`Restore ${name}`);
      await expect(page.locator('[data-review-panel]:visible')).toHaveCount(1);
      const max = (await tile(page, name).boundingBox())!;
      expect(max.width).toBe(width);
      expect(max.height).toBeGreaterThanOrEqual(original.height);
      if (name !== 'SEM images') {
        await expect(surface).toBeHidden();
        await expect.poll(async () => (await calls(page)).slice(before).some(([c, a]) => c === 'module_hide' && a?.module === 'images')).toBe(true);
      } else {
        await expect(surface).toBeVisible();
        await expect.poll(async () => {
          const all = await calls(page);
          const box = all.filter(([c, a]) => (c === 'module_bounds' || c === 'module_open') && a?.module === 'images').pop()?.[1]?.bounds;
          const r = (await surface.boundingBox())!;
          return box && JSON.stringify(box) === JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), viewportHeight: height });
        }).toBe(true);
      }
      await restore.click();
      await expect(page.locator('[data-review-panel]:visible')).toHaveCount(4);
      expect(await tile(page, name).boundingBox()).toEqual(original);
      // Double-click the title’s start, before the images mount button.
      await tile(page, name).locator(':scope > header .tile-title').dblclick({ position: { x: 5, y: 8 } });
      await expect(restore).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: `Maximise ${name}`, exact: true })).toBeVisible();
    }
    // Maximise is session state; no layout setting is written by those gestures.
    expect(await page.evaluate(() => (window as unknown as { __fake: { store: Record<string, unknown> } }).__fake.store.reviewDockSplit ?? '')).toBe('');
  });
}

test('Escape closes a drawer or move menu before restoring the maximised tile', async ({ page }) => {
  await openReview(page, { store: { reviewSplit: true } });
  await page.locator('[data-spot-key="acq-1"]').click();
  await page.getByRole('button', { name: 'Maximise Age & plots', exact: true }).click();
  await page.getByRole('radio', { name: 'Depth profile', exact: true }).click();
  await page.getByRole('button', { name: /^Channels \(/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'Depth profile channels', exact: true })).toHaveCount(0);
  const restore = page.getByRole('button', { name: 'Restore Age & plots', exact: true });
  await expect(restore).toBeVisible();
  await page.getByRole('button', { name: 'Move Age & plots', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dock-plots')).toBeHidden();
  await expect(restore).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(restore).toHaveCount(0);
});

test('divider double-click restores the mode default ratio after a keyboard resize', async ({ page }) => {
  await openReview(page, { store: { reviewSplit: true } });
  const divider = page.getByRole('separator', { name: 'Resize panels' }).first();
  await divider.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await saved(page))?.ratio).not.toBe(0.17);
  await divider.dblclick();
  await expect.poll(() => saved(page)).toEqual(defaultLayout(true));
});

const crowded: Layout = { axis: 'x', ratio: 0.25, first: 'details', second: {
  axis: 'x', ratio: 0.3, first: 'spots', second: { axis: 'x', ratio: 0.5, first: 'plots', second: 'images' },
} };
test('1024x640 split collapses metadata to a rail and expands it into a temporary maximise', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await openReview(page, { store: { reviewSplit: true, reviewDockSplit: JSON.stringify(crowded) } });
  await expect(tile(page, 'Spot metadata')).toHaveAttribute('data-collapsed', 'true');
  await expect.poll(() => problems(page, 'Narrow split rail')).toEqual([]);
  await page.getByRole('button', { name: 'Expand Spot metadata', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore Spot metadata', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Expand Spot metadata', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1512, height: 982 });
  await expect(tile(page, 'Spot metadata')).toHaveAttribute('data-collapsed', 'false');
});

test('drag feedback hides native SEM until the pointer is released', async ({ page }) => {
  await openReview(page, { store: { reviewSplit: true } });
  const grip = (await page.getByRole('button', { name: 'Drag Spots', exact: true }).boundingBox())!;
  const plots = (await tile(page, 'Age & plots').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  const before = (await calls(page)).length;
  await page.mouse.move(plots.x + plots.width - 20, plots.y + plots.height / 2, { steps: 8 });
  await expect(page.locator('.drag-ghost')).toContainText('Spots');
  await expect(page.locator('.drop-edge')).toHaveText('Dock right of Age & plots');
  await expect.poll(async () => (await calls(page)).slice(before).some(([c, a]) => c === 'module_hide' && a?.module === 'images')).toBe(true);
  await page.mouse.up();
  await expect(page.locator('.drag-ghost')).toHaveCount(0);
  await expect(page.locator('[data-module="images"]')).toBeVisible();
});

test('plot controls use the More drawer at tile widths and size changes preserve the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReview(page, { store: { reviewSplit: true } });
  const plots = tile(page, 'Age & plots');
  const more = plots.getByRole('button', { name: 'More plot controls', exact: true });
  await expect(more).toBeVisible();
  await expect(plots.getByRole('button', { name: 'Hide selected', exact: true })).toBeHidden();
  await more.click();
  for (const name of ['Hide selected', '2σ ellipses', 'Fit cluster']) {
    await expect(plots.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(plots.getByRole('radio', { name: 'Box select', exact: true })).toBeVisible();
  await expect(plots.getByRole('combobox', { name: 'Concordia zoom axes', exact: true })).toBeVisible();
  await inside(plots.locator('#plot-more-controls'), plots);
  await page.keyboard.press('Escape');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await plots.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const chart = plots.getByTestId('review-plot');
  const viewport = await chart.getAttribute('data-viewport');
  const before = (await chart.locator('.uplot canvas').boundingBox())!;
  await page.getByRole('radio', { name: 'Image focus', exact: true }).click();
  await expect.poll(async () => (await chart.locator('.uplot canvas').boundingBox())!.width).toBeLessThan(before.width);
  await expect(chart).toHaveAttribute('data-viewport', viewport!);
  await page.setViewportSize({ width: 1512, height: 982 });
  await expect.poll(async () => (await chart.locator('.uplot canvas').boundingBox())!.width).toBeGreaterThan(before.width - 50);
  await expect(chart).toHaveAttribute('data-viewport', viewport!);
});

test('presets persist separately for solo and split mode', async ({ page }) => {
  await openReview(page, { store: { reviewSplit: true } });
  await page.getByRole('radio', { name: 'Image focus', exact: true }).click();
  await expect.poll(() => saved(page)).toEqual(presetLayout('Image focus', true));
  await page.getByRole('checkbox', { name: 'SEM images', exact: true }).uncheck();
  await expect(page.getByRole('radio', { name: 'Image focus', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Plots focus', exact: true }).click();
  await expect.poll(() => saved(page, 'reviewDockSolo')).toEqual(presetLayout('Plots focus', false));
  await page.getByRole('checkbox', { name: 'SEM images', exact: true }).check();
  await expect(page.getByRole('radio', { name: 'Image focus', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => saved(page)).toEqual(presetLayout('Image focus', true));
});

test('the compact Layout control expands within the toolbar at 1024x640', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await openReview(page, { store: { reviewSplit: true } });
  const toggle = page.getByRole('button', { name: 'Layout', exact: true });
  await expect(toggle).toBeVisible();
  const original = (await tile(page, 'Age & plots').boundingBox())!;
  await toggle.click();
  const drawer = page.getByRole('group', { name: 'Layout presets', exact: true });
  await expect(drawer).toBeVisible();
  const box = (await drawer.boundingBox())!;
  expect((await tile(page, 'Age & plots').boundingBox())!.y).toBeGreaterThan(original.y);
  expect(box.y + box.height).toBeLessThanOrEqual((await tile(page, 'SEM images').boundingBox())!.y);
  await drawer.getByRole('radio', { name: 'Plots focus', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect.poll(() => saved(page)).toEqual(presetLayout('Plots focus', true));
  await expect.poll(() => problems(page, 'Compact layout toolbar')).toEqual([]);
});

test('a short vertical stack hides SEM when railed and hides it again after Expand and Escape', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  const stack: Layout = { axis: 'y', ratio: 0.25, first: 'details', second: {
    axis: 'y', ratio: 0.3, first: 'spots', second: { axis: 'y', ratio: 0.5, first: 'plots', second: 'images' },
  } };
  await openReview(page, { store: { reviewSplit: true, reviewDockSplit: JSON.stringify(stack) } });
  await expect(tile(page, 'SEM images')).toHaveAttribute('data-collapsed', 'true');
  const surface = page.locator('[data-module="images"]');
  await expect(surface).toBeHidden();
  await page.getByRole('button', { name: 'Expand SEM images', exact: true }).click();
  await expect(surface).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore SEM images', exact: true })).toBeVisible();
  const before = (await calls(page)).length;
  await page.keyboard.press('Escape');
  await expect(surface).toBeHidden();
  await expect.poll(async () => (await calls(page)).slice(before).some(([c, a]) => c === 'module_hide' && a?.module === 'images')).toBe(true);
  // The SEM tile is the only place grainatlas shows inside UPb Lab; it stays railed.
  await expect(tile(page, 'SEM images')).toHaveAttribute('data-collapsed', 'true');
  await expect(page.getByRole('tab', { name: 'Images' })).toHaveCount(0);
});


test('reading an old split preset migrates its display without writing layout settings', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const old = { axis: 'x', ratio: 0.2,
    first: { axis: 'y', ratio: 0.62, first: 'spots', second: 'details' },
    second: { axis: 'x', ratio: 0.57, first: 'plots', second: 'images' } };
  await openReview(page, { store: { reviewSplit: true, reviewDataWidth: 57, reviewDockSplit: JSON.stringify(old) } });
  const images = (await tile(page, 'SEM images').boundingBox())!, metadata = (await tile(page, 'Spot metadata').boundingBox())!;
  expect(metadata.y).toBeGreaterThanOrEqual(images.y + images.height);
  expect(metadata.x).toBe(images.x);
  expect(metadata.width).toBe(images.width);
  expect(await saved(page)).toEqual(old);
  expect((await calls(page)).filter(([name, args]) => name === 'plugin:store|set' && args?.key === 'reviewDockSplit')).toEqual([]);
  // A real edit persists the new tree, ending migration for future reads.
  await page.getByRole('separator', { name: 'Resize panels' }).first().press('ArrowRight');
  await expect.poll(() => saved(page)).not.toEqual(old);
  const next = await saved(page);
  expect(next.first).toBe('spots');
  expect(next.second.second).toEqual({ axis: 'y', ratio: 0.45, first: 'images', second: 'details' });
});
