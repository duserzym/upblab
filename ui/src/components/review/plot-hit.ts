import type { Point } from '../../lib/concordia';
import { ellipseExtents, insideEllipse, type Ellipse } from '../../lib/concordia-geometry';
export interface HitPoint<T> { point: Point; value: T; ellipse?: Ellipse; polygon?: Point[] }
/** A cached pixel-space grid. Huge ellipses use a small overflow list. */
export function hitGrid<T>(points: HitPoint<T>[], width: number, height: number) {
  const size = 32, columns = Math.max(1, Math.ceil(width / size)), rows = Math.max(1, Math.ceil(height / size));
  type Ranked = HitPoint<T> & { rank: number };
  const cells = new Map<number, Ranked[]>(), overflow: Ranked[] = [];
  for (const [rank, point] of points.entries()) {
    const p: Ranked = { ...point, rank };
    let lo: Point = [p.point[0] - 12, p.point[1] - 12], hi: Point = [p.point[0] + 12, p.point[1] + 12];
    const include = (q: Point) => { lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])]; hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])]; };
    if (p.ellipse) for (const q of ellipseExtents(p.ellipse)) include(q);
    else if (p.polygon) for (const q of p.polygon) include(q);
    const x0 = Math.max(0, Math.floor(lo[0] / size)), x1 = Math.min(columns - 1, Math.floor(hi[0] / size));
    const y0 = Math.max(0, Math.floor(lo[1] / size)), y1 = Math.min(rows - 1, Math.floor(hi[1] / size));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) { overflow.push(p); continue; }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const key = y * columns + x, bucket = cells.get(key);
      if (bucket) bucket.push(p); else cells.set(key, [p]);
    }
  }
  return (x: number, y: number, includeEllipses = true): T | null => {
    if (x < 0 || y < 0 || x > width || y > height) return null;
    let closest: T | null = null, distance = Infinity, rank = -1;
    const inspect = (p: Ranked) => {
      const d = Math.hypot(x - p.point[0], y - p.point[1]);
      if (d > distance || (d === distance && p.rank < rank)) return;
      let inside = false;
      if (includeEllipses && d > 12) {
        if (p.ellipse) inside = insideEllipse(p.ellipse, [x, y]);
        else if (p.polygon) for (let i = 0, j = p.polygon.length - 1; i < p.polygon.length; j = i++) {
          const a = p.polygon[i], b = p.polygon[j];
          if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
      }
      if (d <= 12 || inside) { distance = d; closest = p.value; rank = p.rank; }
    };
    for (const p of cells.get(Math.min(rows - 1, Math.floor(y / size)) * columns + Math.min(columns - 1, Math.floor(x / size))) ?? []) inspect(p);
    for (const p of overflow) inspect(p);
    return closest;
  };
}
