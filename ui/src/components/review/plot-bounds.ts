import type { Point } from '../../lib/concordia';
import { ellipseExtents } from '../../lib/concordia-geometry';
import type { Mark, Band } from './plot-data';
import type { Bounds } from './plot-viewport';

/** Preserve Fit all's outlier rule without materialising ellipse polygons. */
export function markBounds(marks: Mark[], bands: Band[], logX: boolean, logY: boolean, empty?: Bounds): Bounds {
  const valid = (p: Point | null | undefined): p is Point => !!p && p.every(Number.isFinite) && (!logX || p[0] > 0) && (!logY || p[1] > 0);
  const core: Point[] = [];
  for (const m of marks) { if (valid(m.point)) core.push(m.point); for (const p of m.path ?? []) if (valid(p)) core.push(p); }
  for (const b of bands) for (const line of [b.upper, b.lower]) for (const p of line) if (valid(p)) core.push(p);
  const extent = (points: Point[]): Bounds => {
    const result: Bounds = { x: [Infinity, -Infinity], y: [Infinity, -Infinity] };
    for (const p of points) {
      result.x[0] = Math.min(result.x[0], p[0]); result.x[1] = Math.max(result.x[1], p[0]);
      result.y[0] = Math.min(result.y[0], p[1]); result.y[1] = Math.max(result.y[1], p[1]);
    }
    return result;
  };
  if (!core.length && empty) return empty;
  const spread = extent(core), points = [...core];
  for (const m of marks) {
    // Log axes must retain the old polygon filtering across zero.
    const analytic = m.ellipse && !logX && !logY ? ellipseExtents(m.ellipse) : undefined;
    const poly = analytic?.every(valid) ? analytic : (m.polygon ?? []).filter(valid);
    if (!poly.length) continue;
    const box = extent(poly);
    if (core.length > 1 && (box.x[1] - box.x[0] > Math.max(spread.x[1] - spread.x[0], 1e-12) || box.y[1] - box.y[0] > Math.max(spread.y[1] - spread.y[0], 1e-12))) continue;
    for (const p of poly) points.push(p);
  }
  const box = extent(points);
  const pad = ([lo, hi]: Point, log: boolean): Point => {
    if (!points.length) return log ? [0.1, 10] : [0, 1];
    if (log) { const p = Math.max(Math.log10(hi / lo) * 0.08, 0.05); return [lo / 10 ** p, hi * 10 ** p]; }
    const p = (hi - lo) * 0.08 || Math.abs(hi) * 0.1 || 1;
    return [lo - p, hi + p];
  };
  return { x: pad(box.x, logX), y: pad(box.y, logY) };
}
