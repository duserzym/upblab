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
