import { puckSlotCoordinates } from './tims-geometry';

export interface Box { x: number; y: number; width: number; height: number }
export interface PuckLayout {
  width: number; height: number; wellSize: number; ringRadius: number;
  disc: Box; caption: Box; slots: { well: Box; label: Box }[];
}
const labelWidth = 40, labelHeight = 20, clearance = 2, captionHeight = 18;

/** Display geometry only. All boxes use the puck footprint's top-left as origin. */
export function puckLayout(perPuck: number, wellSize: number): PuckLayout {
  const s = wellSize;
  const ring = perPuck <= 6;
  const radius = perPuck === 1 ? 0 : s * (perPuck === 6 ? 1.6 : 1.05);
  const diameter = s * (perPuck === 6 ? 4.3 : 3.65);
  let disc: Box = { x: -diameter / 2, y: -diameter / 2, width: diameter, height: diameter };
  const slots = Array.from({ length: perPuck }, (_, index) => {
    if (!ring) {
      const columns = Math.min(3, perPuck), cellWidth = Math.max(labelWidth, s) + 4, cellHeight = s + labelHeight + 4;
      const x = index % columns * cellWidth, y = Math.floor(index / columns) * cellHeight;
      return { well: { x: x + (cellWidth - s) / 2, y, width: s, height: s },
        label: { x: x + (cellWidth - labelWidth) / 2, y: y + s + clearance, width: labelWidth, height: labelHeight } };
    }
    const point = puckSlotCoordinates(index, perPuck);
    const x = (point.x - 50) / 33 * radius, y = (point.y - 50) / 33 * radius;
    const well = { x: x - s / 2, y: y - s / 2, width: s, height: s };
    let lx = x - labelWidth / 2;
    let ly = y < -0.01 ? well.y - clearance - labelHeight : y + s / 2 + clearance;
    if (perPuck === 5 && (index === 1 || index === 3)) {
      // Upper side labels clear the top label horizontally and all wells vertically.
      lx = index === 1 ? Math.min(lx, -labelWidth - 22) : Math.max(lx, 22);
    }
    if (perPuck === 6 && (index === 1 || index === 4)) {
      // The larger six-hole ring leaves two label boxes in the centre.
      lx = -labelWidth / 2;
      ly = index === 1 ? -labelHeight - clearance / 2 : clearance / 2;
    }
    return { well, label: { x: lx, y: ly, width: labelWidth, height: labelHeight } };
  });
  if (!ring) {
    disc = { x: 0, y: 0, width: Math.min(3, perPuck) * (Math.max(labelWidth, s) + 4),
      height: Math.ceil(perPuck / 3) * (s + labelHeight + 4) };
  }
  const boxes = [disc, ...slots.flatMap(slot => [slot.well, slot.label])];
  const left = Math.min(...boxes.map(b => b.x)), top = Math.min(...boxes.map(b => b.y));
  const right = Math.max(...boxes.map(b => b.x + b.width)), bottom = Math.max(...boxes.map(b => b.y + b.height));
  const width = Math.max(right - left, 116);
  const dx = -left + (width - (right - left)) / 2, dy = -top;
  const translate = (box: Box): Box => ({ ...box, x: box.x + dx, y: box.y + dy });
  return { width, height: bottom - top + clearance + captionHeight, wellSize: s, ringRadius: radius,
    disc: translate(disc), slots: slots.map(slot => ({ well: translate(slot.well), label: translate(slot.label) })),
    caption: { x: 0, y: bottom - top + clearance, width, height: captionHeight } };
}

/** Largest fitting well, to 0.01 px. A too-small area keeps 28 px wells and scrolls. */
export function puckBoardLayout({ pucks, perPuck, width, height, columns = 2 }: {
  pucks: number; perPuck: number; width: number; height: number; columns?: number;
}) {
  const cols = Math.max(1, Math.min(2, columns, pucks || 1)), rows = Math.ceil(pucks / cols), gap = 2;
  const fits = (puck: PuckLayout) => cols * puck.width + (cols - 1) * gap <= width
    && rows * puck.height + Math.max(0, rows - 1) * gap <= height;
  let low = 28, high = 40;
  if (fits(puckLayout(perPuck, high))) low = high;
  for (let i = 0; low < high && i < 16; i++) {
    const mid = (low + high) / 2;
    if (fits(puckLayout(perPuck, mid))) low = mid; else high = mid;
  }
  const puck = puckLayout(perPuck, Math.floor(low * 100) / 100);
  const contentWidth = cols * puck.width + (cols - 1) * gap;
  const contentHeight = rows * puck.height + Math.max(0, rows - 1) * gap;
  const offsets = Array.from({ length: pucks }, (_, index) => {
    const row = Math.floor(index / cols), inRow = Math.min(cols, pucks - row * cols);
    return { x: Math.max(0, (width - (inRow * puck.width + (inRow - 1) * gap)) / 2) + index % cols * (puck.width + gap),
      y: row * (puck.height + gap) };
  });
  return { puck, offsets, width: Math.max(width, contentWidth), height: Math.max(height, contentHeight), fits: fits(puck) };
}
