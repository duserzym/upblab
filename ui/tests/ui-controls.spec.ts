import { test, expect, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';
import { fixtures, batch, lab, recipe } from './fixtures/tims';
import { routeTimsAtlas } from './tims-atlas-helpers';
import { expectTimsBenchFills, timsWellBoxes, expectTimsWellsStable } from './tims-layout';

async function openHeader(page: Page, theme: 'light' | 'dark') {
  await routeTimsAtlas(page);
  await page.route('**/modules/manifest.json', route => route.fulfill({ json: { modules: [] } }));
  await page.addInitScript(installFakeTauri, { signedIn: true,
    store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'tims', theme, themeChosen: true },
    fixtures: { ...fixtures, [`/v1/tims/column-protocols?limit=2&lab=${lab}`]: [],
      [`/v1/tims/batches/${batch.id}`]: { ...batch, recipe_name: null, recipe_id: recipe.id } } });
  await page.goto('./');
  await page.getByRole('region', { name: 'Batch list', exact: true }).getByRole('button', { name: 'Krogh · 2026-11-06', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Krogh (K)', exact: true })).toBeVisible();
}

for (const theme of ['light', 'dark'] as const) test(`batch controls support keyboard and ARIA in ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openHeader(page, theme);
  const radios = page.getByRole('radiogroup', { name: 'Batch views', exact: true });
  const capsules = radios.getByRole('radio', { name: 'Capsules', exact: true });
  const steps = radios.getByRole('radio', { name: 'Batch steps', exact: true });
  const matrix = radios.getByRole('radio', { name: 'Step × capsule matrix', exact: true });
  await expect(radios.getByRole('radio', { checked: true })).toHaveCount(1);
  await expect(capsules).toHaveAttribute('tabindex', '0');
  await expect(steps).toHaveAttribute('tabindex', '-1');
  await expect(matrix).toHaveAttribute('title', 'Step × capsule matrix');
  const wells = await timsWellBoxes(page);
  await capsules.focus(); await capsules.press('ArrowRight');
  await expect(steps).toBeFocused(); await expect(steps).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Step timeline', { exact: true })).toBeVisible();
  await steps.press('End'); await expect(matrix).toBeFocused();
  await expect(matrix).toHaveAttribute('tabindex', '0');
  await expect(page.getByLabel('Capsule record matrix', { exact: true })).toBeVisible();
  await matrix.press('ArrowRight'); await expect(capsules).toBeFocused();
  await capsules.press('ArrowLeft'); await expect(matrix).toBeFocused();
  await matrix.press('Home'); await expect(capsules).toBeFocused();
  await expect(capsules).toHaveAttribute('aria-checked', 'true');
  await expectTimsWellsStable(page, wells);

  const workflow = page.getByRole('navigation', { name: 'Batch setup steps' });
  const setup = workflow.getByRole('button', { name: /^Batch & capsule set, Done$/ });
  await expect(setup).toHaveAttribute('aria-current', 'step');
  await expect(setup).toHaveAccessibleDescription('Check the capsule set, batch date, operator and recipe above.');
  await expect(workflow.getByRole('listitem')).toHaveCount(5);
  const grains = workflow.getByRole('button', { name: /^Grains, \d+ of 15$/ });
  await grains.focus(); await grains.press('Enter');
  await expect(grains).toHaveAttribute('aria-current', 'step');
  await expect(setup).not.toHaveAttribute('aria-current');
  await expect(workflow.locator('[aria-current="step"]')).toHaveCount(1);
  await expect(grains).toHaveAttribute('title', /Grains.*Assign each capsule/);
  await expect(workflow.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
  await expectTimsWellsStable(page, wells);

  const info = page.getByRole('button', { name: 'About the recipe name', exact: true });
  const tooltip = page.getByRole('tooltip');
  await info.focus();
  await expect(tooltip).toHaveText('(current recipe name; snapshot name unavailable)');
  await expect(info).toHaveAccessibleDescription('(current recipe name; snapshot name unavailable)');
  await info.press('Escape'); await expect(tooltip).toHaveCount(0);
  await expect(info).toBeFocused(); await expect(info).toHaveAttribute('aria-expanded', 'false');
  await info.press('Enter'); await expect(tooltip).toBeVisible();
  await info.press('Escape'); await expect(tooltip).toHaveCount(0);
  await info.click(); await expect(tooltip).toBeVisible();
  await page.mouse.move(0, 0);
  await info.press('Tab'); await expect(tooltip).toHaveCount(0);
  await info.hover(); await expect(tooltip).toBeVisible();
  await expect(info).not.toBeFocused();
  await page.keyboard.press('Escape'); await expect(tooltip).toHaveCount(0);

  for (const name of ['Refresh batch', 'Edit batch', 'History']) {
    const action = page.getByRole('button', { name, exact: true });
    await expect(action).toBeVisible(); await expect(action).toHaveAttribute('title', name);
    await expect(action).toHaveText('');
  }
  await expect(page.getByRole('button', { name: 'Back to batches', exact: true })).toHaveText('Batches');
  await expect(page.locator('header time[datetime="2026-11-06"]')).toHaveText('6 Nov 2026');
  await expectTimsBenchFills(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __fake: { writes: unknown[] } }).__fake.writes)).toEqual([]);
});
