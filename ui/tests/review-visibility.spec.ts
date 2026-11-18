import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ReviewSpotsCommand } from '@lab/bridge';
import type { DrawnCounts, DrawnSummary } from '../src/components/review/plot-visibility';
import { calls, openReview } from './review-helpers';

// Both projects in playwright.config.ts run this file: Chromium and WebKit.
const zero: DrawnCounts = { points: 0, ellipses: 0, paths: 0, bands: 0, rings: 0, labels: 0 };
const plots = (page: Page) => page.getByRole('region', { name: 'Age & plots', exact: true });
const targets = (plot: Locator, sample: string) => plot.locator(`.point-target[data-sample="${sample}"]`);
async function drawn(plot: Locator, series: string): Promise<DrawnCounts> {
  const summary = JSON.parse(await plot.getAttribute('data-drawn') ?? '{}') as DrawnSummary;
  return summary[series] ?? { ...zero };
}
async function absent(plot: Locator, sample: string) {
  await expect.poll(() => drawn(plot, sample)).toEqual(zero);
  await expect(targets(plot, sample)).toHaveCount(0);
}
async function geometry(plot: Locator, sample: string, points: number, ellipses = 0, paths = 0) {
  await expect.poll(async () => {
    const d = await drawn(plot, sample);
    return { points: d.points, ellipses: d.ellipses, paths: d.paths };
  }).toEqual({ points, ellipses, paths });
}

for (const mode of ['wetherill', 'tw']) {
  test(`Concordia ${mode}: legend, chip, tree, range, solo and Hide spot hide the complete mark`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openReview(page);
    const region = plots(page), plot = region.getByTestId('review-plot');
    await page.getByLabel('Concordia diagram').selectOption(mode);
    await expect(region.getByRole('button', { name: '2σ ellipses', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-spot-key="acq-1"]').click();
    await page.mouse.move(0, 0);
    await geometry(plot, 'Sample A', 4, 4);
    await geometry(plot, 'Sample B', 4, 4);
    await expect(targets(plot, 'Sample A')).toHaveCount(4);
    await expect.poll(async () => (await drawn(plot, 'Sample A')).rings).toBe(2);
    const originalA = await drawn(plot, 'Sample A'), originalB = await drawn(plot, 'Sample B');
    const chip = page.getByRole('button', { name: 'Sample Sample A', exact: true });

    await region.getByRole('button', { name: 'Hide Sample A', exact: true }).click();
    await absent(plot, 'Sample A');
    await expect.poll(() => drawn(plot, 'Sample B')).toEqual(originalB);
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-spot-key="acq-1"]')).toHaveCount(0);
    const restore = region.getByRole('button', { name: 'Show Sample A', exact: true });
    await expect(restore).toHaveAttribute('aria-pressed', 'false');
    await restore.click();
    await expect.poll(() => drawn(plot, 'Sample A')).toEqual(originalA);
    await expect(targets(plot, 'Sample A')).toHaveCount(4);
    await expect(chip).toHaveAttribute('aria-pressed', 'true');

    await chip.click();
    await absent(plot, 'Sample A');
    await expect(region.getByRole('button', { name: 'Show Sample A', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => drawn(plot, 'Sample B')).toEqual(originalB);
    await chip.click();
    await expect.poll(() => drawn(plot, 'Sample A')).toEqual(originalA);

    const tree = page.getByRole('checkbox', { name: 'Show Sample A in Review', exact: true });
    await tree.click();
    await absent(plot, 'Sample A');
    await expect.poll(() => drawn(plot, 'Sample B')).toEqual(originalB);
    await expect(tree).not.toBeChecked();
    await tree.click();
    await expect.poll(() => drawn(plot, 'Sample A')).toEqual(originalA);

    // The chip establishes the range anchor used by the legend's Shift click.
    await chip.click();
    await region.getByRole('button', { name: 'Hide Sample B', exact: true }).click({ modifiers: ['Shift'] });
    await absent(plot, 'Sample A');
    await absent(plot, 'Sample B');
    await region.getByRole('button', { name: 'Show Sample B', exact: true }).click({ modifiers: ['Shift'] });
    await geometry(plot, 'Sample A', 4, 4);
    await geometry(plot, 'Sample B', 4, 4);

    await region.getByRole('button', { name: 'Hide Sample B', exact: true }).click({ modifiers: ['Alt'] });
    await absent(plot, 'Sample A');
    await absent(plot, 'Demo reference');
    await geometry(plot, 'Sample B', 4, 4);
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: 'Sample Sample B', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'All samples', exact: true }).click();
    await geometry(plot, 'Sample A', 4, 4);

    const spot = plot.locator('[data-point-key="acq-1"]');
    await spot.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Hide spot', exact: true }).click();
    await geometry(plot, 'Sample A', 3, 3);
    await expect(spot).toHaveCount(0);
    await expect(targets(plot, 'Sample A')).toHaveCount(3);
    await geometry(plot, 'Sample B', 4, 4);
    await expect.poll(async () => (await drawn(plot, 'Sample A')).rings).toBe(0);
  });
}

test('A selected and hovered spot hidden by its sample has no ring or keyboard target', async ({ page }) => {
  await openReview(page);
  const region = plots(page), plot = region.getByTestId('review-plot');
  await page.locator('[data-spot-key="acq-1"]').click();
  const spot = plot.locator('[data-point-key="acq-1"]');
  await spot.focus();
  await expect(spot).toBeFocused();
  await expect(spot).toHaveAttribute('data-hovered', 'true');
  await expect.poll(async () => (await drawn(plot, 'Sample A')).rings).toBeGreaterThan(0);
  await region.getByRole('button', { name: 'Hide Sample A', exact: true }).click();
  await absent(plot, 'Sample A');
  await expect(spot).toHaveCount(0);
  await expect(plot.locator('.point-target[tabindex="0"]')).toHaveCount(1);
  await expect(plot.locator('.point-target[tabindex="0"]')).toHaveAttribute('data-sample', 'Sample B');
  await expect(plot).toHaveAttribute('data-hovered-key', '');
  await region.getByRole('button', { name: 'Show Sample A', exact: true }).focus();
  await page.keyboard.press('Alt+Enter');
  await geometry(plot, 'Sample A', 4, 4);
  await absent(plot, 'Sample B');
});

test('Geochemistry legend hides scatter points and REE paths in every panel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReview(page);
  await page.getByRole('tab', { name: 'Geochemistry', exact: true }).click();
  const panels = page.getByTestId('geochem-panel');
  await panels.first().getByRole('button', { name: 'Choose Y axis', exact: true }).click();
  await page.getByRole('group', { name: 'Choose Y quantity', exact: true }).getByRole('button', { name: 'REE pattern', exact: true }).click();
  const charts = plots(page).getByTestId('review-plot');
  const spider = page.locator('[data-panel-type="ree"]').getByTestId('review-plot');
  const scatter = page.locator('[data-panel-type="biplot"]').getByTestId('review-plot').first();
  await geometry(spider, 'Sample A', 0, 0, 4);
  await geometry(scatter, 'Sample A', 4);
  const before: DrawnCounts[] = [];
  for (const chart of await charts.all()) {
    await expect.poll(async () => (await drawn(chart, 'Sample B')).points + (await drawn(chart, 'Sample B')).paths).toBe(4);
    before.push(await drawn(chart, 'Sample B'));
  }
  await panels.first().getByRole('button', { name: 'Hide Sample A', exact: true }).click();
  for (const [i, chart] of (await charts.all()).entries()) {
    await absent(chart, 'Sample A');
    await expect.poll(() => drawn(chart, 'Sample B')).toEqual(before[i]);
  }
  await expect(page.getByRole('button', { name: 'Sample Sample A', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await panels.first().getByRole('button', { name: 'Show Sample A', exact: true }).click();
  await geometry(spider, 'Sample A', 0, 0, 4);
  await geometry(scatter, 'Sample A', 4);
  // The chip updates every panel's legend and canvas too.
  await page.getByRole('button', { name: 'Sample Sample A', exact: true }).click();
  for (const chart of await charts.all()) await absent(chart, 'Sample A');
});

test('Depth column chip removes its trace and uncertainty band together', async ({ page }) => {
  await openReview(page);
  await page.locator('[data-spot-key="acq-1"]').click();
  await page.getByRole('tab', { name: 'Depth profile', exact: true }).click();
  const region = plots(page), plot = region.getByTestId('review-plot');
  await expect.poll(async () => (await drawn(plot, '206Pb/238U_age')).bands).toBe(1);
  await expect.poll(async () => (await drawn(plot, '206Pb/238U_age')).paths).toBe(1);
  await expect.poll(async () => (await drawn(plot, '207Pb/206Pb_age')).bands).toBe(1);
  const other = await drawn(plot, '207Pb/206Pb_age');
  await expect(region.locator('[aria-label="Sample legend"]')).toHaveCount(0);
  const channels = region.getByRole('button', { name: /^Channels/ });
  if (await channels.getAttribute('aria-expanded') === 'true') await channels.click();
  await region.getByLabel('Plotted depth channels').getByRole('button', { name: /^Remove 206Pb\/238U/ }).click();
  await absent(plot, '206Pb/238U_age');
  await expect.poll(() => drawn(plot, '207Pb/206Pb_age')).toEqual(other);
  await channels.click();
  await region.getByRole('group', { name: 'Depth profile channels', exact: true }).getByRole('button', { name: 'Restore defaults', exact: true }).click();
  await expect.poll(async () => (await drawn(plot, '206Pb/238U_age')).bands).toBe(1);
  await expect.poll(async () => (await drawn(plot, '206Pb/238U_age')).paths).toBe(1);
});

test('Legend visibility also removes a sample from SEM overlays and inset groups', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReview(page);
  await page.getByRole('checkbox', { name: 'SEM images', exact: true }).check();
  const last = async () => (await calls(page)).filter(([command, args]) =>
    command === 'module_command' && args?.module === 'images' &&
    (args.command as { type?: string })?.type === 'review-spots').pop()?.[1]?.command as ReviewSpotsCommand | undefined;
  const groups = [
    { name: 'Sample A', color: expect.stringMatching(/^#[0-9a-f]{6}$/i), spots: ['atlas-1', 'atlas-2', 'atlas-3', 'atlas-4'] },
    { name: 'Sample B', color: expect.stringMatching(/^#[0-9a-f]{6}$/i), spots: ['atlas-5', 'atlas-6', 'atlas-7', 'atlas-8'] },
  ];
  await expect.poll(async () => (await last())?.groups).toEqual({ 'project-demo': groups });
  await plots(page).getByRole('button', { name: 'Hide Sample A', exact: true }).click();
  await expect.poll(async () => (await last())?.groups).toEqual({ 'project-demo': [groups[1]] });
  await expect.poll(async () => (await last())?.projects).toEqual({ 'project-demo': groups[1].spots });
  await absent(plots(page).getByTestId('review-plot'), 'Sample A');
  await plots(page).getByRole('button', { name: 'Show Sample A', exact: true }).click();
  await expect.poll(async () => (await last())?.groups).toEqual({ 'project-demo': groups });
  await expect.poll(async () => (await last())?.projects).toEqual({ 'project-demo': groups.flatMap(g => g.spots) });
});
