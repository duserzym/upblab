import type { OutboxEntry } from './outbox.svelte';
import type { BatchDetail, FractionStepRecord, SpikeAddition } from './tims-api';
import { spikeMassUsed } from './tims-spiking';
/** Shared by Review and TIMS so unrelated outbox deliveries never refresh chemistry. */
export function batchAffected(batch: BatchDetail, objectKey: string) {
  return objectKey === `batch:${batch.id}` || objectKey === `capsule_set:${batch.capsule_set_id}` ||
    batch.fractions.some(f => objectKey === `fraction:${f.id}`) ||
    Object.keys(batch.spike_versions).some(id => objectKey === `spike_version:${id}`) ||
    batch.steps.some(s => typeof s.parameters.spike_version === 'string' && objectKey === `spike_version:${s.parameters.spike_version}`);
}
/** Apply exact queued bodies in enqueue order, without mutating the cached GET. */
export function overlayBatch(base: BatchDetail, entries: readonly OutboxEntry[]): { batch: BatchDetail; changedFields: string[] } {
  const batch = structuredClone(base), changed = new Set<string>();
  for (const entry of entries) {
    const path = entry.path.split('?')[0].split('/').map(decodeURIComponent);
    const body = entry.body as Record<string, unknown>;
    const mark = (prefix: string) => Object.keys(body).forEach(field => changed.add(`${prefix}.${field}`));
    if (path[2] === 'fractions' && path[3] && path.length === 4) {
      const fraction = batch.fractions.find(f => f.id === path[3]);
      if (fraction) { Object.assign(fraction, body); mark(`fraction:${fraction.id}`); }
    } else if (path[3] === 'capsule-sets' && path[4] === batch.capsule_set_id) {
      Object.assign(batch.capsule_set, body); mark('capsule_set');
    } else if (path[3] === 'spikes' && path[4] === 'versions' && batch.spike_versions[path[5]]) {
      const version = batch.spike_versions[path[5]]; Object.assign(version, body); version.is_current = version.status === 'current'; mark(`version:${version.id}`);
    } else if (path[3] === 'batches' && path[4] === batch.id) {
      if (path.length === 5) { Object.assign(batch, body); mark('batch'); }
      else if (path[5] === 'steps' && path[6] === 'order') {
        const ids = body.step_ids as string[];
        batch.steps.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)).forEach((s, i) => s.ordinal = i + 1);
        changed.add('steps.order');
      } else if (path[5] === 'steps') {
        const step = batch.steps.find(s => s.id === path[6]); if (step) { Object.assign(step, body); mark(`step:${step.id}`); }
      } else if (path[5] === 'fractions') {
        const fraction_id = path[6], step_id = path[8];
        const common = { id: `local:${entry.id}`, created_at: entry.createdAt, updated_at: entry.createdAt, created_by_id: entry.accountId, fraction_id, step_id };
        if (path[9] === 'spike') {
          const previous = batch.spikes.find(r => r.fraction_id === fraction_id && r.step_id === step_id);
          const spike = { ...common, id: previous?.id ?? common.id, created_at: previous?.created_at ?? common.created_at,
            spike_version_id: String(body.spike_version_id ?? batch.steps.find(s => s.id === step_id)?.parameters.spike_version ?? ''),
            spike_weight_g: String(body.spike_weight_g), bottle_before_g: null, bottle_after_g: null,
            bottle_difference_g: spikeMassUsed(String(body.bottle_before_g ?? ''), String(body.bottle_after_g ?? '')) || null,
            notes: '', warnings: previous?.warnings ?? [], ...body } as SpikeAddition;
          batch.spikes = [...batch.spikes.filter(r => r !== previous), spike]; mark(`spike:${fraction_id}:${step_id}`);
        } else {
          const previous = batch.fraction_step_records.find(r => r.fraction_id === fraction_id && r.step_id === step_id);
          const record = { ...common, parameters: {}, skipped: false, outcome: '', outcome_note: '', ...previous, ...body } as FractionStepRecord;
          batch.fraction_step_records = [...batch.fraction_step_records.filter(r => r !== previous), record]; mark(`record:${fraction_id}:${step_id}`);
        }
      }
    }
  }
  // A capsule move is visible immediately in the map as well as the fraction.
  for (const position of Object.keys(batch.capsule_map)) batch.capsule_map[position] = null;
  for (const fraction of batch.fractions) if (fraction.batch_id === batch.id && fraction.capsule_number !== null && !fraction.retired_at) {
    batch.capsule_map[String(fraction.capsule_number)] = fraction.id;
    fraction.capsule_label = `${batch.capsule_set.code}${fraction.capsule_number}`;
    fraction.capsule_set_name = batch.capsule_set.name;
  }
  return { batch, changedFields: [...changed] };
}
