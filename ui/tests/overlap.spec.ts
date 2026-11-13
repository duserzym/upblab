import { expect, test } from '@playwright/test';
import { defaultLayout, type Layout } from '../src/lib/review-layout';
import { inside, intersection, openReview } from './review-helpers';

const sidebar: Layout = { axis: 'y', ratio: 0.62, first: 'spots', second: 'details' };
const arrangements: Record<string, Layout> = {
  LEFT: { axis: 'x', ratio: 0.34, first: 'images', second: { axis: 'x', ratio: 0.6, first: 'plots', second: sidebar } },
  CENTRE: { axis: 'x', ratio: 0.2, first: sidebar, second: { axis: 'x', ratio: 0.5, first: 'images', second: 'plots' } },
  RIGHT: defaultLayout(true),
};

for (const [width, height] of [[1512, 982], [1280, 800]]) {
  for (const [arrangement, layout] of Object.entries(arrangements)) {
    test(`${width}x${height} SEM ${arrangement}: owned drawers and menus have zero SEM overlap`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      // Set the split tree before mounting through installFakeTauri's settings store.
      await openReview(page, { store: { reviewSplit: true, reviewDockSplit: JSON.stringify(layout) } });
      const sem = page.locator('section[aria-label="SEM images"]');
      const plots = page.locator('section[aria-label="Age & plots"]');
      const measure = async (element: string, selector: string, owner = plots) => {
        const target = page.locator(selector);
        await expect(target).toBeVisible();
        await inside(target, owner);
        const px2 = await intersection(target, sem);
        console.log(`OVERLAP ${width}x${height} ${arrangement} ${element} ${px2}`);
        expect(px2, `${element} intersects the SEM tile`).toBe(0);
      };

      await page.locator('[data-spot-key="acq-1"]').click();
      await page.getByRole('tab', { name: 'Depth profile', exact: true }).click();
      await page.getByRole('button', { name: /^Channels \(/ }).click();
      await measure('Depth-Channels', '#depth-channel-picker');
      await page.getByRole('button', { name: 'Close channel picker', exact: true }).click();

      await page.getByRole('tab', { name: 'Geochemistry', exact: true }).click();
      await page.getByRole('button', { name: 'Presets', exact: true }).click();
      await measure('Geochemistry-Presets', '#review-geochem-presets');
      await page.keyboard.press('Escape');

      for (const [pane, title] of [['spots', 'Spots'], ['plots', 'Age & plots'], ['details', 'Spot metadata']]) {
        await page.getByRole('button', { name: `Move ${title}`, exact: true }).click();
        await measure(`Move-${pane}`, `#dock-${pane}`, page.locator(`section[aria-label="${title}"]`));
        await page.keyboard.press('Escape');
      }

      const panel = page.getByTestId('geochem-panel').first();
      await panel.getByRole('button', { name: 'Choose Y axis', exact: true }).click();
      await expect(panel).toHaveAttribute('aria-current', 'true');
      await expect(page.locator('#geochem-quantity-picker')).toContainText('Y axis · panel 1 ·');
      await measure('Geochemistry-Y-quantity', '#geochem-quantity-picker');
      await page.keyboard.press('Escape');
      await expect(panel).not.toHaveAttribute('aria-current', 'true');
    });
  }
}
