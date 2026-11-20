import type { Mineral, RecipeStep } from './tims-api';
// Source: upbdb service/apps/tims/seed.py recipe_defaults(), with ANNEAL/CA
// defaults from service/apps/methodcodes/migrations/0003_tims_codes.py (BSU guidebook).
export function recipeDefaults(mineral: Mineral): RecipeStep[] {
  const step = (code: string, parameters = {}) => ({ method_code: `SP-TIMS-${code}`, parameters });
  const spike = step('SPIKE'), load = step('LOAD');
  const hf = step('DISS', { acid: '29 M HF', temperature_c: 220, duration_h: 48 });
  const chloride = step('CHLOR', { acid: '6 M HCl', temperature_c: 180, duration_h: 12 });
  const hbr = step('COL', { scheme: 'HBr-HCl', loading_acid: '1 M HBr' });
  if (mineral === 'zircon') return [step('ANNEAL', { temperature_c: 900, duration_h: 60 }),
    step('CA', { acid: '29 M HF', temperature_c: 190, duration_h: 12, vessel: 'Parr' }), step('LEACH'), spike, hf, chloride,
    step('COL', { scheme: 'HCl anion', loading_acid: '3 M HCl' }), load];
  if (mineral === 'titanite' || mineral === 'rutile') return [step('WASH'), spike, hf, chloride, hbr, load];
  if (['apatite', 'monazite', 'xenotime'].includes(mineral)) return [spike, step('DISS', { acid: '6 M HCl', temperature_c: 180, duration_h: 48 }), hbr, load];
  return [];
}
export const bsuDefaults = [['Becquerel', 'B'], ['Curie', 'C'], ['Holmes', 'H'], ['Wilson', 'W'], ['Krogh', 'K'], ['Aston', 'A'], ['Nier', 'N'], ['Ussher', 'U'], ['Rutherford', 'R'], ['Soddy', 'S']].map(([name, code]) => ({ name, code }));
/** Existing names or occupied codes always win, including inactive sets. */
export const missingBsuDefaults = (existing: { name: string; code: string }[]) => bsuDefaults.filter(d => !existing.some(e => e.name.toLowerCase() === d.name.toLowerCase() || e.code.toLowerCase() === d.code.toLowerCase()));
