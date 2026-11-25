import type { BatchDetail, BatchReadiness, SpikeAddition } from './tims-api';
import { readCapsulePreparation } from './tims-capsule-intake';
import { fractionStatuses } from './tims-model';

const validSpike = (row: SpikeAddition) => !!row.spike_version_id && Number.isFinite(Number(row.spike_weight_g)) && Number(row.spike_weight_g) > 0;
export function fractionStatusReadiness(spikes: SpikeAddition[], fraction: string) {
  const ready = spikes.some(row => row.fraction_id === fraction && validSpike(row));
  return {
    message: ready ? '' : 'Record a spike version and positive weight before marking this capsule spiked or later.',
    options: fractionStatuses.map(value => ({ value, disabled: requiresSpike(value) && !ready })),
  };
}

/** Server readiness is authoritative; older servers use active capsules from the map. */
export function batchReadiness(batch: BatchDetail): BatchReadiness {
  if (batch.readiness) return batch.readiness;
  const fractions = new Map(batch.fractions.filter(f => !f.retired_at).map(f => [f.id, f]));
  const spikeSteps = new Set(batch.steps.filter(s => s.method_code === 'SP-TIMS-SPIKE').map(s => s.id));
  const spiked = new Set(batch.spikes.filter(s => spikeSteps.has(s.step_id) && validSpike(s)).map(s => s.fraction_id));
  const capsules = Object.entries(batch.capsule_map).flatMap(([position, id]) => {
    const fraction = id ? fractions.get(id) : undefined;
    if (!fraction) return [];
    const grain = !!readCapsulePreparation(fraction.notes).preparation || fraction.sources.some(s => !s.retired_at);
    const spike = spiked.has(fraction.id);
    const missing = spike || ['lost', 'dissolved_in_ca'].includes(fraction.status) ? [] : ['spike'];
    return [{ capsule_number: Number(position), fraction_id: fraction.id, capsule_label: fraction.capsule_label, fraction_name: fraction.name, grain, spike, missing }];
  }).sort((a, b) => a.capsule_number - b.capsule_number);
  return { capsules, totals: {
    capsules: capsules.length, grain: capsules.filter(c => c.grain).length, spike: capsules.filter(c => c.spike).length,
    ready: capsules.filter(c => !c.missing.length).length, pending: capsules.filter(c => c.missing.length).length,
  } };
}
const requiresSpike = (status: string) => ['spiked', 'dissolved', 'columns', 'loaded', 'measured'].includes(status);
export function nextIncomplete(readiness: BatchReadiness, current: number | null, item: 'grain' | 'spike' | 'complete', positions: number) {
  const byPosition = new Map(readiness.capsules.map(row => [row.capsule_number, row]));
  const rows = item === 'grain'
    ? Array.from({ length: positions }, (_, i) => ({ capsule_number: i + 1, incomplete: !byPosition.get(i + 1)?.grain }))
    : readiness.capsules.map(row => ({ capsule_number: row.capsule_number, incomplete: item === 'spike' ? !row.spike : row.missing.length > 0 }));
  rows.sort((a, b) => a.capsule_number - b.capsule_number);
  const next = rows.findIndex(c => c.capsule_number > (current ?? 0));
  const start = next < 0 ? 0 : next;
  for (let offset = 0; offset < rows.length; offset++) {
    const row = rows[(start + offset) % rows.length];
    if (row.incomplete) return row.capsule_number;
  }
  return null;
}
export function timsError(error: unknown): string {
  const { code, status } = (error ?? {}) as { code?: string; status?: number };
  const messages: Record<string, string> = {
    spike_required: 'Record a spike version and positive weight for this capsule before marking it spiked or later.',
    batch_completed: 'This batch is complete. Reopen it before making changes.',
    batch_incomplete: 'The batch is incomplete. Check the missing items for each capsule below.',
  };
  return code && messages[code] ? messages[code] + (status ? ` (Server returned ${status}.)` : '') : String(error);
}
