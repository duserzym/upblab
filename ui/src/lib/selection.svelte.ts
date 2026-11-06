import type { SpotSelectedEvent } from '@lab/bridge';

/** Most recent module selection, ready for the Review tab. */
class Selection {
  fromImages = $state<(SpotSelectedEvent & { at: number }) | null>(null);
}

export const selection = new Selection();
