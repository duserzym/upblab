/** Stored results only. These helpers reshape API replies; they never reduce data. */
export type Value = number | string | boolean | null;
export type ResultRow = Record<string, unknown>;
export type ReviewScope = {
  kind: 'session';
  id: string;
  run: string;
} | {
  kind: 'mount';
  id: string;
};
export interface RunBrief {
  run_id: string;
  is_preferred: boolean;
  pipeline_version?: string;
  run_by?: string | null;
  started_at?: string;
}
export interface ResultTable {
  session_id?: string;
  session_key?: string;
  run?: RunBrief | null;
  columns: string[];
  rows: ResultRow[];
}
export interface DepthProfile {
  acquisition_id: string;
  columns: string[];
  data: Record<string, Value[]>;
  run: RunBrief | null;
}
export interface ReviewSpot {
  key: string;
  acquisitionId: string | null;
  spotId: string | null;
  atlasProjectId: string | null;
  atlasSpotId: string | null;
  label: string;
  sampleName: string;
  grainLabel: string | null;
  grainId: string | null;
  mountId: string | null;
  sessionId: string | null;
  sessionKey: string | null;
  runId: string | null;
  kind: string;
  isReference: boolean;
  values: Record<string, Value>;
  flags: string[];
  date: {
    value: number;
    two_sigma: number | null;
    method: string | null;
    passes: boolean | null;
  } | null;
}
export const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null => typeof v === 'string' && v ? v : null;
export const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
export const isReference = (kind: string) => /standard|reference/i.test(kind);
export function normalise(row: ResultRow, table: Partial<ResultTable> = {}): ReviewSpot {
  const values: Record<string, Value> = {};
  for (const [k, v] of Object.entries(row))
    values[k] = typeof v === 'number' ? number(v) : typeof v === 'string' || typeof v === 'boolean' ? v : null;
  // Mount results have a summary shape, including unmeasured spots.
  const date = row.date as {
    value?: unknown;
    two_sigma?: unknown;
    method?: unknown;
    passes?: unknown;
  } | null;
  if (date)
    Object.assign(values, { preferred_date: number(date.value), preferred_date_2e: number(date.two_sigma), preferred_date_method: str(date.method), preferred_date_pass: typeof date.passes === 'boolean' ? date.passes : null });
  for (const group of ['ratios', 'concentrations']) {
    for (const [k, v] of Object.entries((row[group] ?? {}) as Record<string, {
      value?: unknown;
      uncertainty?: unknown;
    }>)) {
      values[k] = number(v?.value);
      values[k + (group === 'ratios' ? '_2e' : '_95CI')] = number(v?.uncertainty);
    }
  }
  if (row.th_u !== undefined)
    values['Th/U'] = number(row.th_u);
  if (row.discordance_percent !== undefined)
    values['disc%'] = number(row.discordance_percent);
  const flags = Array.isArray(row.flags) ? row.flags.filter((v): v is string => typeof v === 'string') : String(row.automatic_flags ?? '').split(';').map(s => s.trim()).filter(Boolean);
  const acquisitionId = str(row.acquisition_id), spotId = str(row.spot_id), atlasSpotId = str(row.atlas_spot_id);
  const value = number(values.preferred_date);
  const kind = str(row.kind) ?? 'sample';
  return {
    key: acquisitionId ?? spotId ?? atlasSpotId ?? String(row.label ?? 'unmeasured'), acquisitionId, spotId,
    atlasProjectId: str(row.atlas_project_id), atlasSpotId, label: str(row.label) ?? spotId ?? 'Unnamed spot',
    sampleName: str(row.sample_name) ?? 'No sample', grainLabel: str(row.grain_label), grainId: str(row.grain_id),
    mountId: str(row.mount_id), sessionId: str(row.session_id) ?? table.session_id ?? null,
    sessionKey: str(row.session_key) ?? table.session_key ?? null, runId: str(row.run_id) ?? table.run?.run_id ?? null,
    kind, isReference: isReference(kind), values, flags,
    date: value === null ? null : { value, two_sigma: number(values.preferred_date_2e), method: str(values.preferred_date_method), passes: typeof values.preferred_date_pass === 'boolean' ? values.preferred_date_pass : null },
  };
}
export interface SpotGroup {
  key: string;
  name: string;
  reference: boolean;
  grains: {
    key: string;
    name: string;
    spots: ReviewSpot[];
  }[];
}
export function groupSpots(rows: ReviewSpot[], text = '', references = false): SpotGroup[] {
  const groups = new Map<string, SpotGroup>();
  const query = text.trim().toLowerCase();
  for (const spot of rows) {
    if (spot.isReference && !references)
      continue;
    if (query && ![spot.label, spot.sampleName, spot.grainLabel, ...spot.flags].join(' ').toLowerCase().includes(query))
      continue;
    const key = `${spot.isReference}:${spot.sampleName}`;
    let sample = groups.get(key);
    if (!sample) {
      sample = { key, name: spot.sampleName, reference: spot.isReference, grains: [] };
      groups.set(key, sample);
    }
    const grainKey = spot.isReference ? 'reference' : `${spot.atlasProjectId ?? ''}:${spot.grainId ?? spot.grainLabel ?? 'none'}`;
    let grain = sample.grains.find(g => g.key === grainKey);
    if (!grain) {
      grain = { key: grainKey, name: spot.isReference ? 'Reference materials' : spot.grainLabel ?? 'No grain', spots: [] };
      sample.grains.push(grain);
    }
    grain.spots.push(spot);
  }
  return [...groups.values()].sort((a, b) => Number(a.reference) - Number(b.reference) || natural(a.name, b.name)).map(g => ({ ...g, grains: g.grains.sort((a, b) => natural(a.name, b.name)).map(grain => ({ ...grain, spots: grain.spots.sort((a, b) => natural(a.label, b.label)) })) }));
}
export function numericColumns(rows: ReviewSpot[]): string[] {
  return [...new Set(rows.flatMap(r => Object.keys(r.values).filter(k => number(r.values[k]) !== null)))].sort(natural);
}
export const uncertaintyColumn = (k: string) => /_(?:1s|2s|2e|2e%|95CI|no_calibration|with_calibration)$/.test(k);
export function profileColumns(profile: DepthProfile): string[] {
  return profile.columns.filter(k => !uncertaintyColumn(k) && !/^(signal_relative_time|Time|time|depth|depth_um)$/i.test(k) && profile.data[k]?.some(v => number(v) !== null));
}
export function dateLabel(spot: ReviewSpot): string {
  if (!spot.date)
    return '—';
  const { value, two_sigma } = spot.date;
  const digits = two_sigma === null || two_sigma >= 2 ? 0 : Math.min(4, Math.max(0, 1 - Math.floor(Math.log10(two_sigma || 1))));
  return `${value.toFixed(digits)}${two_sigma === null ? '' : ` ± ${two_sigma.toFixed(digits)}`}`;
}
export function parseScope(saved: string): ReviewScope | null {
  try {
    const s = JSON.parse(saved);
    return s && typeof s.id === 'string' && (s.kind === 'mount' || s.kind === 'session') ? s.kind === 'session' ? { kind: s.kind, id: s.id, run: typeof s.run === 'string' ? s.run : 'preferred' } : { kind: s.kind, id: s.id } : null;
  }
  catch {
    return null;
  }
}
