import { expect, it } from 'vitest';
import { normalise } from '../../lib/review-data';
import { markBounds } from './plot-bounds';
import { ratioMarks } from './plot-data';

it('preserves polygon Fit all bounds and the large-uncertainty outlier rule', () => {
  for (const mode of ['wetherill', 'tw'] as const) {
    const [x, y] = mode === 'tw' ? ['238U/206Pb', '207Pb/206Pb'] : ['207Pb/235U', '206Pb/238U'];
    const marks = ratioMarks(Array.from({ length: 3000 }, (_, i) => normalise({
      acquisition_id: String(i), [x]: 10 + i / 100, [y]: 20 + i / 100,
      [x + '_2e']: i === 100 ? 1000 : 2, [y + '_2e']: i === 100 ? 1000 : 3,
      err_corr: (i % 19 - 9) / 10, tw_rho: (i % 19 - 9) / 10,
    })), mode);
    const polygonBounds = markBounds(marks.map(m => ({ ...m, ellipse: undefined })), [], false, false);
    const analyticBounds = markBounds(marks, [], false, false);
    expect(analyticBounds).toEqual(polygonBounds);
    for (const logX of [false, true]) for (const logY of [false, true]) expect(markBounds(marks, [], logX, logY)).toEqual(markBounds(marks.map(m => ({ ...m, ellipse: undefined })), [], logX, logY));
  }
});
it('does not request the lazy polygon on linear axes', () => {
  const [mark] = ratioMarks([normalise({ '207Pb/235U': 10, '206Pb/238U': 20, '207Pb/235U_2e': 2, '206Pb/238U_2e': 3 })], 'wetherill');
  const bounds = markBounds([{ ...mark, get polygon(): never { throw new Error('eager polygon'); } }], [], false, false);
  expect(bounds).toEqual({ x: [7.68, 12.32], y: [16.52, 23.48] });
});
it('retains empty bounds, null path gaps and positive filtering on logarithmic axes', () => {
  const empty = { x: [0, 10] as [number, number], y: [0, 20] as [number, number] };
  expect(markBounds([], [], false, false, empty)).toBe(empty);
  expect(markBounds([{ spot: normalise({}), path: [[-1, 2], null, [10, 20], [100, 200]] }], [], true, true)).toEqual({ x: [10 / 10 ** 0.08, 100 * 10 ** 0.08], y: [20 / 10 ** 0.08, 200 * 10 ** 0.08] });
});
