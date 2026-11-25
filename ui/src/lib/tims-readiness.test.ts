import { expect, it } from 'vitest';
import { batch } from '../../tests/fixtures/tims';
import type { BatchReadiness } from './tims-api';
import { batchReadiness, fractionStatusReadiness, nextIncomplete, timsError } from './tims-readiness';
import { writeCapsulePreparation } from './tims-capsule-intake';

it('uses authoritative server readiness verbatim', () => {
  const readiness: BatchReadiness = {
    capsules: [{ capsule_number: 1, fraction_id: 'invented', capsule_label: 'K1', fraction_name: 'z1', grain: false, spike: false, missing: [] }],
    totals: { capsules: 1, grain: 0, spike: 0, ready: 1, pending: 0 },
  };
  expect(batchReadiness({ ...batch, readiness })).toBe(readiness);
});
it('counts only active mapped fractions, requiring spike rather than grain or chemistry', () => {
  const copy = structuredClone(batch);
  copy.readiness = undefined;
  copy.fractions[0].sources = [];
  copy.fractions[0].status = 'picked';
  copy.fraction_step_records = [];
  const value = batchReadiness(copy);
  expect(value.capsules.map(c => c.capsule_number)).toEqual([1, 2]);
  expect(value.capsules[0]).toMatchObject({ fraction_id: copy.fractions[0].id, capsule_label: 'K1', fraction_name: copy.fractions[0].name, grain: false, spike: false, missing: ['spike'] });
  expect(value.capsules[1]).toMatchObject({ grain: true, spike: true, missing: [] });
  expect(value.totals).toEqual({ capsules: 2, grain: 1, spike: 1, ready: 1, pending: 1 });
  copy.fractions[0].retired_at = '2026-11-24T00:00:00Z';
  copy.capsule_map['3'] = 'unknown-fraction';
  copy.fractions.push({ ...copy.fractions[1], id: 'unmapped-fraction', capsule_number: 4 });
  expect(batchReadiness(copy).capsules.map(c => c.capsule_number)).toEqual([2]);
});
it('reports live sources or explicit TIMS-only and lab blank preparation as grain readiness', () => {
  for (const preparation of ['tims-only', 'lab-blank'] as const) {
    const copy = structuredClone(batch);
    copy.fractions[0].sources = [];
    copy.fractions[0].notes = writeCapsulePreparation(preparation, 'Invented');
    expect(batchReadiness(copy).capsules[0].grain).toBe(true);
  }
  const copy = structuredClone(batch);
  copy.fractions[0].sources.forEach(s => s.retired_at = '2026-11-24T00:00:00Z');
  expect(batchReadiness(copy).capsules[0].grain).toBe(false);
});
it.each(['lost', 'dissolved_in_ca'] as const)('exempts %s capsules without changing grain or spike flags', status => {
  const copy = structuredClone(batch);
  copy.spikes = [];
  copy.fractions.forEach(f => { f.status = status; f.sources = []; });
  const value = batchReadiness(copy);
  expect(value.capsules.every(c => !c.grain && !c.spike && !c.missing.length)).toBe(true);
  expect(value.totals).toEqual({ capsules: 2, grain: 0, spike: 0, ready: 2, pending: 0 });
});
it('requires an addition at a spike step in this batch', () => {
  const copy = structuredClone(batch);
  copy.spikes[0].step_id = copy.steps.find(s => s.method_code !== 'SP-TIMS-SPIKE')!.id;
  expect(batchReadiness(copy).capsules[1]).toMatchObject({ spike: false, missing: ['spike'] });
  copy.spikes[0].step_id = 'another-batch-spike-step';
  expect(batchReadiness(copy).capsules[1].spike).toBe(false);
});
it('next incomplete walks empty grain positions, but only active capsules for spike and review', () => {
  const readiness: BatchReadiness = {
    capsules: [
      { capsule_number: 1, fraction_id: 'f1', grain: true, spike: false, missing: ['spike'] },
      { capsule_number: 3, fraction_id: 'f3', grain: false, spike: false, missing: [] },
      { capsule_number: 4, fraction_id: 'f4', grain: true, spike: true, missing: [] },
    ], totals: { capsules: 3, grain: 2, spike: 1, ready: 2, pending: 1 },
  };
  expect(nextIncomplete(readiness, 1, 'grain', 4)).toBe(2);
  expect(nextIncomplete(readiness, 2, 'grain', 4)).toBe(3);
  expect(nextIncomplete(readiness, 4, 'grain', 4)).toBe(2);
  expect(nextIncomplete(readiness, 1, 'spike', 4)).toBe(3);
  expect(nextIncomplete(readiness, 3, 'spike', 4)).toBe(1);
  expect(nextIncomplete(readiness, 2, 'spike', 4)).toBe(3);
  expect(nextIncomplete(readiness, null, 'spike', 4)).toBe(1);
  expect(nextIncomplete(readiness, 3, 'complete', 4)).toBe(1);
  const complete = { ...readiness, capsules: readiness.capsules.map(c => ({ ...c, grain: true, spike: true, missing: [] })) };
  expect(nextIncomplete(complete, 1, 'spike', 4)).toBeNull();
  expect(nextIncomplete(complete, 1, 'complete', 4)).toBeNull();
  expect(nextIncomplete(complete, 1, 'grain', 4)).toBe(2);
  expect(nextIncomplete(complete, 1, 'grain', 1)).toBeNull();
  const empty = { capsules: [], totals: { capsules: 0, grain: 0, spike: 0, ready: 0, pending: 0 } };
  expect(nextIncomplete(empty, null, 'spike', 4)).toBeNull();
  expect(nextIncomplete(empty, null, 'grain', 4)).toBe(1);
  expect(nextIncomplete(empty, null, 'grain', 0)).toBeNull();
});
it('status prerequisites and known server errors say what to do', () => {
  expect(timsError({ code: 'spike_required' })).toContain('before marking it spiked');
  expect(timsError({ code: 'batch_completed' })).toContain('Reopen');
});
it('keeps status guidance and disabled choices consistent with each capsule’s recorded spike', () => {
  const missing = fractionStatusReadiness(batch.spikes, batch.fractions[0].id);
  expect(missing.message).toContain('Record a spike version and positive weight');
  expect(missing.options.filter(option => option.disabled).map(option => option.value)).toEqual(['spiked', 'dissolved', 'columns', 'loaded', 'measured']);
  const ready = fractionStatusReadiness(batch.spikes, batch.fractions[1].id);
  expect(ready.message).toBe('');
  expect(ready.options.every(option => !option.disabled)).toBe(true);
});
it.each([
  { spike_version_id: '', spike_weight_g: '1' },
  { spike_version_id: 'invented-version', spike_weight_g: '0' },
  { spike_version_id: 'invented-version', spike_weight_g: '-1' },
  { spike_version_id: 'invented-version', spike_weight_g: 'NaN' },
  { spike_version_id: 'invented-version', spike_weight_g: 'Infinity' },
])('rejects an invalid recorded spike for status and batch readiness: %j', fields => {
  const copy = structuredClone(batch);
  copy.spikes = [{ ...copy.spikes[0], ...fields }];
  const state = fractionStatusReadiness(copy.spikes, copy.spikes[0].fraction_id);
  expect(state.message).not.toBe('');
  expect(state.options.find(option => option.value === 'spiked')?.disabled).toBe(true);
  expect(batchReadiness(copy).capsules[1].spike).toBe(false);
});
