import { expect, type Page } from '@playwright/test';
const names = ['Capsule grid', 'Capsule details', 'Grain selection', 'Chemistry step rail'] as const;
type Box = { x: number; y: number; width: number; height: number };
export async function timsRegionBoxes(page: Page): Promise<Record<string, Box>> {
  // Include Svelte's flush and disclosure layout before both baseline and later reads.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const boxes: Record<string, Box> = {};
  for (const name of names) {
    const box = await page.getByLabel(name, { exact: true }).boundingBox();
    expect(box, `${name} stays mounted`).not.toBeNull(); boxes[name] = box!;
  }
  return boxes;
}
export async function expectTimsRegionsStable(page: Page, before: Record<string, Box>) {
  const after = await timsRegionBoxes(page);
  for (const name of names) for (const field of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(after[name][field] - before[name][field]), `${name} ${field} shifted`).toBeLessThanOrEqual(2);
}
