import { describe, expect, it } from 'vitest';
import { batch as fixture } from '../../tests/fixtures/tims';
import { emptySelection, selectAll, selectCapsule, selectPuck, mixed, groupValue, bulkPayload, groupPreview, undoPayload, groupRevision, type BulkResult } from './tims-group';
const order = Array.from({ length: 15 }, (_, i) => i + 1);
const batch = () => structuredClone(fixture);

describe('capsule selection', () => {
  it('plain click selects one, replacing previous selection', () => {
    expect(selectCapsule(selectAll(order), 3, order)).toEqual({ positions: [3], anchor: 3 });
  });
  it('Cmd/Ctrl and Space toggle, preserving puck order', () => {
    let selection = selectCapsule(emptySelection(), 3, order);
    selection = selectCapsule(selection, 1, order, 'toggle');
    expect(selection.positions).toEqual([1, 3]);
    expect(selectCapsule(selection, 3, order, 'toggle').positions).toEqual([1]);
  });
  it('Shift-click and Shift+arrows extend in either direction from a stable anchor', () => {
    const start = selectCapsule(emptySelection(), 5, order);
    const extended = selectCapsule(start, 2, order, 'range');
    expect(extended).toEqual({ positions: [2, 3, 4, 5], anchor: 5 });
    expect(selectCapsule(extended, 6, order, 'range').positions).toEqual([5, 6]);
  });
  it('Shift without an anchor selects one', () => {
    expect(selectCapsule(emptySelection(), 8, order, 'range').positions).toEqual([8]);
  });
  it('selects the focused puck and all assigned positions, and clears', () => {
    expect(selectPuck(9, 5, order).positions).toEqual([6, 7, 8, 9, 10]);
    expect(selectPuck(9, 5, [1, 6, 9, 11]).positions).toEqual([6, 9]);
    expect(selectAll(order).positions).toEqual(order);
    expect(emptySelection()).toEqual({ positions: [], anchor: null });
  });
});
describe('group drafts and preview', () => {
  it('detects mixed scalar, boolean, null and parameter values', () => {
    expect(mixed(['a', 'b'])).toBe(true);
    expect(mixed([false, true])).toBe(true);
    expect(mixed([null, undefined])).toBe(false);
    expect(mixed([{ temperature: 900 }, { temperature: 900 }])).toBe(false);
    expect(mixed([])).toBe(false);
  });
  it('reads effective overrides and legacy capsule dates', () => {
    const b = batch(), f = b.fractions[0], step = b.steps[0];
    b.fraction_step_records = [{ ...f, id: 'record', fraction_id: f.id, step_id: step.id, parameters: { temperature_c: 200 }, skipped: false, outcome: '', outcome_note: 'Note\n\nPerformed on (capsule): 2026-11-25' }];
    expect(groupValue(b, f, 'step_record', step)).toMatchObject({ performed_on: '2026-11-25', parameters: { temperature_c: 200 } });
    b.fraction_step_records[0].performed_on = null;
    expect(groupValue(b, f, 'step_record', step).performed_on).toBe(step.performed_on);
  });
  it('builds a partial payload with target row timestamps and no Mixed placeholders', () => {
    const b = batch(), step = b.steps[0];
    const body = bulkPayload(b, b.fractions, 'step_record', step, { performed_on: '2026-11-27' });
    expect(body).toEqual({ target: 'step_record', step_id: step.id, fraction_ids: b.fractions.map(f => f.id), set: { performed_on: '2026-11-27' }, expected: Object.fromEntries(b.fractions.map(f => [f.id, groupRevision(b, f.id, 'step_record', step.id)])) });
    expect(body.set).not.toHaveProperty('parameters');
  });
  it('requires explicit batch default and includes its revision', () => {
    const b = batch(), step = b.steps[0];
    expect(bulkPayload(b, b.fractions, 'step_record', step, { parameters: { temperature_c: 900 } }, true)).toMatchObject({ batch_default: true, expected_step: step.updated_at });
  });
  it('previews differing values and identifies lost capsules', () => {
    const b = batch(), step = b.steps[0];
    b.fractions[0].status = 'picked'; b.fractions[1].status = 'lost';
    step.performed_on = '2026-11-20'; b.fraction_step_records = [];
    expect(groupPreview(b, b.fractions, 'step_record', step, { performed_on: '2026-11-27' })).toBe('Apply to 1 capsule: performed on → 2026-11-27; 1 capsule already had a different value (K1); 1 capsule lost or dissolved in CA and skipped (K2)');
  });
  it('previews a registered spike name and touched parameter', () => {
    const b = batch();
    expect(groupPreview(b, [], 'spike', b.steps[0], { spike_version_id: 'v' }, { v: 'ET535 v3' })).toContain('spike → ET535 v3');
    expect(groupPreview(b, [], 'step_record', b.steps[0], { parameters: { temperature_c: 900 } })).toContain('temperature c → 900');
  });
  it('undo uses server previous values and the revision returned by that edit', () => {
    const b = batch(), step = b.steps[0], f = b.fractions[0];
    const input = bulkPayload(b, [f], 'fraction', undefined, { notes: 'new' });
    const result: BulkResult = { batch: b, previous: { [f.id]: { notes: 'old' } }, previous_default: null, skipped_fraction_ids: [] };
    const newer = batch(); newer.fractions[0].updated_at = '2026-12-01T00:00:00Z';
    expect(undoPayload({ input, result }, newer)).toEqual({ target: 'fraction', fraction_ids: [f.id], set: {}, expected: { [f.id]: f.updated_at }, restore: { [f.id]: { notes: 'old' } } });
    const defaultResult = { ...result, previous_default: { parameters: step.parameters } };
    expect(undoPayload({ input: { ...input, target: 'step_record', step_id: step.id }, result: defaultResult }, b)).toMatchObject({ restore_default: defaultResult.previous_default, expected_step: step.updated_at });
  });
  it('shows human comments while preserving note metadata for the server', () => {
    const b = batch(), f = b.fractions[0], step = b.steps[0];
    f.notes = '[UPb Lab capsule: lab-blank]\n\nShared comment';
    expect(groupValue(b, f, 'fraction').notes).toBe('Shared comment');
    b.fraction_step_records = [{ ...f, id: 'record', fraction_id: f.id, step_id: step.id, parameters: {}, skipped: false, outcome: '', outcome_note: 'Step comment\n\nPerformed on (capsule): 2026-11-25\n\nColumn protocol (edited)\nSynthetic protocol' }];
    expect(groupValue(b, f, 'step_record', step).outcome_note).toBe('Step comment');
  });
  it('uses the pending record revision until a real addition exists', () => {
    const b = batch(), f = b.fractions[0], step = b.steps.find(s => s.method_code === 'SP-TIMS-SPIKE')!;
    b.spikes = []; b.fraction_step_records = [{ ...f, id: 'pending', updated_at: '2026-11-27T12:00:00Z', fraction_id: f.id, step_id: step.id, parameters: {}, skipped: false, outcome: '', outcome_note: '', spike_metadata: { spike_version_id: 'v', weighed_by_name: 'Synthetic' } }];
    expect(groupRevision(b, f.id, 'spike', step.id)).toBe('2026-11-27T12:00:00Z');
    expect(groupValue(b, f, 'spike', step)).toMatchObject({ spike_version_id: 'v', weighed_by_name: 'Synthetic' });
  });
});
