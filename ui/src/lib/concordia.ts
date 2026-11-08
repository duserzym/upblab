/** Display geometry from stored ratios and uncertainties, never data reduction. */
export const L238 = 1.55125e-10;
export const L235 = 9.8485e-10;
export const U238_U235 = 137.818;
export const EARTH_AGE = 4.54e9; // Years. USGS, Geologic Time: Age of the Earth.
export type Point = [
  number,
  number
];
export type ConcordiaMode = 'wetherill' | 'tw';
export function concordia(t: number, mode: ConcordiaMode = 'wetherill'): Point {
  const a = Math.expm1(L235 * t), b = Math.expm1(L238 * t);
  return mode === 'wetherill' ? [a, b] : [1 / b, a / (U238_U235 * b)];
}
export function twAgeAtX(x: number): number {
  return Math.log1p(1 / x) / L238;
}
export function ellipse(x: number, y: number, x2s: number, y2s: number, rho = 0, n = 48): Point[] {
  const r = Math.max(-0.999, Math.min(0.999, Number.isFinite(rho) ? rho : 0));
  const phase = Math.acos(r);
  // Include exact extrema as well as the regular polygon vertices.
  const angles = [...Array.from({ length: n }, (_, i) => 2 * Math.PI * i / n), phase, phase + Math.PI].sort((a, b) => a - b);
  const points = angles.map(t => [x + Math.abs(x2s) * Math.cos(t), y + Math.abs(y2s) * (r * Math.cos(t) + Math.sqrt(1 - r * r) * Math.sin(t))] as Point);
  return [...points, points[0]];
}
/** The ages where the reference curve intersects the current plot rectangle. */
export function visibleConcordiaAges(x: Point, y: Point, mode: ConcordiaMode): Point | null {
  if (x[1] <= 0 || y[1] <= 0) return null;
  if (mode === 'wetherill') {
    const lo = Math.max(0, Math.log1p(Math.max(0, x[0])) / L235, Math.log1p(Math.max(0, y[0])) / L238);
    const hi = Math.min(EARTH_AGE, Math.log1p(x[1]) / L235, Math.log1p(y[1]) / L238);
    return lo < hi ? [lo, hi] : null;
  }
  const youngest = Math.max(1e5, twAgeAtX(x[1]));
  const oldest = Math.min(EARTH_AGE, x[0] > 0 ? twAgeAtX(x[0]) : EARTH_AGE);
  if (youngest >= oldest || concordia(youngest, 'tw')[1] > y[1] || concordia(oldest, 'tw')[1] < y[0]) return null;

  // The common inverse U/Pb coordinate is analytic. Pb/Pb is monotone in age,
  // so intersect its display limits by bisection inside the X-axis age range.
  function ageAtY(target: number): number {
    let lo = youngest, hi = oldest;
    if (target <= concordia(lo, 'tw')[1]) return lo;
    if (target >= concordia(hi, 'tw')[1]) return hi;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (concordia(mid, 'tw')[1] < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
  const lo = ageAtY(y[0]), hi = ageAtY(y[1]);
  return lo < hi ? [lo, hi] : null;
}

export function curve(range: [
  number,
  number
], mode: ConcordiaMode, n = 240): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => concordia(range[0] + (range[1] - range[0]) * i / n, mode));
}
export function ageTicks([lo, hi]: [
  number,
  number
]): number[] {
  const raw = (hi - lo) / 6;
  if (raw <= 0 || !Number.isFinite(raw)) return [];
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].find(v => v * p >= raw)! * p;
  const start = Math.ceil(lo / step), end = Math.floor(hi / step);
  return Array.from({ length: Math.min(7, Math.max(0, end - start + 1)) }, (_, i) => (start + i) * step);
}
export const CI = { La: 0.237, Ce: 0.613, Pr: 0.0928, Nd: 0.457, Sm: 0.148, Eu: 0.0563, Gd: 0.199, Tb: 0.0361, Dy: 0.246, Ho: 0.0546, Er: 0.160, Tm: 0.0247, Yb: 0.161, Lu: 0.0246 };
export const CI_LEGEND = 'CI chondrite, McDonough and Sun (1995)';
