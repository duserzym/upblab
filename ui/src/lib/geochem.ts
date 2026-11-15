/** Read-only display quantities. No ages, temperatures or uncertainties are calculated here. */
import { CI } from './concordia';
import { number, type ReviewSpot } from './review-data';

export const GROUPS = ['Dates', 'Concentrations', 'Ratios', 'REE anomalies', 'Thermometers', 'Other'] as const;
export type QuantityGroup = typeof GROUPS[number];
export interface Quantity {
  id: string;
  label: string;
  group: QuantityGroup;
  unit?: string;
  ree?: boolean;
  aliases?: readonly string[];
  derive?: (spot: ReviewSpot) => number | null;
}
export interface AvailableQuantity extends Quantity { available: boolean; derived: boolean }
export const ELEMENTS = 'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U'.split(' ');
export const REE = Object.keys(CI) as (keyof typeof CI)[];
// Pending metric names are returned unchanged by UPbDB. Keep all tolerated
// aliases here, including UPbRPy export_table_spec.md §§2.5–2.7 spellings.
export const ALIASES: Record<string, readonly string[]> = {
  preferred_date: ['preferred date'],
  'Ti-in-zircon T': ['T_Ti_zircon', 'Ti-in-zircon_T', 'Ti_in_zircon_T(C)', 'Ti_in_zircon_T(°C)', 'Ti_in_zircon_thermometry'],
  'Zr-in-rutile T': ['T_Zr_rutile', 'Zr-in-rutile_T', 'Zr_in_rutile_T(C)', 'Zr_in_rutile_T(°C)', 'Zr_in_rutile_thermometry'],
  'Ce/Ce*': ['Ce_anomaly', 'Ce/Ce_star'], 'Eu/Eu*': ['Eu_anomaly', 'Eu/Eu_star'],
  '(Sm/La)N': ['(Sm/La)_N', 'Sm/La_N'], '(Yb/Gd)N': ['(Yb/Gd)_N', 'Yb/Gd_N'],
  '(La/Sm)N': ['(La/Sm)_N', 'La/Sm_N'], '(Gd/Yb)N': ['(Gd/Yb)_N', 'Gd/Yb_N'],
  'ΣREE+Y': ['sum_REE_Y', 'sumREE+Y', 'Sum REE + Y', '∑REE+Y'],
  'ΣREE': ['sum_REE', 'sumREE', '∑REE'],
};
const canonical = (s: string) => s.toLowerCase().replace(/[\s_()°−-]/g, '');
const columnIndexes = new WeakMap<object, Map<string, string>>();
export function storedKey(spot: ReviewSpot, q: Quantity): string | undefined {
  const names = [q.id.startsWith('stored:') ? q.id.slice(7) : q.id, ...(q.aliases ?? ALIASES[q.id] ?? [])];
  // Scope rows are immutable. Index each stored row once: a board can draw
  // hundreds of spots in several panels without scanning every column per axis.
  let index = columnIndexes.get(spot.values);
  if (!index) {
    index = new Map();
    for (const key of Object.keys(spot.values)) {
      const name = canonical(key);
      if (!index.has(name)) index.set(name, key);
    }
    columnIndexes.set(spot.values, index);
  }
  // Prefer the canonical column if both canonical and alias columns exist.
  for (const name of names) {
    const key = index.get(canonical(name));
    if (key !== undefined) return key;
  }
}
export function quantityValue(q: Quantity, spot: ReviewSpot): number | null {
  const key = storedKey(spot, q);
  // A stored null stays null; do not silently replace a missing stored result.
  return key !== undefined ? number(spot.values[key]) : q.derive?.(spot) ?? null;
}
const concentration = (s: ReviewSpot, e: string) => quantityValue({ id: e, label: e, group: 'Concentrations' }, s);
const finite = (v: number) => Number.isFinite(v) ? v : null;
function quotient(a: number | null, b: number | null) { return a !== null && b !== null && b > 0 && a >= 0 ? finite(a / b) : null; }
export function normalized(s: ReviewSpot, e: keyof typeof CI): number | null {
  // Stored normalised columns also win over display normalisation.
  const key = storedKey(s, { id: `${e}_N`, label: e, group: 'Other' });
  if (key !== undefined) return number(s.values[key]);
  const v = concentration(s, e);
  return v !== null && v >= 0 ? v / CI[e] : null;
}
const mass = (a: string, b: string): Quantity => ({ id: `${a}/${b}`, label: `${a}/${b}`, group: 'Ratios', derive: s => quotient(concentration(s, a), concentration(s, b)) });
const normRatio = (a: keyof typeof CI, b: keyof typeof CI): Quantity => ({ id: `(${a}/${b})N`, label: `(${a}/${b})N`, group: 'REE anomalies', derive: s => quotient(normalized(s, a), normalized(s, b)) });
const anomaly = (e: keyof typeof CI, a: keyof typeof CI, b: keyof typeof CI): Quantity => ({
  id: `${e}/${e}*`, label: `${e}/${e}*`, group: 'REE anomalies', derive: s => {
    const x = normalized(s, a), y = normalized(s, b);
    return x !== null && y !== null && x > 0 && y > 0 ? quotient(normalized(s, e), Math.sqrt(x * y)) : null;
  },
});
function sum(s: ReviewSpot, elements: string[]) {
  const values = elements.map(e => concentration(s, e));
  // Missing elements are not zero; a partial sum would be misleading.
  return values.every((v): v is number => v !== null && v >= 0) ? finite(values.reduce((a, b) => a + b, 0)) : null;
}
export const QUANTITIES: Quantity[] = [
  { id: 'preferred_date', label: 'Preferred date', group: 'Dates', unit: 'Ma' },
  ...['206Pb/238U', '207Pb/206Pb', '207Pb/235U', '208Pb/232Th'].map(r => ({ id: `${r}_age`, label: `${r} date`, group: 'Dates' as const, unit: 'Ma' })),
  ...ELEMENTS.map(e => ({ id: e, label: e, group: 'Concentrations' as const, unit: 'ppm', ree: REE.includes(e as keyof typeof CI) })),
  ...['207Pb/235U', '206Pb/238U', '238U/206Pb', '207Pb/206Pb', '208Pb/232Th', '206Pb/204Pb', '206Pb/208Pb'].map(id => ({ id, label: id, group: 'Ratios' as const })),
  ...['Th/U', 'U/Yb', 'Yb/Gd', 'Nb/Yb', 'Th/Y', 'Lu/Hf', 'Nb/Ta', 'Zr/Hf', 'Sr/Y', 'Ce/Yb', 'Gd/Yb', 'Nb/U', 'Nb/Th', 'Hf/Y', 'Nb/P', 'Ce/P', 'Dy/Yb', 'Ce/U'].map(r => { const [a, b] = r.split('/'); return mass(a, b); }),
  anomaly('Ce', 'La', 'Pr'), anomaly('Eu', 'Sm', 'Gd'), normRatio('Sm', 'La'), normRatio('Yb', 'Gd'), normRatio('La', 'Sm'), normRatio('Gd', 'Yb'),
  { id: 'ΣREE+Y', label: 'ΣREE+Y', group: 'REE anomalies', unit: 'ppm', derive: s => sum(s, [...REE, 'Y']) },
  // ΣREE is stored-only: the display exception explicitly permits ΣREE+Y.
  { id: 'ΣREE', label: 'ΣREE', group: 'REE anomalies', unit: 'ppm' },
  { id: 'Ti-in-zircon T', label: 'Ti-in-zircon T', group: 'Thermometers', unit: '°C' },
  { id: 'Zr-in-rutile T', label: 'Zr-in-rutile T', group: 'Thermometers', unit: '°C' },
  { id: 'disc%', label: 'Discordance', group: 'Other', unit: '%' },
];
export function catalogue(rows: ReviewSpot[]): AvailableQuantity[] {
  const known = new Set(QUANTITIES.flatMap(q => [q.id, ...(ALIASES[q.id] ?? [])]).map(canonical));
  const extra = [...new Set(rows.flatMap(s => Object.keys(s.values)))].filter(k => !known.has(canonical(k)) && !/(_2e.*|_95ci|_2s|_1s|_session_correction_1s)$/i.test(k) && rows.some(s => number(s.values[k]) !== null));
  const all: Quantity[] = [...QUANTITIES, ...extra.map(id => ({ id: `stored:${id}`, label: id, group: /\//.test(id) ? 'Ratios' as const : 'Other' as const }))];
  return all.map(q => ({
    ...q, available: rows.some(s => quantityValue(q, s) !== null),
    derived: !!q.derive && rows.some(s => storedKey(s, q) === undefined && quantityValue(q, s) !== null),
  }));
}
export function axisLabel(q: AvailableQuantity): string {
  return `${q.label}${q.derived ? ' (from stored ppm)' : ''}${q.unit ? ` (${q.unit})` : ''}`;
}
export function resolveQuantity(id: string, quantities: AvailableQuantity[]): AvailableQuantity {
  return quantities.find(q => q.id === id) ?? { id, label: id.replace(/^stored:/, ''), group: 'Other', available: false, derived: false };
}
