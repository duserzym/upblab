import { describe, expect, it } from 'vitest';
import { assignSampleColors, color, isotopeLabel } from './plot-data';

describe('sample colours', () => {
  it('gives every sample of a scope its own colour, in name order', () => {
    // These two names hash to the same palette entry.
    assignSampleColors(['HJ-gc1', 'AH1-gc1', 'Skin-mafic', 'Skin-felsic', 'HJ-gc1']);
    const colours = ['AH1-gc1', 'HJ-gc1', 'Skin-felsic', 'Skin-mafic'].map(color);
    expect(new Set(colours).size).toBe(4);
    expect(color('AH1-gc1')).toBe('#4477aa');
  });
  it('falls back to a stable colour for names outside the scope', () => {
    assignSampleColors([]);
    expect(color('Other')).toBe(color('Other'));
  });
});

it('superscripts isotope masses without changing unrelated numbers', () => {
  expect(isotopeLabel('207Pb/235U')).toBe('²⁰⁷Pb/²³⁵U');
  expect(isotopeLabel('204Pb_corrected_206Pb/238U_age')).toBe('²⁰⁴Pb_corrected_²⁰⁶Pb/²³⁸U_age');
  expect(isotopeLabel('20 µm · 18 points · 12000 Ma')).toBe('20 µm · 18 points · 12000 Ma');
});

import { ratioMarks } from './plot-data';
import { normalise } from '../../lib/review-data';
it('reuses stored ellipse geometry per spot/diagram and invalidates changed values', () => {
  const spot = normalise({ '207Pb/235U': 10, '206Pb/238U': 20, '207Pb/235U_2e': 2, '206Pb/238U_2e': 3, err_corr: 0.5, '238U/206Pb': 5, '207Pb/206Pb': 0.05 });
  const [mark] = ratioMarks([spot], 'wetherill');
  expect(mark.ellipse).toMatchObject({ centre: [10, 20], a: [2, 1.5] });
  expect(Object.getOwnPropertyDescriptor(mark, 'polygon')?.get).toBeTypeOf('function');
  ratioMarks([spot], 'tw');
  expect(ratioMarks([spot], 'wetherill')[0]).toBe(mark);
  expect(mark.polygon).toBe(mark.polygon);
  spot.values['206Pb/238U'] = 21;
  expect(ratioMarks([spot], 'wetherill')[0]).not.toBe(mark);
  expect(mark.point).toEqual([10, 20]);
});
