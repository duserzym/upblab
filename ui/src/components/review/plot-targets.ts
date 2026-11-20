import type { ReviewSpot } from '../../lib/review-data';
export interface PointTarget { spot: ReviewSpot; x: number; y: number }
/** Positions are owned by the plot, not by one reactive effect per CSS property.
 * Keep the list and its records when membership/order/metadata have not changed.
 */
export function reconcileTargets(previous: PointTarget[], next: PointTarget[], place: (target: PointTarget) => void): PointTarget[] {
  const byKey = new Map(previous.map(target => [target.spot.key, target]));
  let same = previous.length === next.length;
  const targets = next.map((candidate, i) => {
    const old = byKey.get(candidate.spot.key);
    const target = old?.spot === candidate.spot ? old : candidate;
    const moved = !old || old.x !== candidate.x || old.y !== candidate.y;
    if (target === old) { target.x = candidate.x; target.y = candidate.y; }
    if (moved) place(target);
    if (previous[i] !== target) same = false;
    return target;
  });
  return same ? previous : targets;
}
