import type { SourceInput, SourceOut } from './tims-api';
import type { GrainGeometry, MountGeometry, SpotGeometry } from './tims-geometry';

export function grainLabel(grain: GrainGeometry) {
  return String(grain.label || grain.name || grain.number || grain.grain_number || 'Unnamed grain');
}

export function mountGrainChoices(mount: MountGeometry) {
  const spots = new Map<string, SpotGeometry[]>();
  for (const spot of mount.spots) {
    if (!spot.grain_id || !spot.server_id) continue;
    const group = spots.get(spot.grain_id) ?? [];
    group.push(spot);
    spots.set(spot.grain_id, group);
  }
  return mount.grains.flatMap(grain => {
    if (grain.retired || !grain.server_id || (mount.current_project_uuid && grain.project_uuid && grain.project_uuid !== mount.current_project_uuid)) return [];
    return [{ grain, spots: spots.get(grain.id ?? grain.atlas_grain_id ?? '') ?? spots.get(grain.server_id) ?? [] }];
  });
}

export function grainSources(grain: string, spots: readonly string[], fragmentNote: string): SourceInput[] {
  const fragment = fragmentNote.trim();
  const source = { grain_id: grain, ...(fragment ? { is_fragment: true, fragment_note: fragment } : {}) };
  return spots.length ? [...new Set(spots)].map(spot_id => ({ ...source, spot_id })) : [source];
}

export function missingSpotSources(sources: SourceOut[], grain: GrainGeometry, spots: SpotGeometry[]) {
  const linked = new Set(sources.filter(s => !s.retired_at && s.grain_id === grain.server_id).map(s => s.spot_id));
  return { grainOnly: linked.size === 0, spots: spots.filter(spot => !linked.has(spot.server_id!)) };
}
