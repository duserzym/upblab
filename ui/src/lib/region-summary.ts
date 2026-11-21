import type { ViewerRegionEvent } from '@lab/bridge';
import type { SessionOut } from './overview.svelte';
import { grainFractions, indexFractions, isPlucked, type ReviewSpot } from './review-data';
import type { FractionOut } from './tims-api';

export type ViewerRegion = ViewerRegionEvent & { source: 'images' | 'header' };
export const regionLabel = (region: ViewerRegionEvent) => region.sample ?? region.areaLabel ?? 'Whole mount';
const physical = (row: ReviewSpot) => row.spotId ?? row.atlasSpotId;
const grain = (row: ReviewSpot) => row.grainId ?? row.grainLabel;
const validDate = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

const localDate = (value: string | null): string => {
  if (!value) return 'date not loaded';
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/** Joins stored metadata only. Linear in rows, sessions and fraction sources. */
export function regionSummary(region: ViewerRegionEvent, mountRows: readonly ReviewSpot[], sessions: readonly SessionOut[], fractions: readonly FractionOut[]) {
  const ids = new Set(region.spots.map(id => id.toLowerCase()));
  const rows = region.kind === 'mount' ? mountRows : mountRows.filter(row => row.atlasSpotId && ids.has(row.atlasSpotId.toLowerCase()));
  const matchedBySample = region.kind === 'sample' && ids.size > 0 && rows.length === 0;
  const members = matchedBySample ? mountRows.filter(row => row.sampleName.toLowerCase() === region.sample?.toLowerCase()) : rows;
  const index = indexFractions(fractions);
  const grains = new Set<string>(), spots = new Set<string>(), analysed = new Set<string>(), plucked = new Set<string>();
  const known = new Map(sessions.map(session => [session.id, session]));
  const measured = new Map<string, { id: string; key: string; startedAt: string | null; spots: Set<string> }>();
  for (const row of members) {
    const g = grain(row), s = physical(row);
    if (g) { grains.add(g); if (isPlucked(row, index)) plucked.add(g); }
    if (s) spots.add(s);
    if (!row.acquisitionId) continue;
    if (s) analysed.add(s);
    if (!row.sessionId) continue;
    const session = known.get(row.sessionId);
    let entry = measured.get(row.sessionId);
    const storedDate = validDate(row.values.session_started_at);
    if (!entry) {
      entry = { id: row.sessionId, key: row.sessionKey ?? session?.session_key ?? row.sessionId,
        startedAt: storedDate ?? validDate(session?.started_at), spots: new Set() };
      measured.set(row.sessionId, entry);
    } else if (storedDate) entry.startedAt = storedDate;
    if (s) entry.spots.add(s);
  }
  return {
    grains: grains.size, spots: spots.size, analysed: analysed.size, plucked: plucked.size, matchedBySample,
    sessions: [...measured.values()].sort((a, b) => (b.startedAt ? Date.parse(b.startedAt) : -Infinity) - (a.startedAt ? Date.parse(a.startedAt) : -Infinity) || a.key.localeCompare(b.key))
      .map(session => ({ id: session.id, key: session.key, date: localDate(session.startedAt), spots: session.spots.size })),
    fractions: grainFractions(members, index),
  };
}

/** The dock receives this presentation from Review, never reads its data itself. */
export function imagesTitle(label: string | null | undefined, rows: readonly ReviewSpot[]) {
  if (!label) return { label: '', samples: '', text: 'SEM images', full: 'SEM images' };
  const unknowns = new Set<string>(), references = new Set<string>();
  for (const row of rows) {
    if (row.sampleName && row.sampleName !== 'No sample') (row.isReference ? references : unknowns).add(row.sampleName);
  }
  const names = [...(unknowns.size ? unknowns : references)];
  const samples = names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
  const full = `Mount ${label}${unknowns.size ? `: ${[...unknowns].join(', ')}` : ''}${references.size ? `${unknowns.size ? '; ' : ': '}standards ${[...references].join(', ')}` : ''}`;
  return { label, samples, text: `SEM images · ${label}${samples ? ` · ${samples}` : ''}`, full };
}

export function imageMount(
  status: { project: string | null; mount: string | null; name: string | null } | null,
  fallback: { project?: string | null; mount: string | null }, rows: readonly ReviewSpot[],
  mounts: readonly { id: string; label: string; project?: string | null }[],
) {
  const row = status?.project ? rows.find(row => row.atlasProjectId === status.project) : undefined;
  const known = status ? mounts.find(mount => mount.id === status.mount || !!status.project && mount.project === status.project) : undefined;
  const reported = !!(row || known);
  const mount = reported ? status?.mount ?? row?.mountId ?? known?.id ?? null : fallback.mount;
  const project = reported ? status?.project ?? null : fallback.project ?? null;
  const label = mounts.find(item => item.id === mount && item.label)?.label || (reported ? status?.name : null) || '';
  return { mount, project, ...imagesTitle(label, rows.filter(row => row.mountId === mount)) };
}
