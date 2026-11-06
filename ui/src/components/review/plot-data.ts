import { number, type ReviewSpot } from '../../lib/review-data';
import { ellipse, type Point } from '../../lib/concordia';
export interface Mark {
  spot: ReviewSpot;
  point?: Point;
  path?: (Point | null)[];
  polygon?: Point[];
}
export interface Guide {
  path: Point[];
  label?: string;
  point?: Point;
}
export interface Band {
  upper: (Point | null)[];
  lower: (Point | null)[];
  color: string;
}
const palette = ['#4477aa', '#cc6677', '#228833', '#aa4499', '#bb7700', '#009988', '#7777bb', '#aa6633'];
export function color(sample: string): string {
  let h = 0;
  for (const c of sample)
    h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
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
