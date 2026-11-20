import { describe, expect, it } from 'vitest';
import { concordia, ellipse, EARTH_AGE, L235, twAgeAtX, type Point } from './concordia';
import { ellipseParams, ellipsePoint, ellipseExtents, ellipseBeziers, insideEllipse, mapEllipse, sampleCurve } from './concordia-geometry';

describe('screen-space reference curve', () => {
  function check(fn: (t: number) => Point, from: (p: Point) => number, lo: number, hi: number, map: (p: Point) => Point) {
    const points = sampleCurve(fn, lo, hi, map);
    expect(points.length).toBeGreaterThanOrEqual(1200);
    expect(points.length).toBeLessThanOrEqual(8193);
    expect(points[0]).toEqual(fn(lo)); expect(points.at(-1)).toEqual(fn(hi));
    for (let i = 1; i < points.length; i++) {
      const a = map(points[i - 1]), b = map(points[i]);
      const m = map(fn((from(points[i - 1]) + from(points[i])) / 2));
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThanOrEqual(2 + 1e-7);
      expect(Math.hypot(m[0] - (a[0] + b[0]) / 2, m[1] - (a[1] + b[1]) / 2)).toBeLessThanOrEqual(0.2 + 1e-7);
    }
  }
  it('refines both long chords and midpoint deviation', () => {
    check(t => [t, t * t], p => p[0], 0, 1, p => [p[0] * 1200, p[1] * 800]);
    // A short chord with a highly curved midpoint must also be split.
    const wave = (t: number): Point => [t, Math.sin(16 * Math.PI * t)];
    const points = sampleCurve(wave, 0, 1, p => [p[0], p[1] * 0.5], { minPoints: 17 });
    expect(points.length).toBeGreaterThan(17);
  });
  it('keeps its floor even for a tiny view and stops at the vertex budget', () => {
    expect(sampleCurve(t => [t, 0], 0, 1, p => p)).toHaveLength(1200);
    expect(sampleCurve(t => [t, t * t], 0, 1, p => [p[0] * 1e10, p[1] * 1e10])).toHaveLength(8193);
    expect(sampleCurve(t => [t, 0], 0, 1, p => p, { minPoints: 1200, maxPoints: 37 })).toHaveLength(37);
    expect(sampleCurve(t => [t, 0], 1, 0, p => p)).toEqual([]);
  });
  for (const mode of ['tw', 'wetherill'] as const) for (const [lo, hi] of [[1e5, EARTH_AGE], [1e5, 1.001e5], [0, 1e3]]) {
    if (mode === 'tw' && lo === 0) continue;
    it(`${mode} stays smooth at ${lo}–${hi} years, including the young T-W end`, () => {
      const fn = (t: number) => concordia(t, mode), a = fn(lo), b = fn(hi);
      const map = (p: Point): Point => [(p[0] - a[0]) / (b[0] - a[0]) * 1200, (p[1] - a[1]) / (b[1] - a[1]) * 700];
      check(fn, p => mode === 'tw' ? twAgeAtX(p[0]) : Math.log1p(p[0]) / L235, lo, hi, map);
    });
  }
});

describe('stored covariance ellipse', () => {
  for (const rho of [-1, -0.7, 0, 0.7, 1, NaN]) it(`matches the old polygon and analytic extents for rho=${rho}`, () => {
    const e = ellipseParams(10, 20, -2, -3, rho), polygon = ellipse(10, 20, -2, -3, rho), extents = ellipseExtents(e);
    for (const dim of [0, 1]) {
      expect(extents[0][dim]).toBeCloseTo(Math.min(...polygon.map(p => p[dim])), 12);
      expect(extents[1][dim]).toBeCloseTo(Math.max(...polygon.map(p => p[dim])), 12);
    }
    expect(extents[0]).toEqual([8, 17]); expect(extents[1]).toEqual([12, 23]);
    for (const p of polygon) {
      const u = (p[0] - e.centre[0]) / e.a[0], v = (p[1] - e.centre[1] - e.a[1] * u) / e.b[1];
      expect(Math.abs(u * u + v * v - 1)).toBeLessThan(1e-12);
    }
  });
  it('has four exact cardinal endpoints and <0.03% cubic radial error', () => {
    const e = ellipseParams(0, 0, 1, 1), { start, segments } = ellipseBeziers(e);
    let previous = start;
    segments.forEach(([c1, c2, end], i) => {
      const cardinal = ellipsePoint(e, (i + 1) * Math.PI / 2);
      expect(end[0]).toBeCloseTo(cardinal[0], 14); expect(end[1]).toBeCloseTo(cardinal[1], 14);
      for (let j = 0; j <= 100; j++) {
        const t = j / 100, a = 1 - t;
        const p = [0, 1].map(d => a ** 3 * previous[d] + 3 * a * a * t * c1[d] + 3 * a * t * t * c2[d] + t ** 3 * end[d]);
        expect(Math.abs(Math.hypot(...p) - 1)).toBeLessThan(0.0003);
      }
      previous = end;
    });
    expect(start).toEqual(ellipsePoint(e, 0));
    const tilted = ellipseParams(5, 7, 2, 3, 0.8);
    const cubic = ellipseBeziers(tilted);
    expect(cubic.start).toEqual(ellipsePoint(tilted, 0));
    cubic.segments.forEach((segment, i) => {
      const p = ellipsePoint(tilted, (i + 1) * Math.PI / 2);
      expect(segment[2][0]).toBeCloseTo(p[0], 12); expect(segment[2][1]).toBeCloseTo(p[1], 12);
    });
  });
  it('tests the exact conic after pixel mapping, including its boundary', () => {
    const e = mapEllipse(ellipseParams(10, 20, 2, 3, -0.7), p => [p[0] * 30 + 7, 900 - p[1] * 4]);
    expect(insideEllipse(e, e.centre)).toBe(true);
    for (let i = 0; i < 60; i++) {
      const p = ellipsePoint(e, i * Math.PI / 30);
      expect(insideEllipse(e, p)).toBe(true);
      for (const factor of [0.999, 1.001]) expect(insideEllipse(e, [e.centre[0] + (p[0] - e.centre[0]) * factor, e.centre[1] + (p[1] - e.centre[1]) * factor])).toBe(factor < 1);
    }
    expect(insideEllipse(ellipseParams(0, 0, 0, 1), [0, 0])).toBe(false);
  });
});

import { traceEllipse } from './concordia-geometry';
it('traces four cubics to exactly the start without closing or allocating a polygon', () => {
  for (const rho of [-0.999, 0, 0.8]) {
    const e = mapEllipse(ellipseParams(2, 3, 0.4, 0.2, rho), p => [p[0] * 100, 500 - p[1] * 200]);
    const calls: number[][] = [], expected = ellipseBeziers(e);
    const path = { moveTo: (...args: number[]) => calls.push(args), bezierCurveTo: (...args: number[]) => calls.push(args), closePath: () => { throw new Error('redundant close'); } };
    traceEllipse(path, e);
    expect(calls).toHaveLength(5); expect(calls[0]).toEqual(expected.start);
    expected.segments.forEach((segment, i) => segment.flat().forEach((value, j) => expect(calls[i + 1][j]).toBeCloseTo(value, 12)));
    expect(calls[4].slice(-2)).toEqual(calls[0]);
  }
});
