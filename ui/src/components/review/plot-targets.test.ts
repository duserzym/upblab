import { expect, it, vi } from 'vitest';
import { normalise } from '../../lib/review-data';
import { reconcileTargets, type PointTarget } from './plot-targets';

const targets = (n: number) => Array.from({ length: n }, (_, i) => ({ spot: normalise({ acquisition_id: String(i), label: `Invented ${i}` }), x: i, y: i * 2 }));
it('moves 2000 targets in one pass while retaining their list, records and focus identity', () => {
  const previous = targets(2000), place = vi.fn();
  const result = reconcileTargets(previous, previous.map(t => ({ ...t, x: t.x + 5, y: t.y - 3 })), place);
  expect(result).toBe(previous); expect(place).toHaveBeenCalledTimes(2000);
  result.forEach((target, i) => { expect(target).toBe(previous[i]); expect(target.x).toBe(i + 5); });
  place.mockClear();
  expect(reconcileTargets(result, result.map(t => ({ ...t })), place)).toBe(result);
  expect(place).not.toHaveBeenCalled();
});
it('only changes membership/order/metadata when needed, and only places changed positions', () => {
  const previous = targets(6), place = vi.fn();
  const next: PointTarget[] = [previous[3], { ...previous[0], x: 20 }, { ...previous[2], spot: { ...previous[2].spot, label: 'Updated' } }];
  const result = reconcileTargets(previous, next, place);
  expect(result).not.toBe(previous); expect(result[0]).toBe(previous[3]); expect(result[1]).toBe(previous[0]);
  expect(result[2]).not.toBe(previous[2]); expect(result[2].spot.label).toBe('Updated');
  expect(place).toHaveBeenCalledTimes(1); expect(place).toHaveBeenCalledWith(result[1]);
  expect(reconcileTargets(result, [], place)).toEqual([]);
});
