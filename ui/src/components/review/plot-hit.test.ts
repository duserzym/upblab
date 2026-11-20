import { expect, it } from 'vitest';
import { ellipseParams } from '../../lib/concordia-geometry';
import { hitGrid } from './plot-hit';
it('finds the nearest cached centre and tests ellipses exactly across grid cells', () => {
  const hit = hitGrid([
    { point: [50, 60], value: 'ellipse', ellipse: ellipseParams(50, 60, 40, 20, 0.8) },
    { point: [60, 60], value: 'closer' },
  ], 500, 300);
  expect(hit(63, 60)).toBe('closer');
  expect(hit(81, 72)).toBe('ellipse'); expect(hit(81, 72, false)).toBeNull();
  expect(hit(81, 44)).toBeNull(); expect(hit(-1, 60)).toBeNull();
});
it('handles a huge ellipse, polygon fallback, paths and thousands of invented centres', () => {
  const hit = hitGrid([
    ...Array.from({ length: 4000 }, (_, i) => ({ point: [i * 40, 0] as [number, number], value: String(i) })),
    { point: [300, 150] as [number, number], value: 'huge', ellipse: ellipseParams(300, 150, 10000, 10000) },
    { point: [100, 100] as [number, number], value: 'polygon', polygon: [[80, 80], [120, 80], [120, 120], [80, 120]] as [number, number][] },
  ], 1000, 300);
  expect(hit(80, 1)).toBe('2'); expect(hit(114, 114)).toBe('polygon'); expect(hit(600, 150)).toBe('huge');
  expect(hit(600, 150, false)).toBeNull();
});
