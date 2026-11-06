/** Display geometry from stored ratios and uncertainties, never data reduction. */
export const L238 = 1.55125e-10;
export const L235 = 9.8485e-10;
export const U238_U235 = 137.818;
export type Point = [
  number,
  number
];
export type ConcordiaMode = 'wetherill' | 'tw';
export function concordia(t: number, mode: ConcordiaMode = 'wetherill'): Point {
  const a = Math.expm1(L235 * t), b = Math.expm1(L238 * t);
  return mode === 'wetherill' ? [a, b] : [1 / b, a / (U238_U235 * b)];
}
export function ellipse(x: number, y: number, x2s: number, y2s: number, rho = 0, n = 48): Point[] {
  const r = Math.max(-0.999, Math.min(0.999, Number.isFinite(rho) ? rho : 0));
  const phase = Math.acos(r);
  // Include exact extrema as well as the regular polygon vertices.
  const angles = [...Array.from({ length: n }, (_, i) => 2 * Math.PI * i / n), phase, phase + Math.PI].sort((a, b) => a - b);
  const points = angles.map(t => [x + Math.abs(x2s) * Math.cos(t), y + Math.abs(y2s) * (r * Math.cos(t) + Math.sqrt(1 - r * r) * Math.sin(t))] as Point);
  return [...points, points[0]];
}
export function ageRange(points: Point[], mode: ConcordiaMode): [
  number,
  number
] {
  const ages = points.map(([x, y]) => Math.log1p(mode === 'tw' ? 1 / x : y) / L238).filter(t => Number.isFinite(t) && t > 0);
  if (!ages.length)
    return [1e6, 3e9];
  const lo = Math.min(...ages), hi = Math.max(...ages), pad = Math.max((hi - lo) * 0.25, hi * 0.15, 10e6);
  return [Math.max(1e5, lo - pad), Math.max(hi + pad, 1e6)];
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
  const raw = (hi - lo) / 6, p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].find(v => v * p >= raw)! * p;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step)
    ticks.push(t);
  return ticks;
}
export const CI = { La: 0.237, Ce: 0.613, Pr: 0.0928, Nd: 0.457, Sm: 0.148, Eu: 0.0563, Gd: 0.199, Tb: 0.0361, Dy: 0.246, Ho: 0.0546, Er: 0.160, Tm: 0.0247, Yb: 0.161, Lu: 0.0246 };
export const CI_LEGEND = 'CI chondrite, McDonough and Sun (1995)';
