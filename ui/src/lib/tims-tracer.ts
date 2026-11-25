import { spikeMassUsed } from './tims-spiking';

export function weighedMass(direct: string, before: string, after: string, bottle: boolean) {
  return bottle ? spikeMassUsed(before, after) : direct.trim();
}
export const spikeWarnings: Record<string, string> = {
  spike_version_not_current: 'The recorded spike version is no longer current.',
  spike_weight_unusual: 'This spike weight is unusual. Check the balance reading and grams.',
  bottle_difference_mismatch: 'The bottle difference does not match the recorded spike weight.',
  readability_missing: 'Balance readability is missing; weight uncertainty is not given.',
};
