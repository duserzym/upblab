import type { Point } from '../../lib/concordia';

export type Bounds = { x: [number, number]; y: [number, number] };
export type ZoomAxis = 'both' | keyof Bounds;
export type DragTool = 'pan' | 'zoom' | 'select';

export function zoomBounds(bounds: Bounds, factor: number, anchor: Point, axis: ZoomAxis = 'both'): Bounds {
  const scale = ([lo, hi]: [number, number], at: number): [number, number] => {
    const center = lo + (hi - lo) * at;
    const next: [number, number] = [center + (lo - center) * factor, center + (hi - center) * factor];
    return next.every(Number.isFinite) && next[1] - next[0] > Math.max(1, Math.abs(center)) * 1e-12
      ? next : [lo, hi];
  };
  return {
    x: axis === 'y' ? bounds.x : scale(bounds.x, anchor[0]),
    y: axis === 'x' ? bounds.y : scale(bounds.y, anchor[1]),
  };
}

export function panBounds(bounds: Bounds, dx: number, dy: number): Bounds {
  const shift = ([lo, hi]: [number, number], fraction: number): [number, number] => {
    const offset = (hi - lo) * fraction;
    return [lo + offset, hi + offset];
  };
  return { x: shift(bounds.x, -dx), y: shift(bounds.y, dy) };
}

export function contains(bounds: Bounds, [x, y]: Point) {
  return x >= bounds.x[0] && x <= bounds.x[1] && y >= bounds.y[0] && y <= bounds.y[1];
}

/** Center on the middle 80% of plotted centers. A separate Fit all retains every point. */
export function clusterBounds(points: Point[]): Bounds | null {
  if (points.length < 8) return null;
  function axis(index: 0 | 1): [number, number] {
    const sorted = points.map(p => p[index]).sort((a, b) => a - b);
    const trim = Math.max(1, Math.floor(sorted.length * 0.1));
    const lo = sorted[trim], hi = sorted[sorted.length - 1 - trim];
    const pad = (hi - lo) * 0.12 || Math.max(Math.abs(lo) * 0.03, 1e-6);
    return [lo - pad, hi + pad];
  }
  return { x: axis(0), y: axis(1) };
}
