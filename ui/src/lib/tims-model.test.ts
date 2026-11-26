import { expect, it } from 'vitest';
import { batchQuery, choices, effectiveParameters, emptyBatchFilters, historyChanges, parameterDefinitions, parameterValue, planSentence, planSummary, preferenceKey, reorder, withDefaults, validateParameters } from './tims-model';
import type { ParameterDefinition, PickNotePlan } from './tims-api';
it('models typed controls without losing numeric choice types, units, scope or outcomes', () => {
  const defs: ParameterDefinition[] = [{ name: 'n', type: 'integer', required: true, min: 1, max: 5, default: 2, unit: 'h' }, { name: 'time', type: 'choice', choices: [60, 48] }, { name: 'acid', type: 'multi_choice', choices: ['HF', { value: 'HCl', label: 'Chloride' }] }, { name: 'weight', scope: 'fraction' }, { name: 'outcome', role: 'outcome' }];
  expect(parameterDefinitions(defs).map(d => d.name)).toEqual(['n', 'time', 'acid']); expect(parameterDefinitions(defs, true).map(d => d.name)).toContain('weight');
  expect(choices(defs[2])[1]).toEqual({ value: 'HCl', label: 'Chloride' }); expect(parameterValue(defs[1], '48')).toBe(48);
  expect(parameterValue(defs[0], '')).toBeUndefined(); expect(withDefaults(defs, { n: 4 })).toEqual({ n: 4 });
  expect(validateParameters(defs.slice(0, 1), {})).toHaveLength(1); expect(validateParameters(defs.slice(0, 1), {}, true)).toEqual([]);
  for (const n of [0, 6, 2.5, NaN, '2']) expect(validateParameters(defs, { n })).not.toEqual([]);
  expect(validateParameters(defs, { n: 3, time: 48, acid: ['HCl'] })).toEqual([]);
  expect(validateParameters(defs, { n: 3, time: '48', acid: ['invented'] })).toHaveLength(2);
});
it('merges effective parameters with explicit overrides including zero and empty values', () => {
  const batch = { temperature_c: 190, duration_h: 12, note: 'batch' };
  expect(effectiveParameters(batch, { parameters: { duration_h: 0, note: '' } })).toEqual([{ key: 'temperature_c', value: 190, overridden: false }, { key: 'duration_h', value: 0, overridden: true }, { key: 'note', value: '', overridden: true }]); expect(batch.duration_h).toBe(12);
});
it('maps only selected filters to query params and partitions preferences by account/server', () => {
  expect(batchQuery('lab', { ...emptyBatchFilters(), started_after: '2026-11-01', status: 'picked' })).toEqual({ lab: 'lab', started_after: '2026-11-01', status: 'picked', order: '-started_on', limit: '200' });
  expect(batchQuery('lab', emptyBatchFilters(), { order: 'started_on', active_after: '2026-10-01' })).toEqual({ lab: 'lab', order: 'started_on', active_after: '2026-10-01', limit: '200' });
  expect(preferenceKey('https://one.example', 'a')).not.toBe(preferenceKey('https://one.example', 'b'));
});
it('summarises only new picks, preserves refused lines and ignores reused batches', () => {
  const line = (number: number, status: string, resolved = {}, kind = 'pick') => ({ number, status, resolved, kind });
  const plan = { lines: [line(1, 'ok', { grain: { id: 'invented' } }), line(2, 'ok'), line(3, 'ok', { fraction_id: 'existing', grain: { id: 'old' } }), line(4, 'refused'), line(5, 'ok', {}, 'date')], batches: [{ action: 'create' }, { action: 'reuse' }] } as PickNotePlan;
  expect(planSummary(plan)).toEqual({ batches: 1, fractions: 2, sources: 1, refused: 1 }); expect(planSentence(plan)).toBe('1 batch, 2 fractions, 1 source');
});
it('reorders without mutating and describes actual history values while identifying missing server fields', () => {
  const rows = ['a', 'b', 'c']; expect(reorder(rows, 1, -1)).toEqual(['b', 'a', 'c']); expect(reorder(rows, 0, -1)).toEqual(rows); expect(rows).toEqual(['a', 'b', 'c']);
  expect(historyChanges({ before: { status: 'picked', notes: 'old' }, after: { status: 'picked', notes: 'new' } })).toEqual(['notes: old → new']);
  expect(historyChanges({ actor: 'Invented' })[0]).toContain('did not supply');
});
