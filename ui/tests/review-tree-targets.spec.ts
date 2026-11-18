import { expect, test } from '@playwright/test';
import { openReview } from './review-helpers';
import { session, table } from './fixtures/review';

const longSpotName = 'Invented zircon spot with a very long name that must truncate inside the narrow Review tree';

for (const [width, height] of [[1440, 900], [1280, 800]]) {
  for (const theme of ['light', 'dark']) {
    test(`Review tree targets fit ${width} x ${height} in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      // Rotation is instant, including when the viewer requests reduced motion.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openReview(page, {
        store: { theme, themeChosen: true },
        fixtures: {
          [`/v1/sessions/${session.id}/results?run=preferred`]: {
            ...table, rows: table.rows.map(row => row.acquisition_id === 'acq-2' ? { ...row, label: longSpotName } : row),
          },
        },
      });
      const tree = page.getByRole('tree', { name: 'Result spots', exact: true });
      await expect(tree).toBeVisible();
      for (const kind of ['disclosure', 'handle']) {
        const buttons = tree.locator(`.layer-row button.${kind}:visible`);
        expect(await buttons.count()).toBeGreaterThan(0);
        for (const button of await buttons.all()) {
          const box = await button.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.width).toBeGreaterThanOrEqual(24);
          expect(box!.height).toBeGreaterThanOrEqual(24);
          await expect(button).toHaveAttribute('type', 'button');
          if (kind === 'disclosure') {
            const svg = button.locator('svg');
            await expect(svg).toHaveCount(1);
            const icon = await svg.boundingBox();
            expect(icon).not.toBeNull();
            expect(icon!.width).toBeGreaterThanOrEqual(10);
            expect(icon!.height).toBeGreaterThanOrEqual(10);
          }
        }
      }
      for (const row of await tree.locator('.layer-row:visible').all()) {
        expect((await row.boundingBox())!.height).toBeLessThanOrEqual(28);
      }
      expect(await tree.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      const label = tree.locator('[data-spot-key="acq-2"] > span');
      await expect(label).toHaveText(longSpotName);
      expect(await label.evaluate(el => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis')).toBe(true);

      // Keep the exact disclosure selector used by docs-screenshots.spec.ts.
      const samples = page.getByRole('treeitem', { name: 'Samples', exact: true });
      const disclosure = samples.locator(':scope > .layer-row > button.disclosure');
      const children = samples.locator(':scope > .children');
      const childSpot = children.locator('[data-spot-key="acq-2"]');
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      await expect(disclosure).toHaveAttribute('aria-label', 'Collapse Samples');
      await expect(childSpot).toBeVisible();
      await disclosure.click();
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      await expect(disclosure).toHaveAttribute('aria-label', 'Expand Samples');
      await expect(children).toBeHidden();
      await expect(childSpot).toBeHidden();
      await disclosure.click();
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      await expect(children).toBeVisible();
      await expect(childSpot).toBeVisible();
    });
  }
}
