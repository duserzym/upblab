import { spotGroupKey, type ReviewSpot } from './review-data';

interface Sample { key: string; reference: boolean }

export function defaultShown(samples: Sample[]): string[] {
  const regular = samples.filter(sample => !sample.reference);
  return (regular.length ? regular : samples).map(sample => sample.key);
}

export function toggleSample(shown: string[], ordered: string[], key: string): string[] {
  const next = new Set(shown);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return ordered.filter(key => next.has(key));
}

export function soloSample(key: string): string[] { return [key]; }
export function allShown(ordered: string[]): string[] { return [...ordered]; }
export function noneShown(): string[] { return []; }

export function setGroup(shown: string[], samples: Sample[], reference: boolean, on: boolean): string[] {
  const selected = new Set(shown);
  return samples.filter(sample => sample.reference === reference ? on : selected.has(sample.key)).map(sample => sample.key);
}

/** The clicked chip's new state applies to the entire inclusive range. */
export function rangeToggle(shown: string[], ordered: string[], from: string | null, to: string): string[] {
  const start = from === null ? -1 : ordered.indexOf(from), end = ordered.indexOf(to);
  if (start < 0 || end < 0) return toggleSample(shown, ordered, to);
  const next = new Set(shown), on = !next.has(to);
  for (const key of ordered.slice(Math.min(start, end), Math.max(start, end) + 1)) {
    if (on) next.add(key);
    else next.delete(key);
  }
  return ordered.filter(key => next.has(key));
}

export function groupState(shown: string[], samples: Sample[], reference: boolean): 'all' | 'none' | 'some' {
  const entries = samples.filter(sample => sample.reference === reference), selected = new Set(shown);
  const count = entries.filter(sample => selected.has(sample.key)).length;
  return !count ? 'none' : count === entries.length ? 'all' : 'some';
}

export function reconcile(remembered: string[] | undefined, ordered: string[], samples: Sample[]): string[] {
  const selected = new Set(remembered ?? defaultShown(samples));
  return ordered.filter(key => selected.has(key));
}

export function filterRows(rows: ReviewSpot[], shown: string[]): ReviewSpot[] {
  const selected = new Set(shown);
  return rows.filter(row => selected.has(spotGroupKey(row)));
}

// Display filters live only for this app session, separately for each grouping mode.
const memory = new Map<string, string[]>();
export function rememberShown(scopeKey: string, shown: string[]): void { memory.set(scopeKey, [...shown]); }
export function recallShown(scopeKey: string): string[] | undefined { return memory.get(scopeKey)?.slice(); }
