import { test, expect } from '@playwright/test';
import { openReview, calls } from './review-helpers';
import { timsReviewFixtures, timsBatch } from './fixtures/review';
import { atlasFixtures } from './fixtures/tims-atlas';
import { routeTimsAtlas } from './tims-atlas-helpers';
import { problems } from './problems';
for (const [width, height] of [[1280, 800], [1440, 900]]) {
  for (const theme of ['light', 'dark']) {
    test(`TIMS plucks, chemistry and openers fit ${width} × ${height} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await routeTimsAtlas(page);
      await openReview(page, { store: { theme, themeChosen: true }, fixtures: { ...timsReviewFixtures, '/v1/labs': [{ id: 'synthetic-lab', name: 'Synthetic lab', my_role: 'member' }], '/v1/tims/capsule-sets?limit=500&lab=synthetic-lab': [timsBatch.capsule_set], '/v1/tims/recipes?limit=500&lab=synthetic-lab': [], '/v1/tims/batches?limit=500&lab=synthetic-lab': [timsBatch], '/v1/method-codes?q=SP-TIMS': [], ...atlasFixtures } });
      const section = page.getByRole('region', { name: 'TIMS fractions' });
      await expect(section).toBeVisible();
      const crop = section.getByTestId('tims-grain-image').first();
      await expect(crop).toHaveAttribute('data-image-state', 'ready');
      await expect(crop.locator('clipPath polygon')).toHaveCount(1); await expect(crop.locator('image[href]')).not.toHaveCount(0);
      await expect(section).toContainText('Synthetic-A'); await expect(section).toContainText('K1'); await expect(section).toContainText('Krogh');
      await expect(section).toContainText('Synthetic analyst'); await expect(section).toContainText('2026-11-06');
      await expect(section).toContainText('Temperature: 180 °C'); await expect(section).toContainText('Duration: 12 h');
      await expect(section).toContainText('Dissolution'); await expect(section).toContainText('Acid: 29 M HF'); await expect(section).toContainText('Duration: 48 h');
      await expect(section).toContainText('dissolved during CA'); await expect(section).toContainText('Synthetic recorded outcome');
      await expect(section).toContainText('Synthetic fragment A'); await expect(section).toContainText('Synthetic spike · Master · v1 · superseded');
      await expect(section).toContainText('from this grain');
      const tree = page.getByRole('tree', { name: 'Result spots', exact: true });
      await expect(tree.getByText(/z1 · K1/).first()).toBeAttached();
      const plucked = page.getByRole('button', { name: 'Plucked 3', exact: true });
      await expect(plucked).toHaveAttribute('aria-pressed', 'false'); await plucked.click();
      await expect(page.locator('[data-spot-key]')).toHaveCount(3);
      await page.getByLabel('Filter spots', { exact: true }).fill('K1'); await expect(page.locator('[data-spot-key]')).toHaveCount(1);
      await page.getByLabel('Filter spots', { exact: true }).fill('z2'); await expect(page.locator('[data-spot-key]')).toHaveCount(3);
      await page.getByLabel('Filter spots', { exact: true }).fill('');
      // Sample and Plucked filters compose without extra per-spot reads.
      await page.getByRole('button', { name: 'Sample Sample B', exact: true }).click({ modifiers: ['Alt'] });
      await expect(page.locator('[data-spot-key]')).toHaveCount(0);
      await page.getByRole('button', { name: 'All samples', exact: true }).click();
      await expect(page.locator('[data-spot-key]')).toHaveCount(3);
      await page.locator('[data-spot-key="acq-1"]').click();
      await expect.poll(async () => (await calls(page)).filter(([c, args]) => c === 'api_get' && args?.path === `/v1/tims/batches/${timsBatch.id}`).length).toBe(1);
      await section.getByRole('button', { name: 'Open grain in grainatlas', exact: true }).first().click();
      await expect.poll(async () => (await calls(page)).filter(([c]) => c === 'grainatlas_launch').at(-1)?.[1]).toMatchObject({ project: 'project-demo', grain: 'atlas-grain-1', spot: 'atlas-1' });
      await expect.poll(() => problems(page, 'TIMS Review')).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await section.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await section.getByRole('button', { name: 'Open batch', exact: true }).first().click();
      await expect(page.getByRole('heading', { name: 'Krogh (K) · 2026-11-06', exact: true })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'TIMS', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('tims-capsule')).toHaveCount(15);
      await page.getByRole('navigation', { name: 'TIMS sections' }).getByRole('button', { name: 'Recipes', exact: true }).click();
      await page.getByRole('tab', { name: 'Review', exact: true }).click();
      await section.getByRole('button', { name: 'Open batch', exact: true }).first().click();
      await expect(page.getByRole('tab', { name: 'TIMS', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('heading', { name: 'Krogh (K) · 2026-11-06', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Recipes', exact: true })).toHaveCount(0);
    });
  }
}
test('TIMS fractions failure leaves Review usable and displays the server sentence', async ({ page }) => {
  await routeTimsAtlas(page);
  await openReview(page, { fixtures: { ...timsReviewFixtures, '/v1/labs': [{ id: 'synthetic-lab', name: 'Synthetic lab', my_role: 'member' }], '/v1/tims/capsule-sets?limit=500&lab=synthetic-lab': [timsBatch.capsule_set], '/v1/tims/recipes?limit=500&lab=synthetic-lab': [], '/v1/tims/batches?limit=500&lab=synthetic-lab': [timsBatch], '/v1/method-codes?q=SP-TIMS': [], ...atlasFixtures } });
  await page.evaluate(() => {
    const fake = (window as unknown as { __fake: { apiReplies: Record<string, unknown> } }).__fake;
    fake.apiReplies['/v1/fractions?limit=500&mount=mount-demo'] = { status: 503, body: { code: 'unavailable', detail: 'Synthetic chemistry maintenance.' } };
    window.dispatchEvent(new Event('focus'));
  });
  const diagnostic = page.getByTestId('review-fractions-error');
  await expect(diagnostic).toContainText('503');
  await expect(diagnostic).toContainText('Synthetic chemistry maintenance.');
  await expect(diagnostic).not.toHaveAttribute('role', 'status');
  await expect(page.getByTestId('review-details').getByTestId('review-fractions-error')).toHaveCount(0);
  await expect(page.locator('[data-spot-key]')).toHaveCount(8);
});
for (const status of [404, 405]) {
  test(`Review hides unsupported TIMS fractions after HTTP ${status}`, async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', message => { if (['warning', 'error'].includes(message.type()) && message.text().includes('TIMS')) warnings.push(message.text()); });
    await openReview(page, { apiReplies: { '/v1/fractions?limit=500&mount=mount-demo': { status, body: { detail: 'Synthetic older server.' } } } });
    await expect.poll(async () => (await calls(page)).filter(([name, args]) => name === 'api_get' && args?.path === '/v1/fractions?limit=500&mount=mount-demo').length).toBe(1);
    await expect(page.getByRole('region', { name: 'TIMS fractions' })).toHaveCount(0);
    await expect(page.getByTestId('review-fractions-error')).toHaveCount(0);
    await expect(page.getByTestId('review-details').getByRole('status')).toHaveCount(0);
    await expect(page.locator('[data-spot-key]')).toHaveCount(8);
    expect(warnings).toEqual([]);
  });
}
test('Review fractions retain the source outline when the atlas listing returns 404', async ({ page }) => {
  await routeTimsAtlas(page);
  await openReview(page, { fixtures: { ...timsReviewFixtures, ...atlasFixtures }, apiReplies: { '/v1/mounts/mount-demo/atlas': { status: 404, body: { detail: 'No invented atlas is published.' } } } });
  const section = page.getByRole('region', { name: 'TIMS fractions' });
  const crop = section.getByTestId('tims-grain-image').first();
  await expect(crop.locator('title')).toContainText('404');
  await expect(crop.locator('image')).toHaveCount(0); await expect(crop.locator('polygon')).not.toHaveCount(0);
});
