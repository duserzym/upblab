import { describe, expect, it } from 'vitest';
import { concordia, curve, ellipse, visibleConcordiaAges, ageTicks, EARTH_AGE, L238, L235, U238_U235, CI } from './concordia';
describe('display geometry', () => {
  it('passes through known Wetherill and Tera-Wasserburg points', () => {
    expect(concordia(0)).toEqual([0, 0]);
    const [x, y] = concordia(1e9);
    expect(y).toBeCloseTo(Math.exp(L238 * 1e9) - 1, 12);
    expect(x).toBeCloseTo(Math.exp(L235 * 1e9) - 1, 12);
    expect(concordia(1e9, 'tw')[0]).toBeCloseTo(1 / y, 12);
    expect(concordia(1e9, 'tw')[1]).toBeCloseTo(x / (U238_U235 * y), 12);
    for (const mode of ['wetherill', 'tw'] as const) {
      const [x, y] = concordia(1e9, mode);
      const range = visibleConcordiaAges([x * 0.85, x * 1.15], [y * 0.85, y * 1.15], mode)!;
      expect(range[0]).toBeLessThan(1e9);
      expect(range[1]).toBeGreaterThan(1e9);
      expect(curve(range, mode)).toHaveLength(241);
      expect(ageTicks(range).length).toBeGreaterThan(1);
    }
  });
  it('recalculates labels in tightly zoomed views and when a different age population is plotted', () => {
    for (const mode of ['wetherill', 'tw'] as const) {
      const around = (age: number) => {
        const left = concordia(age - 4e6, mode), right = concordia(age + 4e6, mode);
        return visibleConcordiaAges([Math.min(left[0], right[0]), Math.max(left[0], right[0])], [left[1], right[1]], mode)!;
      };
      expect(ageTicks(around(600e6))).toContain(600e6);
      expect(ageTicks(around(3700e6))).toContain(3700e6);
      expect(visibleConcordiaAges([0.1, 1], [0.001, 0.002], mode)).toBeNull();
    }
    const [x, y] = concordia(EARTH_AGE, 'tw');
    expect(visibleConcordiaAges([x * 0.9, 70], [0, y * 1.1], 'tw')?.[1]).toBe(EARTH_AGE);
  });
  it('preserves absolute stored 2σ half widths and the correlation tilt', () => {
    for (const rho of [-1, -0.7, 0, 0.7, 1]) {
      const points = ellipse(10, 20, 2, 3, rho);
      expect(Math.min(...points.map(p => p[0]))).toBeCloseTo(8, 12);
      expect(Math.max(...points.map(p => p[0]))).toBeCloseTo(12, 12);
      expect(Math.min(...points.map(p => p[1]))).toBeCloseTo(17, 12);
      expect(Math.max(...points.map(p => p[1]))).toBeCloseTo(23, 12);
      if (rho)
        expect(Math.sign(points[0][1] - 20)).toBe(Math.sign(rho));
    }
    expect(ellipse(0, 0, 1, 1)[0]).toEqual([1, 0]);
    expect(CI.La).toBe(0.237);
    expect(CI.Lu).toBe(0.0246);
  });
});

import { concordiaLabels, formatAgeLabel } from './concordia';
it('chooses 1–2–5 age labels with Studio precision and a 4% top/right inset', () => {
  expect(ageTicks([0, 4.54e9])).toEqual(Array.from({ length: 10 }, (_, i) => i * 500e6));
  expect(ageTicks([600.1e6, 600.9e6])).toEqual(Array.from({ length: 9 }, (_, i) => (6001 + i) * 1e5));
  expect(formatAgeLabel(600.25e6, 0.05e6)).toBe('600.25 Ma');
  expect(formatAgeLabel(600.2e6, 0.1e6)).toBe('600.2 Ma');
  expect(formatAgeLabel(600e6, 1e6)).toBe('600 Ma');
  expect(ageTicks([1, 1])).toEqual([]);
  for (const mode of ['wetherill', 'tw'] as const) {
    const a = concordia(300e6, mode), b = concordia(1200e6, mode);
    const x: [number, number] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])], y: [number, number] = [a[1], b[1]];
    const labels = concordiaLabels(x, y, mode);
    expect(labels.length).toBeGreaterThan(3); expect(labels.length).toBeLessThanOrEqual(12);
    for (const { age, label } of labels) {
      const p = concordia(age, mode);
      expect(p[0]).toBeLessThanOrEqual(x[1] - (x[1] - x[0]) * 0.04 + 1e-12);
      expect(p[1]).toBeLessThanOrEqual(y[1] - (y[1] - y[0]) * 0.04 + 1e-12);
      expect(label).toMatch(/^\d+(\.\d+)? Ma$/);
    }
    const earth = concordia(EARTH_AGE, mode);
    expect(concordiaLabels([0, earth[0] * 1.1], [0, earth[1] * 1.1], mode)[0]).toEqual({ age: EARTH_AGE, label: '4540 Ma' });
  }
});
