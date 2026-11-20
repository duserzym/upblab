import { expect, test } from '@playwright/test';
import { largeReviewFixtures } from './fixtures/review-large';
import { openReview } from './review-helpers';
import type { DrawnSummary } from '../src/components/review/plot-visibility';

// Rendering/interaction regressions; timings remain in the opt-in production
// benchmark. These run on Chromium and WebKit with wholly invented data.
for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
  for (const mode of ['wetherill', 'tw'] as const) {
    test(`${mode} smoothness and targets at ${size.width} × ${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      const n = 2000, { session, fixtures } = largeReviewFixtures(n);
      await openReview(page, { fixtures, store: {
        reviewScope: JSON.stringify({ kind: 'session', id: session.id, run: 'preferred' }),
      } });
      const plot = page.getByTestId('review-plot');
      const canvas = plot.locator('.u-wrap canvas'); // The base canvas, excluding the hover overlay.
      const targets = plot.locator('.point-target');
      const layer = plot.locator('.point-targets');
      await page.locator('select[aria-label="Concordia diagram"]').selectOption(mode);
      await expect(plot).toHaveAttribute('data-point-count', String(n));
      await expect(targets).toHaveCount(n);
      // Let the existing debounced ResizeObserver settle before pixel comparisons.
      await page.waitForTimeout(250);
      await expect(layer).toHaveCSS('visibility', 'visible');
      const reference = async () => (JSON.parse(await plot.getAttribute('data-drawn') ?? '{}') as DrawnSummary).__reference__;
      await expect.poll(async () => (await reference())?.paths).toBe(1);
      await expect.poll(async () => (await reference())?.labels ?? 0).toBeGreaterThan(0);
      const original = await plot.getAttribute('data-viewport');
      const targetPosition = await targets.first().getAttribute('style');
      const over = plot.locator('.u-over');
      const box = (await over.boundingBox())!;
      const x = box.x + box.width * 0.5, y = box.y + box.height * 0.5;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 8, y + 5, { steps: 4 });
      await expect(layer).toHaveCSS('visibility', 'hidden');
      // Keep the keyboard/context-menu elements in place during the drag.
      await expect(targets).toHaveCount(n);
      expect(await targets.first().getAttribute('style')).toBe(targetPosition);
      await page.mouse.up();
      await expect(layer).toHaveCSS('visibility', 'visible');
      await expect(plot).toHaveAttribute('data-point-count', String(n));
      expect(await plot.getAttribute('data-viewport')).not.toBe(original);

      // Several wheel events in one task must accumulate, then settle once.
      const beforeWheel = JSON.parse((await plot.getAttribute('data-viewport'))!) as { x: [number, number] };
      const hiddenOnWheel = await over.evaluate(async element => {
        const r = element.getBoundingClientRect();
        for (let i = 0; i < 8; i++) element.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, deltaY: 7,
        }));
        await new Promise(requestAnimationFrame);
        return getComputedStyle(element.closest('[data-testid="review-plot"]')!.querySelector('.point-targets')!).visibility;
      });
      expect(hiddenOnWheel).toBe('hidden');
      await expect(layer).toHaveCSS('visibility', 'visible');
      await expect(plot).toHaveAttribute('data-point-count', String(n));
      const afterWheel = JSON.parse((await plot.getAttribute('data-viewport'))!) as { x: [number, number] };
      expect((afterWheel.x[1] - afterWheel.x[0]) / (beforeWheel.x[1] - beforeWheel.x[0])).toBeCloseTo(2 ** (56 / 280), 8);

      await page.locator('[aria-label="Concordia navigation"] button', { hasText: /^Fit all$/ }).click();
      await expect(plot).toHaveAttribute('data-viewport', original!);
      await expect(plot).toHaveAttribute('data-point-count', String(n));
      await page.mouse.move(0, 0);
      await expect(plot).toHaveAttribute('data-hovered-key', '');
      const pixels = await canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL());
      const point = targets.first(), key = (await point.getAttribute('data-point-key'))!;
      await point.focus();
      await expect(point).toBeFocused();
      await expect(point).toHaveAttribute('data-hovered', 'true');
      await expect(plot).toHaveAttribute('data-hovered-key', key);
      const row = page.locator(`[data-spot-key="${key}"]`);
      await expect(row).toHaveClass(/hovered/);
      // A highlight changes only the overlay. The entire base bitmap is stable.
      expect(await canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL())).toBe(pixels);
      await point.press('Enter');
      await expect(point).toHaveAttribute('data-selected', 'true');
      await expect(row).toHaveClass(/selected/);
      await expect(row.locator('xpath=ancestor::*[@role="treeitem"][1]')).toHaveAttribute('aria-selected', 'true');
      await point.evaluate(element => (element as HTMLElement).blur());
      await expect(plot).toHaveAttribute('data-hovered-key', '');
      await expect(row).not.toHaveClass(/hovered/);
      // Exercise the rAF/grid pointer path as well as keyboard focus. Dense
      // overlapping targets deliberately make a fixed-key mouse hover ambiguous.
      const selectedPixels = await canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL());
      const pointBox = (await point.boundingBox())!;
      await over.dispatchEvent('pointermove', { pointerId: 1, clientX: pointBox.x + pointBox.width / 2, clientY: pointBox.y + pointBox.height / 2 });
      await expect(plot).not.toHaveAttribute('data-hovered-key', '');
      const pointerKey = await plot.getAttribute('data-hovered-key');
      await expect(page.locator(`[data-spot-key="${pointerKey}"]`)).toHaveClass(/hovered/);
      expect(await canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL())).toBe(selectedPixels);
      await expect.poll(async () => (await reference())?.labels ?? 0).toBeGreaterThan(0);

      // Axis changes retain uPlot and all keyboard/context-menu nodes.
      const baseNode = await canvas.elementHandle(), pointNode = await point.elementHandle();
      const diagram = page.locator('select[aria-label="Concordia diagram"]');
      await diagram.selectOption(mode === 'tw' ? 'wetherill' : 'tw');
      await expect(plot).toHaveAttribute('data-point-count', String(n));
      await expect.poll(async () => (await reference())?.paths).toBe(1);
      expect(await baseNode!.evaluate(element => element.isConnected)).toBe(true);
      expect(await pointNode!.evaluate(element => element.isConnected)).toBe(true);
      await diagram.selectOption(mode);
      await expect(plot).toHaveAttribute('data-viewport', original!);
      expect(await baseNode!.evaluate(element => element.isConnected)).toBe(true);

      // Toggling one sample retains the other samples' targets and tree rows.
      const retainedTarget = await plot.locator('.point-target[data-sample="Invented sample 2"]').first().elementHandle();
      const retainedKey = await retainedTarget!.getAttribute('data-point-key');
      const retainedRow = await page.locator(`[data-spot-key="${retainedKey}"]`).elementHandle();
      const chip = page.locator('[aria-label="Sample legend"] button').first();
      await chip.click();
      await expect(plot).toHaveAttribute('data-point-count', String(n * 4 / 5));
      expect(await retainedTarget!.evaluate(element => element.isConnected)).toBe(true);
      expect(await retainedRow!.evaluate(element => element.isConnected)).toBe(true);
      await chip.click();
      await expect(plot).toHaveAttribute('data-point-count', String(n));
      expect(await retainedTarget!.evaluate(element => element.isConnected)).toBe(true);
      expect(await retainedRow!.evaluate(element => element.isConnected)).toBe(true);
      await baseNode!.dispose(); await pointNode!.dispose();
      await retainedTarget!.dispose(); await retainedRow!.dispose();
    });
  }
}
