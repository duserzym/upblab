import type { MountOut, MountRow, SessionRow } from './overview.svelte';

/** Large inventories are explicitly expandable; ordinary inventories are complete. */
export function capInventory<T>(items: T[]): T[] {
  return items.slice(0, 500);
}

export type Sort = 'newest' | 'oldest' | 'az' | 'za';
export const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

function select<T>(rows: T[], query: string, sort: Sort, name: (r: T) => string, fields: (r: T) => string, date: (r: T) => string | null): T[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return rows.filter(r => words.every(word => fields(r).toLocaleLowerCase().includes(word))).sort((a, b) => {
    if (sort === 'az' || sort === 'za') return name(a).localeCompare(name(b), undefined, { numeric: true }) * (sort === 'az' ? 1 : -1);
    // Undated items stay last for both directions. Names break ties consistently.
    const ad = Date.parse(date(a) ?? ''), bd = Date.parse(date(b) ?? '');
    if (!Number.isFinite(ad) || !Number.isFinite(bd)) return Number.isFinite(ad) ? -1 : Number.isFinite(bd) ? 1 : name(a).localeCompare(name(b));
    return (ad - bd) * (sort === 'oldest' ? 1 : -1) || name(a).localeCompare(name(b));
  });
}

export function sessionsShown(rows: SessionRow[], query: string, sort: Sort): SessionRow[] {
  return select(rows, query, sort, r => r.session.session_key,
    r => [r.session.session_key, r.session.material, r.session.analyst, r.session.instrument?.name].join(' '), r => r.session.started_at);
}

export function mineralKey(material: string) {
  return material.trim().toLowerCase() || 'unspecified';
}

export function sessionsByMineral(rows: SessionRow[]) {
  const groups = new Map<string, SessionRow[]>();
  for (const row of rows) {
    const mineral = mineralKey(row.session.material);
    const group = groups.get(mineral);
    if (group) group.push(row);
    else groups.set(mineral, [row]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}

/** Mounts have no creation date in the list API; UUIDv7 preserves creation order. */
export function newestMounts(rows: MountOut[]): MountOut[] {
  return rows.every(r => /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.id))
    ? [...rows].sort((a, b) => b.id.localeCompare(a.id)) : rows;
}

export function mountsShown(rows: MountRow[], query: string, sort: Sort, atlases = false): MountRow[] {
  return select(atlases ? rows.filter(r => r.atlas && r.atlas !== 'error') : rows, query, sort,
    r => atlases && r.atlas && r.atlas !== 'error' ? r.atlas.name ?? r.mount.label : r.mount.label,
    r => [r.mount.label, r.mount.mount_type, atlases && r.atlas && r.atlas !== 'error' ? r.atlas.name : ''].join(' '),
    r => r.atlas && r.atlas !== 'error' ? r.atlas.publishedAt : null);
}

export function runStatus(row: SessionRow): { tone: 'ok' | 'warning' | 'text-faint'; text: string } {
  if (row.detailsPending) return { tone: 'text-faint', text: row.runs === null ? 'loading reductions…' : `${row.runs} run${row.runs === 1 ? '' : 's'} · loading reductions…` };
  if (row.runs === null) return { tone: 'text-faint', text: 'reductions unavailable' };
  if (!row.runs) return { tone: 'text-faint', text: 'not reduced' };
  if (row.latest && ['failed', 'running', 'pending', 'queued'].includes(row.latest.status))
    return { tone: 'warning', text: `${row.latest.status} · ${row.runs} run${row.runs === 1 ? '' : 's'}` };
  if (!row.preferred) return { tone: 'warning', text: `${row.runs} run${row.runs === 1 ? '' : 's'}, none preferred` };
  const r = row.preferred;
  return { tone: 'ok', text: `preferred · ${r.pipeline_name} ${r.pipeline_version}${r.completed_at ? ` · ${day(r.completed_at)}` : ` · ${r.status}`}` };
}

export function kindSegments(count: number, maximum: number, counts?: Record<string, number> | null) {
  const width = maximum > 0 ? Math.min(100, Math.max(0, count) / maximum * 100) : 0;
  const entries = Object.entries(counts ?? {}).filter(([, n]) => Number.isFinite(n) && n > 0);
  const classified = entries.reduce((sum, [, n]) => sum + n, 0);
  if (classified < count) entries.push(['unclassified', count - classified]);
  const total = Math.max(count, classified);
  if (!total) return [];
  let x = 0;
  return entries.map(([kind, n]) => {
    const segment = { kind, count: n, x, width: width * n / total };
    x += segment.width;
    return segment;
  });
}
export const spotKinds = [
  ['sample', 'Sample'], ['primary_standard', 'Primary standard'],
  ['secondary_standard', 'Secondary standard'], ['blank', 'Blank'], ['tune', 'Tune'],
  ['unclassified', 'Unclassified'],
] as const;
export const kindLabel = (kind: string) => spotKinds.find(([key]) => key === kind)?.[1] ?? kind.replaceAll('_', ' ');
export const kindColor = (kind: string) =>
  spotKinds.some(([key]) => key === kind && key !== 'unclassified') ? `var(--kind-${kind})` : 'var(--text-faint)';

/** Only bundle-relative image files; never let a manifest redirect the access token. */
export function thumbnailPaths(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  // grainatlas writes `files` as a list of { path, sha256, size }; an object keyed by path is read too.
  const files = (body as { files?: unknown }).files;
  if (!files || typeof files !== 'object') return [];
  const listed = Array.isArray(files)
    ? files.map(f => (f && typeof f === 'object' ? (f as { path?: unknown }).path : null)).filter((p): p is string => typeof p === 'string')
    : Object.keys(files);
  const paths = listed.filter(p => !/[\\:?#]/.test(p) && !p.startsWith('/') &&
    !p.split('/').some(s => s === '..' || s === '.' || /%/i.test(s)) && /\.(webp|png|jpe?g)$/i.test(p));
  const overview = paths.find(p => /(?:^|\/)(?:thumbnail|overview)\.(webp|png|jpe?g)$/i.test(p));
  if (overview) return [overview];

  // GrainAtlas starts at z=0 (full size) and downsamples to one tile per area.
  const areas = new Map<string, { z: number; path: string }>();
  for (const path of paths) {
    const tile = path.match(/^pyramid\/([^/]+)\/(\d+)\/0_0\.(webp|png|jpe?g)$/i);
    if (!tile) continue;
    const [, area, level] = tile;
    const z = Number(level);
    if (z > (areas.get(area)?.z ?? -1)) areas.set(area, { z, path });
  }
  return [...areas.keys()].sort().map(area => areas.get(area)!.path);
}
export function atlasFileUrl(server: string, project: string, path: string, access: string): string {
  return `${server.replace(/\/+$/, '')}/atlas/projects/${encodeURIComponent(project)}/${path.split('/').map(encodeURIComponent).join('/')}?access=${encodeURIComponent(access)}`;
}
