import { expect, it } from 'vitest';
import { normalise } from './review-data';
import { groupUnregistered, rangeSelection } from './review-selection';

it('selects ranges in display order and supports additive ranges and toggles', () => {
  const ordered = ['a', 'b', 'c', 'd'];
  expect(rangeSelection(['a'], ordered, 'd', 'b', { shiftKey: true, ctrlKey: false, metaKey: false })).toEqual(['b','c','d']);
  expect(rangeSelection(['a'], ordered, 'd', 'c', { shiftKey: true, ctrlKey: true, metaKey: false })).toEqual(['a','c','d']);
  expect(rangeSelection(null, ordered, 'b', null, { shiftKey: false, ctrlKey: false, metaKey: true })).toEqual(['a','c','d']);
});

it('groups mixed-case names while retaining labels and registered spellings', () => {
  const rows = [
    normalise({ label: 'Tu7-b_2' }),
    normalise({ label: 'TU7-b_8', sample_name: 'TU7-b' }),
    normalise({ label: 'New_subsample_30' }),
    normalise({ label: 'NEW_subsample_31' }),
    normalise({ label: 'unknown' }),
  ];
  expect(groupUnregistered(rows).map(row => row.sampleName)).toEqual(['TU7-b','TU7-b','New_subsample','New_subsample','No sample']);
  expect(rows[0].label).toBe('Tu7-b_2');
});
