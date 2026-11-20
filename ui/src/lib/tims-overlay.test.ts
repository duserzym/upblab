import { expect, it } from 'vitest';
import { overlayBatch, batchAffected } from './tims-overlay';
import { timsBatch } from '../../tests/fixtures/review';
import type { OutboxEntry } from './outbox.svelte';
const entry = (path: string, body: unknown, method: 'PATCH' | 'PUT' = 'PATCH'): OutboxEntry => ({ id: path, server: 'synthetic', accountId: 'synthetic', objectKey: 'batch:batch-synthetic', createdAt: '2026-11-06', method, path, body, attempts: 0, idempotencyKey: 'fixed', lastError: null, stopped: false, nextAttempt: 0 });
it('refreshes only chemistry records used by this batch', () => {
  for (const key of ['batch:batch-synthetic', 'fraction:fraction-z1', 'capsule_set:set-k', 'spike_version:synthetic-version']) expect(batchAffected(timsBatch, key)).toBe(true);
  for (const key of ['recipe:other', 'batch:other', 'fraction:other', 'capsule_set:other', 'spike_version:other']) expect(batchAffected(timsBatch, key)).toBe(false);
});
it('overlays batch, fraction, step, capsule, version and order edits without changing the GET', () => {
  const before = structuredClone(timsBatch);
  const result = overlayBatch(timsBatch, [
    entry('/v1/tims/batches/batch-synthetic', { notes: 'Saved locally' }),
    entry('/v1/fractions/fraction-z1', { capsule_number: 3 }),
    entry('/v1/tims/capsule-sets/set-k', { name: 'Krogh K' }),
    entry('/v1/tims/batches/batch-synthetic/steps/ca-step', { parameters: { temperature_c: 200 } }),
    entry('/v1/tims/spikes/versions/synthetic-version', { status: 'current', notes: 'Local' }),
    entry('/v1/tims/batches/batch-synthetic/steps/order', { step_ids: ['spike-step', 'diss-step', 'ca-step'] }, 'PUT'),
  ]);
  expect(timsBatch).toEqual(before);
  expect(result.batch.notes).toBe('Saved locally');
  expect(result.batch.capsule_map['1']).toBeNull(); expect(result.batch.capsule_map['3']).toBe('fraction-z1');
  expect(result.batch.capsule_set.name).toBe('Krogh K');
  expect(result.batch.steps.map(s => [s.id, s.ordinal])).toEqual([['spike-step', 1], ['diss-step', 2], ['ca-step', 3]]);
  expect(result.batch.steps[2].parameters).toEqual({ temperature_c: 200 });
  expect(result.batch.spike_versions['synthetic-version'].is_current).toBe(true);
  expect(result.changedFields).toContain('batch.notes'); expect(result.changedFields).toContain('steps.order');
});
it('preserves omitted record fields on PUT, upserts additions, and retains subsequent local edits in order', () => {
  const result = overlayBatch(timsBatch, [
    entry('/v1/tims/batches/batch-synthetic/fractions/fraction-z1/steps/ca-step', { skipped: true }, 'PUT'),
    entry('/v1/tims/batches/batch-synthetic/fractions/fraction-z1/steps/spike-step/spike', { spike_weight_g: '0.000125' }, 'PUT'),
    entry('/v1/tims/batches/batch-synthetic', { notes: 'first' }), entry('/v1/tims/batches/batch-synthetic', { notes: 'second' }),
  ]).batch;
  expect(result.fraction_step_records).toHaveLength(1);
  expect(result.fraction_step_records[0]).toMatchObject({ parameters: { temperature_c: 180 }, skipped: true, outcome: 'dissolved_in_ca', outcome_note: 'Synthetic recorded outcome' });
  expect(result.spikes[0]).toMatchObject({ spike_version_id: 'synthetic-version', spike_weight_g: '0.000125' });
  expect(result.notes).toBe('second');
});
