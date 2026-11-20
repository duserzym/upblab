import type { Point } from './concordia';

/** Display-only affine image of the unit circle, using stored absolute 2SE. */
export interface Ellipse { centre: Point; a: Point; b: Point }
export function ellipseParams(x: number, y: number, x2s: number, y2s: number, rho = 0): Ellipse {
  const r = Math.max(-0.999, Math.min(0.999, Number.isFinite(rho) ? rho : 0));
  return { centre: [x, y], a: [Math.abs(x2s), Math.abs(y2s) * r], b: [0, Math.abs(y2s) * Math.sqrt(1 - r * r)] };
}
export function ellipsePoint(e: Ellipse, t: number): Point {
  return [e.centre[0] + e.a[0] * Math.cos(t) + e.b[0] * Math.sin(t), e.centre[1] + e.a[1] * Math.cos(t) + e.b[1] * Math.sin(t)];
}
export function ellipseExtents(e: Ellipse): [Point, Point] {
  const x = Math.hypot(e.a[0], e.b[0]), y = Math.hypot(e.a[1], e.b[1]);
  return [[e.centre[0] - x, e.centre[1] - y], [e.centre[0] + x, e.centre[1] + y]];
}
/** Four cubic circle segments, mapped affinely; no zoom-dependent tessellation. */
export function ellipseBeziers(e: Ellipse): { start: Point; segments: [Point, Point, Point][] } {
  const k = 4 * (Math.sqrt(2) - 1) / 3;
  const map = (x: number, y: number): Point => [e.centre[0] + e.a[0] * x + e.b[0] * y, e.centre[1] + e.a[1] * x + e.b[1] * y];
  return { start: map(1, 0), segments: [
    [map(1, k), map(k, 1), map(0, 1)], [map(-k, 1), map(-1, k), map(-1, 0)],
    [map(-1, -k), map(-k, -1), map(0, -1)], [map(k, -1), map(1, -k), map(1, 0)],
  ] };
}
/** Append the same four cubics without allocations or a redundant closePath.
 * The final endpoint equals moveTo exactly; polygons still close explicitly.
 */
export function traceEllipse(path: Pick<CanvasPath, 'moveTo' | 'bezierCurveTo'>, e: Ellipse): void {
  const [x, y] = e.centre, [ax, ay] = e.a, [bx, by] = e.b, k = 4 * (Math.sqrt(2) - 1) / 3;
  path.moveTo(x + ax, y + ay);
  path.bezierCurveTo(x + ax + k * bx, y + ay + k * by, x + k * ax + bx, y + k * ay + by, x + bx, y + by);
  path.bezierCurveTo(x - k * ax + bx, y - k * ay + by, x - ax + k * bx, y - ay + k * by, x - ax, y - ay);
  path.bezierCurveTo(x - ax - k * bx, y - ay - k * by, x - k * ax - bx, y - k * ay - by, x - bx, y - by);
  path.bezierCurveTo(x + k * ax - bx, y + k * ay - by, x + ax - k * bx, y + ay - k * by, x + ax, y + ay);
}
export function insideEllipse(e: Ellipse, p: Point): boolean {
  const x = p[0] - e.centre[0], y = p[1] - e.centre[1];
  const det = e.a[0] * e.b[1] - e.a[1] * e.b[0];
  if (!det) return false; // Degenerate ellipses retain their centre hit target.
  const u = (x * e.b[1] - y * e.b[0]) / det, v = (e.a[0] * y - e.a[1] * x) / det;
  return u * u + v * v <= 1 + 1e-12;
}
export function mapEllipse(e: Ellipse, map: (p: Point) => Point): Ellipse {
  const centre = map(e.centre);
  const a = map([e.centre[0] + e.a[0], e.centre[1] + e.a[1]]);
  const b = map([e.centre[0] + e.b[0], e.centre[1] + e.b[1]]);
  return { centre, a: [a[0] - centre[0], a[1] - centre[1]], b: [b[0] - centre[0], b[1] - centre[1]] };
}

/** Refine in logical screen pixels, retaining adaptive breakpoints at the floor. */
export function sampleCurve(fn: (t: number) => Point, lo: number, hi: number, toScreen: (p: Point) => Point,
  { minPoints = 1200, maxPoints = 8193 }: { minPoints?: number; maxPoints?: number } = {}): Point[] {
  const cap = Math.max(2, Math.floor(maxPoints)), floor = Math.min(cap, Math.max(2, Math.floor(minPoints)));
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) return [];
  let samples = Array.from({ length: Math.min(17, cap) }, (_, i) => {
    const t = lo + (hi - lo) * i / (Math.min(17, cap) - 1), point = fn(t);
    return { t, point, screen: toScreen(point) };
  });
  for (let pass = 0; pass < 32 && samples.length < cap; pass++) {
    const intervals = samples.slice(0, -1).map((a, i) => {
      const b = samples[i + 1], t = (a.t + b.t) / 2, point = fn(t), screen = toScreen(point);
      const length = Math.hypot(b.screen[0] - a.screen[0], b.screen[1] - a.screen[1]);
      const deviation = Math.hypot(screen[0] - (a.screen[0] + b.screen[0]) / 2, screen[1] - (a.screen[1] + b.screen[1]) / 2);
      return { i, sample: { t, point, screen }, length, score: Math.max(length / 2, deviation / 0.2) };
    });
    let refine = intervals.filter(s => s.score > 1);
    if (!refine.length) {
      const needed = floor - samples.length;
      if (needed <= 0) break;
      refine = intervals.sort((a, b) => b.length - a.length).slice(0, needed);
    }
    const budget = cap - samples.length;
    if (refine.length > budget) refine = refine.sort((a, b) => b.score - a.score).slice(0, budget);
    const insert = new Map(refine.map(s => [s.i, s.sample]));
    samples = samples.flatMap((s, i) => insert.has(i) ? [s, insert.get(i)!] : [s]);
  }
  return samples.map(s => s.point);
}
