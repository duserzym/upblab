import { describe, expect, it } from 'vitest';
import { formatSpikeValue, isotopeLabel, subfractionLabel, uncertaintyLabel } from './spike-format';

describe('TIMS reference precision', () => {
  it('retains the decimal place of a short absolute uncertainty', () => {
    expect(formatSpikeValue({ value: 2.4681e-9, uncertainty: 3.7e-12, uncertainty_type: '1sd_abs' })).toEqual({ value: '2.4681 × 10⁻⁹', uncertainty: '3.7 × 10⁻¹²' });
  });
  it('uses the rounded relative uncertainty to locate the value precision', () => {
    expect(formatSpikeValue({ value: 0.873412658204517, uncertainty: 0.0062718345512, uncertainty_type: '1sd_rel_pct' })).toEqual({ value: '0.8734127', uncertainty: '0.00627 %' });
    expect(formatSpikeValue({ value: 213.718406551293, uncertainty: 0.025, uncertainty_type: '1sd_rel_pct' })).toEqual({ value: '213.718', uncertainty: '0.025 %' });
  });
  it('limits values without uncertainties to six figures and respects stored precision', () => {
    expect(formatSpikeValue({ value: 3.0000000004127836e-9 }).value).toBe('3.00000 × 10⁻⁹');
    expect(formatSpikeValue({ value: 0.12 }).value).toBe('0.12');
    expect(formatSpikeValue({ value: 987654.321 }).value).toBe('9.87654 × 10⁵');
  });
  it('handles zero values, zero or untyped uncertainties, negatives and the three-figure floor', () => {
    expect(formatSpikeValue({ value: 0, uncertainty: 0, uncertainty_type: '1sd_abs' })).toEqual({ value: '0', uncertainty: '0' });
    expect(formatSpikeValue({ value: -12.34567, uncertainty: 9.8, uncertainty_type: '2sd_abs' }).value).toBe('-12.3');
    expect(formatSpikeValue({ value: 12.34567, uncertainty: 0, uncertainty_type: '1sd_abs' }).value).toBe('12.3457');
    expect(formatSpikeValue({ value: 12.34567, uncertainty: 0.01 }).value).toBe('12.3457');
  });
  it('handles rounding carries and notation boundaries consistently', () => {
    expect(formatSpikeValue({ value: 0.001 }).value).toBe('0.001');
    expect(formatSpikeValue({ value: 0.0001 }).value).toBe('1 × 10⁻⁴');
    expect(formatSpikeValue({ value: 12.345678, uncertainty: 0.09999, uncertainty_type: '1sd_abs' })).toEqual({ value: '12.346', uncertainty: '0.100' });
    expect(formatSpikeValue({ value: 99999.999 }).value).toBe('1.00000 × 10⁵');
    expect(formatSpikeValue({ value: Number.MIN_VALUE, uncertainty: 0.01, uncertainty_type: '1sd_rel_pct' }).value).toBe('5 × 10⁻³²⁴');
  });
  it('shows exact stored strings in full precision, including missing and zero uncertainties', () => {
    expect(formatSpikeValue({ value: 0.876543219876, uncertainty: 0.006789123, uncertainty_type: '2sd_rel_pct' }, true)).toEqual({ value: '0.876543219876', uncertainty: '0.006789123 %' });
    expect(formatSpikeValue({ value: 2.0000000003e-10 }, true)).toEqual({ value: '2.0000000003e-10', uncertainty: undefined });
    expect(formatSpikeValue({ value: 0, uncertainty: 0 }, true)).toEqual({ value: '0', uncertainty: '0' });
  });
});
it('uses readable isotope, subfraction and uncertainty labels', () => {
  expect(isotopeLabel('233U/235U')).toBe('²³³U/²³⁵U');
  expect(subfractionLabel('unassigned', 'Internal name')).toBe('Not yet assigned to a bottle or batch');
  expect(['1sd_rel_pct', '2sd_rel_pct', '1sd_abs', '2sd_abs'].map(type => uncertaintyLabel(type as Parameters<typeof uncertaintyLabel>[0]))).toEqual(['1σ %', '2σ %', '1σ', '2σ']);
});
