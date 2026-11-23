import { grainLabel, mountGrainChoices } from './tims-capsule-import';
import type { MountGeometry, SpotGeometry } from './tims-geometry';

export type GrainChoice = ReturnType<typeof mountGrainChoices>[number];
interface Label { full: string; tokens: string[] }
interface Entry {
  choice: GrainChoice; sample: Label; grain: Label; spots: { name: string; label: Label }[]; tokens: string[];
}
export interface SpotSearchIndex { entries: Entry[]; samples: string[] }
export interface SpotSearchMatch { choice: GrainChoice; spotNames: string[]; rank: number }

export const spotName = (spot: SpotGeometry) => spot.label || spot.name || 'Unnamed spot';
export function grainChoiceLabel(choice: GrainChoice) {
  const names = [...new Set(choice.spots.map(spotName))];
  return names.length ? `${names.join(', ')} · grain ${grainLabel(choice.grain)}` : grainLabel(choice.grain);
}

const number = (token: string) => /^\d+$/.test(token);
function label(value: string): Label {
  const tokens = value.toLowerCase().trim().split(/[_\-\s/.]+/).filter(Boolean)
    .map(token => number(token) ? token.replace(/^0+(?=\d)/, '') : token);
  return { full: tokens.join(' '), tokens };
}
function includes(tokens: string[], query: string[]) {
  return query.every(term => tokens.some(token => number(term) ? number(token) && token === term : !number(token) && token.startsWith(term)));
}

/** Build once for an already loaded snapshot, never on a query change. */
export function buildSpotSearchIndex(mount: MountGeometry): SpotSearchIndex {
  const entries = mountGrainChoices(mount).map(choice => {
    const sample = label(choice.grain.sample ?? ''), grain = label(grainLabel(choice.grain));
    const spots = choice.spots.map(spot => ({ name: spotName(spot), label: label(spotName(spot)) }));
    return { choice, sample, grain, spots, tokens: [...new Set([...sample.tokens, ...grain.tokens, ...spots.flatMap(spot => spot.label.tokens)])] };
  });
  return { entries, samples: [...new Set(entries.map(e => e.choice.grain.sample).filter((s): s is string => !!s))] };
}

/** Stable buckets avoid sorting or rebuilding labels while typing. */
export function searchSpots(index: SpotSearchIndex, query: string, sample = ''): SpotSearchMatch[] {
  const term = label(query), ranks: SpotSearchMatch[][] = [[], [], [], []];
  for (const entry of index.entries) {
    if (sample && entry.choice.grain.sample !== sample || !includes(entry.tokens, term.tokens)) continue;
    const exact = !!term.full && entry.spots.some(spot => spot.label.full === term.full);
    const onSpot = entry.spots.filter(spot => includes(spot.label.tokens, term.tokens));
    const onGrain = includes(entry.grain.tokens, term.tokens) || entry.grain.full === term.full;
    const sampleOnly = includes(entry.sample.tokens, term.tokens);
    const rank = !term.full ? 3 : exact ? 0 : onSpot.length ? 1 : onGrain || !sampleOnly ? 2 : 3;
    ranks[rank].push({ choice: entry.choice, rank, spotNames: entry.spots.filter(spot =>
      includes([...entry.sample.tokens, ...spot.label.tokens], term.tokens)).map(spot => spot.name) });
  }
  return ranks.flat();
}

/** The sample part of SAMPLE_S_195 / SAMPLE-641; local numbers need no mount lookup. */
export function spotMountQuery(query: string, mountOpen: boolean): string | null {
  const trimmed = query.trim();
  // Preserve separators within a sample: the server searches its stored name.
  const sample = trimmed.replace(/[_\-\s/.]+(?:[a-z][_\-\s/.]+)?\d+$/i, '');
  return sample && (!mountOpen || /[a-z]/i.test(sample) && !/^[a-z]$/i.test(sample)) ? sample : null;
}
