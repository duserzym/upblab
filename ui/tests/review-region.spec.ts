import { expect, test, type Page } from '@playwright/test';
import { calls, inside, openReview } from './review-helpers';
import { mount, regionReviewFixtures, regionSession, rows, sampleRegion } from './fixtures/review';
import { atlasStatusFixture } from './fixtures/atlas-sync';

const emitNotify = (page: Page, event: unknown, source = 'images') => page.evaluate(({ event, source }) =>
  (window as unknown as { __emit(e: string, payload: unknown): Promise<void> }).__emit('lab-bridge://notify', { event, source }), { event, source });
const summary = (page: Page) => page.getByTestId('region-summary');
async function expandDetails(page: Page) {
  const expand = page.getByRole('button', { name: 'Expand Spot metadata', exact: true });
  if (await expand.isVisible()) await expand.click();
}
async function restoreDetails(page: Page) {
  const restore = page.getByRole('button', { name: 'Restore Spot metadata', exact: true });
  if (await restore.isVisible()) await restore.click();
}
const mountRequests = async (page: Page) => (await calls(page)).filter(([c, a]) => c === 'api_get' && a?.path === `/v1/mounts/${mount.id}/results`);

for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test(`${width}x${height}: mount title shrinks before header actions`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openReview(page, { store: { reviewSplit: true }, fixtures: regionReviewFixtures });
    const tile = page.locator('[data-review-panel="images"]'), header = tile.locator('header');
    const title = header.getByRole('button', { name: `Summarise mount ${mount.label}`, exact: true });
    await expect(title).toBeVisible();
    await expect(header).toContainText(`SEM images · ${mount.label}`);
    await expect(header.locator('.image-heading')).toHaveAttribute('title', /Mount Demo zircon mount: Sample A, Sample B; standards Demo reference/);
    for (const name of ['Edit in grainatlas', 'Maximise SEM images', 'Move SEM images']) {
      const button = header.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible(); await inside(button, header);
    }
    const bounds = await header.evaluate(el => {
      const heading = el.querySelector('.heading')!.getBoundingClientRect();
      const actions = el.querySelector('.header-actions')!.getBoundingClientRect();
      return { right: heading.right, left: actions.left, fits: document.documentElement.scrollWidth <= innerWidth };
    });
    expect(bounds.right).toBeLessThanOrEqual(bounds.left + 1); expect(bounds.fits).toBe(true);
    await title.focus(); await title.press('Enter');
    await expandDetails(page);
    await expect(summary(page)).toContainText('Whole mount');
    await expect(summary(page).locator('.counts')).toContainText('13');
  });
}

test('sample summaries show stored sessions and counts, Back to restores the prior spot, and spot picks dismiss them', async ({ page }) => {
  await openReview(page, { store: { reviewSplit: true }, fixtures: regionReviewFixtures });
  await page.locator('[data-spot-key="acq-2"]').click();
  await emitNotify(page, sampleRegion);
  await expandDetails(page);
  await expect(summary(page)).toBeVisible();
  for (const [label, value] of [['Grains', '2'], ['Spots', '4'], ['Analysed', '4'], ['Plucked', '1']]) {
    await expect(summary(page).locator('.counts div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')).toHaveText(value);
  }
  await expect(summary(page)).toContainText(regionSession.session_key);
  await expect(summary(page)).toContainText('2026-11-12');
  await expect(summary(page)).toContainText('shown');
  await expect(summary(page)).toContainText('z1');
  await summary(page).getByRole('button', { name: 'Back to Zircon_2', exact: true }).click();
  await expect(summary(page)).toHaveCount(0);
  await expect(page.getByTestId('review-details').getByRole('heading', { name: 'Zircon_2', exact: true })).toBeVisible();
  await emitNotify(page, sampleRegion);
  await emitNotify(page, { type: 'lab.spot.selected', project: 'project-demo', spot: 'atlas-3', via: 'user' });
  await expect(summary(page)).toHaveCount(0);
  await expect(page.getByTestId('review-details').getByRole('heading', { name: 'Zircon_3', exact: true })).toBeVisible();
  await restoreDetails(page);
  await emitNotify(page, sampleRegion);
  await page.locator('[data-spot-key="acq-4"]').click();
  await expect(summary(page)).toHaveCount(0);
  await emitNotify(page, sampleRegion); await expandDetails(page);
  await summary(page).getByRole('button', { name: 'Review session', exact: true }).click();
  await expect(summary(page)).toHaveCount(0);
  await expect.poll(async () => (await calls(page)).some(([c, a]) => c === 'api_get' && a?.path === `/v1/sessions/${regionSession.id}/results?run=preferred`)).toBe(true);
  await expect(page.getByTestId('review-details')).toContainText(regionSession.session_key);
});

test('reported mount determines the title, while inactive and malformed region events are ignored', async ({ page }) => {
  await openReview(page, { store: { reviewSplit: true }, fixtures: regionReviewFixtures });
  await emitNotify(page, { ...atlasStatusFixture, project: 'unknown', mount: 'unknown', name: 'Wrong mount' });
  await expect(page.getByRole('button', { name: `Summarise mount ${mount.label}`, exact: true })).toBeVisible();
  await emitNotify(page, { ...sampleRegion, spots: [42] });
  await expect(summary(page)).toHaveCount(0);
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await emitNotify(page, sampleRegion);
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  await expect(summary(page)).toHaveCount(0);
});

test('5,000-spot mount uses exactly one results request and no session requests on summary opening', async ({ page }) => {
  const large = Array.from({ length: 5000 }, (_, i) => ({ ...rows[i % rows.length], acquisition_id: `large-acq-${i}`, spot_id: `large-spot-${i}`,
    atlas_spot_id: `large-atlas-${i}`, grain_id: `large-grain-${i >> 1}`, session_id: `large-session-${i % 40}`, session_key: `Invented ${i % 40}` }));
  await openReview(page, { store: { reviewSplit: true }, fixtures: { ...regionReviewFixtures, [`/v1/mounts/${mount.id}/results`]: { spots: large } } });
  const before = await calls(page);
  await page.getByRole('button', { name: `Summarise mount ${mount.label}`, exact: true }).click();
  await expandDetails(page);
  await expect(summary(page).locator('.counts')).toContainText('5000');
  expect(await mountRequests(page)).toHaveLength(1);
  const added = (await calls(page)).slice(before.length);
  expect(added.filter(([c, a]) => c === 'api_get' && String(a?.path).includes('/sessions/') && String(a?.path).includes('/results'))).toHaveLength(0);
  await summary(page).getByRole('button', { name: 'Close', exact: true }).click();
  await restoreDetails(page);
  await page.getByRole('button', { name: `Summarise mount ${mount.label}`, exact: true }).click();
  await expect.poll(async () => (await mountRequests(page)).length).toBe(2);
});
