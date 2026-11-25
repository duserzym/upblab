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

async function settled(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** Content coordinates preserve layout comparisons when the narrow board scrolls. */
export async function timsWellBoxes(page: Page): Promise<Box[]> {
  await settled(page);
  return page.getByRole('region', { name: 'Capsule grid', exact: true }).evaluate(board => {
    const origin = board.getBoundingClientRect();
    return [...board.querySelectorAll('[data-testid="tims-capsule"] .well')].map(well => {
      const box = well.getBoundingClientRect();
      return { x: box.x - origin.x + board.scrollLeft, y: box.y - origin.y + board.scrollTop, width: box.width, height: box.height };
    });
  });
}

export async function expectTimsWellsStable(page: Page, before: Box[]) {
  const after = await timsWellBoxes(page);
  expect(after).toHaveLength(before.length);
  before.forEach((box, index) => {
    for (const field of ['x', 'y', 'width', 'height'] as const)
      expect(Math.abs(after[index][field] - box[field]), `capsule ${index + 1} well ${field} shifted`).toBeLessThanOrEqual(1);
  });
}

/** Full rendered footprints, including labels and captions, must fit the board. */
export async function expectPuckBoardFits(page: Page) {
  await settled(page);
  const failures = await page.getByRole('region', { name: 'Capsule grid', exact: true }).evaluate(board => {
    const failures: string[] = [];
    const bounds = board.getBoundingClientRect();
    const intersects = (a: DOMRect, b: DOMRect) => a.left < b.right - .1 && b.left < a.right - .1
      && a.top < b.bottom - .1 && b.top < a.bottom - .1;
    const contains = (outer: DOMRect, inner: DOMRect) => inner.left >= outer.left - .1 && inner.top >= outer.top - .1
      && inner.right <= outer.right + .1 && inner.bottom <= outer.bottom + .1;
    if (innerWidth >= 1280) {
      if (board.scrollHeight > board.clientHeight + 1) failures.push(`board vertical overflow: ${board.scrollHeight} > ${board.clientHeight}`);
      if (board.scrollWidth > board.clientWidth + 1) failures.push(`board horizontal overflow: ${board.scrollWidth} > ${board.clientWidth}`);
      if (Math.abs(board.scrollTop) > 1 || Math.abs(board.scrollLeft) > 1) failures.push('board is scrolled');
    }
    const pucks = [...board.querySelectorAll('section[aria-label^="Puck "]')];
    if (!pucks.length) failures.push('board has no puck footprints');
    const puckBoxes = pucks.map(puck => puck.getBoundingClientRect());
    pucks.forEach((puck, index) => {
      const name = puck.getAttribute('aria-label');
      const box = puckBoxes[index];
      if (!contains(bounds, box)) failures.push(`${name} outside Capsule grid`);
      puckBoxes.slice(index + 1).forEach(other => { if (intersects(box, other)) failures.push(`${name} overlaps another puck`); });
      const wells = [...puck.querySelectorAll('.well')].map(well => well.getBoundingClientRect());
      const labels = [...puck.querySelectorAll('.capsule-label')].map(label => label.getBoundingClientRect());
      const caption = puck.querySelector('.caption')!.getBoundingClientRect();
      const disc = puck.querySelector('.positions')!.getBoundingClientRect();
      [...wells, ...labels, caption, disc].forEach(child => { if (!contains(box, child)) failures.push(`${name} content outside footprint`); });
      labels.forEach((label, labelIndex) => {
        wells.forEach((well, wellIndex) => {
          // Also check the own well: all two-line label boxes live outside wells.
          if (intersects(label, well)) failures.push(`${name} label ${labelIndex + 1} overlaps well ${wellIndex + 1}`);
        });
        labels.slice(labelIndex + 1).forEach(other => { if (intersects(label, other)) failures.push(`${name} labels overlap`); });
      });
      [...wells, ...labels, disc].forEach(other => { if (intersects(caption, other)) failures.push(`${name} caption overlaps content`); });
    });
    return failures;
  });
  expect(failures, 'capsule board fits without collisions').toEqual([]);
}
