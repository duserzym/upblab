import { QUANTITIES } from './geochem';
export type Mineral = 'Zircon' | 'Apatite' | 'Rutile' | 'Titanite' | 'Monazite';
export const MINERALS: Mineral[] = ['Zircon', 'Apatite', 'Rutile', 'Titanite', 'Monazite'];
export interface Panel { id: string; type: 'biplot' | 'ree'; x: string; y: string; logX: boolean; logY: boolean }
let serial = 0;
export function panel(x: string, y: string, logX = false, logY = false): Panel {
  return { id: `panel-${++serial}`, type: 'biplot', x, y, logX, logY };
}
const ree = (): Panel => ({ ...panel('La', 'Ce'), type: 'ree' });
// Grimes et al. (2015), doi:10.1007/s00410-015-1199-3: zircon U/Yb diagrams.
// Hoskin (2005), doi:10.1016/j.gca.2004.09.006: zircon normalised Sm/La vs La.
// Apatite Sr/Y vs REE follows the provenance approach of O'Sullivan et al.
// (2020); ΣREE+Y is explicitly labelled and is not silently treated as LREE.
// Meinhold et al. (2008), doi:10.1016/j.earscirev.2008.07.001: rutile Cr–Nb.
export function preset(mineral: Mineral): Panel[] {
  if (mineral === 'Zircon') return [panel('preferred_date', 'Th/U'), panel('Th', 'U'), panel('Eu/Eu*', 'Ce/Ce*'), panel('preferred_date', 'Ti-in-zircon T'), panel('preferred_date', 'Yb/Gd'), panel('preferred_date', 'Hf'), panel('Nb/Yb', 'U/Yb', true, true), panel('Y', 'U/Yb', true, true), panel('La', '(Sm/La)N', true, true), ree()];
  if (mineral === 'Apatite') return [ree(), panel('ΣREE+Y', 'Sr/Y', true, true), panel('Ce/Ce*', 'Eu/Eu*'), panel('Y', 'Sr'), panel('Sr', 'Mn'), panel('ΣREE+Y', '(La/Sm)N', true, true), panel('preferred_date', 'Th/U'), panel('Th', 'U')];
  if (mineral === 'Rutile') return [panel('preferred_date', 'Zr'), panel('Nb', 'Cr', true, true), panel('Zr/Hf', 'Nb/Ta', true, true), panel('preferred_date', 'U'), panel('preferred_date', 'Th/U'), panel('V', 'Fe'), panel('preferred_date', 'Zr-in-rutile T')];
  if (mineral === 'Titanite') return [ree(), panel('preferred_date', 'Th/U'), panel('Th', 'U'), panel('Zr', 'Y'), panel('Ce/Ce*', 'Eu/Eu*'), panel('Nb/Ta', 'Lu/Hf')];
  return [ree(), panel('preferred_date', 'Th/U'), panel('Th', 'U'), panel('Ce/Ce*', 'Eu/Eu*'), panel('Y', 'Th'), panel('preferred_date', 'U')];
}
export const MAX_PANELS = 12;
/** A preset fills the board in one click; its full list fits under MAX_PANELS. */
export function applyPreset(mineral: Mineral): Panel[] {
  return preset(mineral).slice(0, MAX_PANELS);
}
export function mineralFor(material: string | undefined): Mineral { return MINERALS.find(m => material?.toLowerCase().includes(m.toLowerCase())) ?? 'Zircon'; }
export function gridColumns(width: number): 2 | 3 { return width >= 880 ? 3 : 2; }
export const BOARD_KEY = 'upbstudio.review.geochem.v1';
export type Boards = Partial<Record<Mineral, Panel[]>>;
const known = new Set(QUANTITIES.map(q => q.id));
const validAxis = (id: unknown): id is string => typeof id === 'string' && (known.has(id) || id.startsWith('stored:') && id.length < 200);
export function parseBoards(raw: string | null): Boards {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Boards = {};
    for (const m of MINERALS) {
      const list: unknown = (value as Record<string, unknown>)[m];
      if (!Array.isArray(list) || list.length > MAX_PANELS) continue;
      if (!list.every(p => p && typeof p === 'object' && ['biplot', 'ree'].includes(p.type) && validAxis(p.x) && validAxis(p.y) && typeof p.logX === 'boolean' && typeof p.logY === 'boolean')) continue;
      out[m] = list.map(p => ({ ...panel(p.x, p.y, p.logX, p.logY), type: p.type }));
    }
    return out;
  } catch { return {}; }
}
export function loadBoards(): Boards { try { return parseBoards(localStorage.getItem(BOARD_KEY)); } catch { return {}; } }
export function saveBoards(boards: Boards): void { try { localStorage.setItem(BOARD_KEY, JSON.stringify(boards)); } catch { /* Views work with storage disabled. */ } }
/** null = all samples; [] = deliberately empty. */
export function sampleSelection(current: string[] | null, names: string[], action: 'all' | 'clear' | 'click', name = '', modifier = false): string[] | null {
  if (action === 'all') return null;
  if (action === 'clear') return [];
  if (!modifier) return [name];
  const selected = current ?? names;
  return selected.includes(name) ? selected.filter(s => s !== name) : [...selected, name];
}
