import { describe, expect, it } from 'vitest';
import { plural } from './plural';

describe('plural', () => {
  it('uses the singular only for exactly one', () => {
    expect(plural(1, 'spot')).toBe('1 spot');
    expect(plural(0, 'spot')).toBe('0 spots');
    expect(plural(2, 'grain')).toBe('2 grains');
  });
  it('keeps thousands separators and an irregular plural', () => {
    expect(plural(123456, 'spot')).toBe('123,456 spots');
    expect(plural(3, 'analysis', 'analyses')).toBe('3 analyses');
  });
});
