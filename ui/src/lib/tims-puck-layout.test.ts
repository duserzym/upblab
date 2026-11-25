import { describe, expect, it } from 'vitest';
import { puckBoardLayout, puckLayout, puckLabel, puckWellLimits, type Box } from './tims-puck-layout';
import { puckSlotCoordinates } from './tims-geometry';

const intersects = (a: Box, b: Box) => a.x < b.x + b.width - 1e-6 && b.x < a.x + a.width - 1e-6
  && a.y < b.y + b.height - 1e-6 && b.y < a.y + a.height - 1e-6;
function circleIntersects(box: Box, circle: Box) {
  const x = circle.x + circle.width / 2, y = circle.y + circle.height / 2;
  return Math.hypot(x - Math.max(box.x, Math.min(x, box.x + box.width)),
    y - Math.max(box.y, Math.min(y, box.y + box.height))) < circle.width / 2 - 1e-6;
}
function inside(box: Box, width: number, height: number) {
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1e-6);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1e-6);
}

describe.each([1, 2, 3, 4, 5, 6])('%i-position ring', perPuck => {
  it.each([28, 28.5, 32, 36, 38.49, 40, 49.86, 56, 60])('keeps all labels, wells and caption separate at %i px', size => {
    const puck = puckLayout(perPuck, size);
    for (const [index, slot] of puck.slots.entries()) {
      inside(slot.well, puck.width, puck.height); inside(slot.label, puck.width, puck.height);
      for (const other of puck.slots) {
        expect(circleIntersects(slot.label, other.well)).toBe(false);
        // The browser checks well bounding boxes too (a stronger condition).
        expect(intersects(slot.label, other.well)).toBe(false);
        expect(intersects(puck.caption, other.label)).toBe(false);
        expect(circleIntersects(puck.caption, other.well)).toBe(false);
      }
      for (const other of puck.slots.slice(index + 1)) {
        expect(intersects(slot.label, other.label)).toBe(false);
        expect(Math.hypot(slot.well.x - other.well.x, slot.well.y - other.well.y)).toBeGreaterThanOrEqual(size);
      }
      const angle = puckSlotCoordinates(index, perPuck);
      expect(slot.well.x + size / 2 - (puck.disc.x + puck.disc.width / 2)).toBeCloseTo((angle.x - 50) / 33 * puck.ringRadius);
      expect(slot.well.y + size / 2 - (puck.disc.y + puck.disc.height / 2)).toBeCloseTo((angle.y - 50) / 33 * puck.ringRadius);
    }
    expect(intersects(puck.caption, puck.disc)).toBe(false);
    inside(puck.caption, puck.width, puck.height);
  });
  it.each([1, 2, 3, 4, 5])('fits %i puck footprints without intersections', pucks => {
    const input = { pucks, perPuck, width: 360, height: 800 };
    const layout = puckBoardLayout(input);
    expect(layout.fits).toBe(true);
    expect(puckBoardLayout(input)).toEqual(layout);
    const boxes = layout.offsets.map(offset => ({ ...offset, width: layout.puck.width, height: layout.puck.height }));
    boxes.forEach((box, index) => {
      inside(box, input.width, input.height);
      boxes.slice(index + 1).forEach(other => expect(intersects(box, other)).toBe(false));
    });
  });
});

it.each([[300, 400], [300, 500], [283, 400], [283, 518], [366, 518], [366, 618]])('fits three five-hole pucks in %i × %i px', (width, height) => {
  const input = { pucks: 3, perPuck: 5, width, height };
  const { puck, offsets, fits } = puckBoardLayout(input);
  expect(fits).toBe(true); expect(puck.wellSize).toBeGreaterThanOrEqual(28);
  expect(puckBoardLayout(input)).toEqual(puckBoardLayout(input));
  expect(offsets[0].y).toBe(offsets[1].y);
  expect(offsets[2].y).toBeGreaterThan(offsets[0].y);
  expect(offsets[2].x + puck.width / 2).toBeCloseTo(width / 2);
  offsets.forEach(offset => inside({ ...offset, width: puck.width, height: puck.height }, width, height));
  // A 0.02 px larger well must exceed a constraint unless the maximum was reached.
  if (puck.wellSize < puckWellLimits.max - .01) {
    const next = puckLayout(5, puck.wellSize + .02);
    expect(2 * next.width + 2 > width || 2 * next.height + 2 > height).toBe(true);
  }
});

it('centres one, pairs two and four, and wraps odd final rows', () => {
  for (const pucks of [1, 2, 3, 4, 5]) {
    const { puck, offsets } = puckBoardLayout({ pucks, perPuck: 5, width: 300, height: 700 });
    expect(offsets.at(-1)!.x + (pucks % 2 ? puck.width / 2 : puck.width)).toBeLessThanOrEqual(300);
    if (pucks % 2) expect(offsets.at(-1)!.x + puck.width / 2).toBeCloseTo(150);
    if (pucks >= 4) expect(offsets[2].y).toBe(offsets[3].y);
  }
});

it('keeps minimum wells and scrolls vertically in the narrow column or for many pucks', () => {
  const small = puckBoardLayout({ pucks: 3, perPuck: 5, width: 143, height: 150, columns: 1 });
  expect(small.fits).toBe(false); expect(small.puck.wellSize).toBe(28);
  expect(small.width).toBe(143); expect(small.height).toBeGreaterThan(150);
  expect(small.offsets.every(offset => offset.x === small.offsets[0].x)).toBe(true);
  const many = puckBoardLayout({ pucks: 10, perPuck: 5, width: 283, height: 519 });
  expect(many.fits).toBe(false); expect(many.puck.wellSize).toBe(28); expect(many.width).toBe(283);
});

it.each([7, 12, 30, 60])('contains each of %i grid labels beneath its own well', perPuck => {
  const puck = puckLayout(perPuck, 28);
  expect(puck.width).toBeLessThanOrEqual(143);
  for (const [index, slot] of puck.slots.entries()) {
    expect(slot.label.y).toBeGreaterThan(slot.well.y + slot.well.height);
    inside(slot.label, puck.width, puck.height); inside(slot.well, puck.width, puck.height);
    puck.slots.forEach(other => expect(intersects(slot.label, other.well)).toBe(false));
    puck.slots.slice(index + 1).forEach(other => expect(intersects(slot.label, other.label)).toBe(false));
    expect(intersects(slot.label, puck.caption)).toBe(false);
  }
});

it('reserves fixed readable text boxes independently of the wells', () => {
  expect(puckLabel).toEqual({ width: 44, height: 37, nameFont: 11, markFont: 10, looseFont: 11 });
  // Real system-font measurements: K15 bold at 11 px; G ✓ S ✓ at 10 px.
  expect(puckLabel.width).toBeGreaterThan(40.42);
  expect(puckLabel.height).toBe(13 + 11 + 13);
  expect(puckWellLimits).toEqual({ min: 28, max: 60 });
  expect(puckBoardLayout({ pucks: 1, perPuck: 5, width: 700, height: 700 }).puck.wellSize).toBe(60);
});

it.each([
  { viewport: '1440 × 900', width: 366, height: 619, well: 49.86, disc: 181.989, minimum: 170 },
  { viewport: '1280 × 800', width: 283, height: 519, well: 38.49, disc: 140.4885, minimum: 140 },
])('sizes the fixture board at $viewport', ({ width, height, well, disc, minimum }) => {
  // Board tracks about 383/300 px; remove 16 px padding and 1 px rounding
  // margin. Bench heights about 694/594 px; remove the board's 74 px chrome
  // and that same 1 px margin. Width is the limiting constraint in both cases.
  const layout = puckBoardLayout({ pucks: 3, perPuck: 5, width, height });
  expect(layout.fits).toBe(true);
  expect(layout.puck.wellSize).toBe(well);
  expect(layout.puck.disc.width).toBeCloseTo(disc);
  expect(layout.puck.disc.width).toBeGreaterThanOrEqual(minimum);
  expect(layout.puck.width).toBe(layout.puck.disc.width);
  for (const offset of layout.offsets) inside({ ...offset, width: layout.puck.width, height: layout.puck.height }, width, height);
});

it('keeps the six-hole minimum footprint inside the narrow board width', () => {
  const { puck, width } = puckBoardLayout({ pucks: 3, perPuck: 6, width: 143, height: 350, columns: 1 });
  expect(puck.wellSize).toBe(28);
  expect(width).toBe(143);
  expect(puck.width).toBeLessThanOrEqual(143);
  for (const slot of puck.slots) expect(slot.label.width).toBeGreaterThan(40.42);
});
