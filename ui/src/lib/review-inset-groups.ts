import type { ReviewSpotGroup } from '@lab/bridge';
import { groupSpots, type ReviewSpot } from './review-data';

/** Presentation only: group the already shown rows, following the layer tree's sample order. */
export function reviewInsetGroups(shown: ReviewSpot[], groupView: boolean, order: string[],
  color: (name: string) => string): Record<string, ReviewSpotGroup[]> | undefined {
  if (!groupView) return undefined;
  const ranks = new Map(order.map((key, index) => [key, index]));
  const groups = groupSpots(shown).sort((a, b) => (ranks.get(a.key) ?? Infinity) - (ranks.get(b.key) ?? Infinity));
  const projects = new Map<string, ReviewSpotGroup[]>();
  for (const group of groups) {
    const spots = new Map<string, Set<string>>();
    for (const row of group.grains.flatMap(grain => grain.spots)) {
      if (!row.atlasProjectId || !row.atlasSpotId) continue;
      let ids = spots.get(row.atlasProjectId);
      if (!ids) spots.set(row.atlasProjectId, ids = new Set());
      ids.add(row.atlasSpotId);
    }
    for (const [project, ids] of spots) {
      let entries = projects.get(project);
      if (!entries) projects.set(project, entries = []);
      entries.push({ name: group.name, color: color(group.name), spots: [...ids].sort() });
    }
  }
  return Object.fromEntries([...projects].sort(([a], [b]) => a.localeCompare(b)));
}
