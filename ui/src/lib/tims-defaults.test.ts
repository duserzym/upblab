import { expect, it } from 'vitest';
import { bsuDefaults, missingBsuDefaults, recipeDefaults } from './tims-defaults';
it('matches the guidebook step lists and explicit defaults without sharing mutable values', () => {
  const z = recipeDefaults('zircon');
  expect(z.map(s => s.method_code.replace('SP-TIMS-', ''))).toEqual(['ANNEAL', 'CA', 'LEACH', 'SPIKE', 'DISS', 'CHLOR', 'COL', 'LOAD']);
  expect(z[0].parameters).toEqual({ temperature_c: 900, duration_h: 60 }); expect(z[1].parameters).toMatchObject({ acid: '29 M HF', temperature_c: 190, duration_h: 12 });
  expect(z[4].parameters).toEqual({ acid: '29 M HF', temperature_c: 220, duration_h: 48 }); expect(z[5].parameters).toEqual({ acid: '6 M HCl', temperature_c: 180, duration_h: 12 });
  for (const m of ['titanite', 'rutile'] as const) { const r = recipeDefaults(m); expect(r.map(s => s.method_code.replace('SP-TIMS-', ''))).toEqual(['WASH', 'SPIKE', 'DISS', 'CHLOR', 'COL', 'LOAD']); expect(r[4].parameters).toMatchObject({ scheme: 'HBr-HCl' }); }
  for (const m of ['apatite', 'monazite', 'xenotime'] as const) { const r = recipeDefaults(m); expect(r.map(s => s.method_code.replace('SP-TIMS-', ''))).toEqual(['SPIKE', 'DISS', 'COL', 'LOAD']); expect(r[1].parameters).toEqual({ acid: '6 M HCl', temperature_c: 180, duration_h: 48 }); }
  z[0].parameters.temperature_c = 1; expect(recipeDefaults('zircon')[0].parameters.temperature_c).toBe(900); expect(recipeDefaults('other')).toEqual([]);
});
it('offers missing BSU defaults in spelling/order and never changes existing or conflicting sets', () => {
  expect(bsuDefaults.map(s => `${s.name} ${s.code}`)).toEqual(['Becquerel B', 'Curie C', 'Holmes H', 'Wilson W', 'Krogh K', 'Aston A', 'Nier N', 'Ussher U', 'Rutherford R', 'Soddy S']);
  const existing = [{ name: 'krogh', code: 'Custom' }, { name: 'Custom', code: 'b' }];
  expect(missingBsuDefaults(existing).map(s => s.code)).toEqual(['C', 'H', 'W', 'A', 'N', 'U', 'R', 'S']); expect(existing[0].code).toBe('Custom');
});
