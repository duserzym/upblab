import { expect, it } from 'vitest';
import { progressState, segmentedIndex } from './ui-controls';

it('moves and wraps the roving radio index', () => {
  expect(segmentedIndex('ArrowRight', 0, 3)).toBe(1);
  expect(segmentedIndex('ArrowRight', 2, 3)).toBe(0);
  expect(segmentedIndex('ArrowLeft', 0, 3)).toBe(2);
  expect(segmentedIndex('ArrowLeft', 2, 3)).toBe(1);
  expect(segmentedIndex('Home', 2, 3)).toBe(0);
  expect(segmentedIndex('End', 0, 3)).toBe(2);
  expect(segmentedIndex('Tab', 1, 3)).toBeNull();
  expect(segmentedIndex('Enter', 1, 3)).toBeNull();
  expect(segmentedIndex('ArrowRight', 0, 0)).toBeNull();
  expect(segmentedIndex('ArrowLeft', 0, 1)).toBe(0);
});
it('formats progress including unknown, empty and out-of-range values', () => {
  expect(progressState(2, 5, 'capsules')).toEqual({ now: 2, max: 5, percent: 40, caption: '2 of 5 capsules' });
  for (const value of [null, undefined, NaN]) expect(progressState(value, 5, 'capsules')).toEqual({ now: undefined, max: 5, percent: 0, caption: '— of 5 capsules' });
  expect(progressState(0, 0, 'capsules')).toMatchObject({ percent: 0, caption: '0 of 0 capsules' });
  expect(progressState(8, 5, 'capsules')).toMatchObject({ now: 5, percent: 100 });
  expect(progressState(-1, 5, 'capsules').now).toBe(0);
});
