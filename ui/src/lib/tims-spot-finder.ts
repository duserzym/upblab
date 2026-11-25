import { firstPage } from './tims-api';
import type { MountGeometry } from './tims-geometry';
import { mountElements } from './tims-requests';
import { buildSpotSearchIndex, searchSpots, type SpotSearchIndex, type SpotSearchMatch } from './tims-spot-search';

export interface PickerMount {
  id: string; label: string; atlas: { project_id: string } | null;
  grain_count?: number; sample_count?: number; sample_names?: string[];
  projects?: (string | { name?: string; code?: string; id?: string })[];
  mineral?: string | null; magnification?: number | string | null;
  last_changed_at?: string | null; content_revision?: number | string | null;
}
export interface FoundMount { mount: PickerMount; geometry: MountGeometry; matches: SpotSearchMatch[] }
export interface SpotMountSearch { matches: FoundMount[]; errors: string[]; checked: number; hasMore: boolean }
const indexes = new WeakMap<MountGeometry, SpotSearchIndex>();
/** Element snapshots are already scoped and cleared by the shared geometry cache. */
export function mountSpotIndex(geometry: MountGeometry): SpotSearchIndex {
  let index = indexes.get(geometry);
  if (!index) { index = buildSpotSearchIndex(geometry); indexes.set(geometry, index); }
  return index;
}

/** One bounded sample lookup and at most five shared element reads, only on submit. */
export async function findSpotMounts(query: string, sampleQuery: string, publish: (result: SpotMountSearch) => void, current: () => boolean): Promise<SpotMountSearch> {
  const found = new Map<string, FoundMount>(), errors: string[] = [], seen = new Set<string>(), cursors = new Set<string>();
  let checked = 0, hasMore = false;
  const result = (): SpotMountSearch => ({ matches: [...seen].flatMap(id => found.has(id) ? [found.get(id)!] : []), errors: [...errors], checked, hasMore });
  let page = await firstPage<PickerMount>('/v1/mounts', { limit: '5', q: sampleQuery });
  while (current()) {
    const candidates = page.items.filter(mount => !seen.has(mount.id)).slice(0, 5 - seen.size);
    for (const mount of candidates) seen.add(mount.id);
    hasMore = !!page.nextCursor || page.items.length > candidates.length;
    await Promise.all(candidates.map(async mount => {
      try {
        const geometry = await mountElements(mount.id);
        if (!current()) return;
        const matches = searchSpots(mountSpotIndex(geometry), query).filter(match => match.spotNames.length);
        if (matches.length) found.set(mount.id, { mount, geometry, matches });
      } catch (error) {
        if (current()) errors.push(`${mount.label}: ${String(error)}`);
      } finally {
        if (current()) { checked++; publish(result()); }
      }
    }));
    if (!current() || seen.size >= 5 || !page.nextCursor) break;
    if (cursors.has(page.nextCursor)) throw new Error('The server repeated a list cursor.');
    cursors.add(page.nextCursor);
    const next = await page.more();
    if (!next) break;
    page = next;
  }
  return result();
}
