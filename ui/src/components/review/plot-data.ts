import { number, type ReviewSpot } from '../../lib/review-data';
import { ellipse, type Point } from '../../lib/concordia';
export interface Mark {
  spot: ReviewSpot;
  seriesKey?: string;
  point?: Point;
  boxed?: boolean;
  path?: (Point | null)[];
  polygon?: Point[];
}
export interface Guide {
  seriesKey?: string;
  spotKey?: string;
  path: Point[];
  label?: string;
  point?: Point;
}
export interface Band {
  /** The owning sample key/name or depth column, shared with its trace. */
  seriesKey?: string;
  spotKey?: string;
  upper: (Point | null)[];
  lower: (Point | null)[];
  color: string;
}
// Twelve colours that stay apart on white and dark plot surfaces (Tol muted and bright based).
const palette = ['#4477aa', '#cc6677', '#228833', '#aa4499', '#bb7700', '#009988', '#7777bb', '#aa6633', '#d55e00', '#999933', '#117733', '#5aa0c8'];
let assigned = new Map<string, string>();
/**
 * Give the samples of the current scope distinct colours, in name order (a
 * hash of the name let two samples share one). Review calls this whenever its
 * rows change; the chips, legends and every plot then agree.
 */
export function assignSampleColors(names: Iterable<string>): void {
  const sorted = [...new Set(names)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  assigned = new Map(sorted.map((name, i) => [name, palette[i % palette.length]]));
}
export function color(sample: string): string {
  const known = assigned.get(sample);
  if (known) return known;
  let h = 0;
  for (const c of sample)
    h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
/** Format display text without changing stored column keys. */
export function isotopeLabel(label: string): string {
  return label.replace(/(?<![A-Za-z0-9])(\d{2,3})(?=(?:U|Pb|Th)(?![A-Za-z]))/g,
    (_, mass: string) => [...mass].map(digit => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(digit)]).join(''));
}

export function ratioMarks(rows: ReviewSpot[], mode: 'wetherill' | 'tw'): Mark[] {
  const [xk, yk] = mode === 'tw' ? ['238U/206Pb', '207Pb/206Pb'] : ['207Pb/235U', '206Pb/238U'];
  return rows.flatMap(spot => {
    const x = number(spot.values[xk]), y = number(spot.values[yk]);
    if (x === null || y === null)
      return [];
    const ex = number(spot.values[xk + '_2e']), ey = number(spot.values[yk + '_2e']);
    const rho = mode === 'tw' ? number(spot.values.tw_rho) : number(spot.values.err_corr) ?? number(spot.values.err_corr_no_calibration) ?? number(spot.values.err_corr_with_calibration);
    return [{ spot, point: [x, y] as Point, polygon: ex !== null && ey !== null ? ellipse(x, y, ex, ey, rho ?? 0) : undefined }];
  });
}
