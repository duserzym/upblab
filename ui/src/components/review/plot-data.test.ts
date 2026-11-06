import { describe, expect, it } from 'vitest';
import { assignSampleColors, color } from './plot-data';

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
