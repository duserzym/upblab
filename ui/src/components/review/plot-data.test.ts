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
