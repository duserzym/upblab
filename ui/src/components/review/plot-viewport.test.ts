import { describe, expect, it } from 'vitest';
import { clusterBounds, contains, panBounds, zoomBounds } from './plot-viewport';
import type { Point } from '../../lib/concordia';

describe('Concordia navigation', () => {
  const bounds = { x: [0, 10], y: [0, 20] } as const;
  const initial = { x: [...bounds.x] as [number, number], y: [...bounds.y] as [number, number] };

  it('keeps the value under the pointer fixed while zooming', () => {
    expect(zoomBounds(initial, 0.5, [0.2, 0.75])).toEqual({ x: [1, 6], y: [7.5, 17.5] });
  });

  it('pans with the drag, accounting for the upward data y axis', () => {
    expect(panBounds(initial, 0.2, 0.25)).toEqual({ x: [-2, 8], y: [5, 25] });
  });

  it('fits the cluster despite an extreme stored ratio', () => {
    const cluster = Array.from({ length: 10 }, (_, i): Point => [1 + i * 0.1, 0.2 + i * 0.02]);
    const view = clusterBounds([...cluster, [-11000, -80]])!;
    expect(contains(view, cluster[5])).toBe(true);
    expect(contains(view, [-11000, -80])).toBe(false);
    expect(clusterBounds(cluster.slice(0, 2))).toBeNull();
  });
});
