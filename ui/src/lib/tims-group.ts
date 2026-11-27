import type { BatchDetail, FractionOut, Parameters, StepOut } from './tims-api';
import { readCapsulePreparation } from './tims-capsule-intake';
import { readCapsuleNotes, readColumnNotes } from './tims-protocol';

export interface Selection { positions: number[]; anchor: number | null }
export const emptySelection = (): Selection => ({ positions: [], anchor: null });
export function selectCapsule(state: Selection, position: number, order: number[], gesture: 'one' | 'toggle' | 'range' = 'one'): Selection {
  if (gesture === 'range' && state.anchor !== null) {
    const a = order.indexOf(state.anchor), b = order.indexOf(position);
    return { positions: order.slice(Math.min(a, b), Math.max(a, b) + 1), anchor: state.anchor };
  }
  const positions = gesture === 'toggle' ? state.positions.includes(position) ? state.positions.filter(n => n !== position) : [...state.positions, position] : [position];
  return { positions: order.filter(n => positions.includes(n)), anchor: gesture === 'toggle' && !positions.includes(position) ? positions.at(-1) ?? null : position };
}
export function selectPuck(position: number, perPuck: number, order: number[]): Selection {
  return { positions: order.filter(n => Math.floor((n - 1) / perPuck) === Math.floor((position - 1) / perPuck)), anchor: position };
}
export function selectAll(order: number[]): Selection { return { positions: [...order], anchor: order[0] ?? null }; }
export const lost = (fraction: FractionOut) => ['lost', 'dissolved_in_ca'].includes(fraction.status);
export type BulkTarget = 'step_record' | 'spike' | 'fraction';
export interface BulkInput {
  target: BulkTarget; step_id?: string; fraction_ids: string[]; set: Parameters;
  expected: Record<string, string | null>; restore?: Record<string, Parameters>;
  batch_default?: boolean; expected_step?: string; restore_default?: Parameters;
}
export interface BulkResult { batch: BatchDetail; previous: Record<string, Parameters>; previous_default: Parameters | null; skipped_fraction_ids: string[] }
export interface UndoEdit { input: BulkInput; result: BulkResult }
export const mixed = (values: unknown[]) => values.length > 1 && values.some(v => JSON.stringify(v ?? null) !== JSON.stringify(values[0] ?? null));
export function groupValue(batch: BatchDetail, fraction: FractionOut, target: BulkTarget, step?: StepOut): Parameters {
  if (target === 'fraction') return { status: fraction.status, notes: readCapsulePreparation(fraction.notes).notes };
  const record = batch.fraction_step_records.find(r => r.fraction_id === fraction.id && r.step_id === step?.id);
  if (target === 'spike') return { ...(record?.spike_metadata ?? {}), ...batch.spikes.find(r => r.fraction_id === fraction.id && r.step_id === step?.id) };
  const legacy = readCapsuleNotes(readColumnNotes(record?.outcome_note ?? '').notes);
  return { performed_at: record?.performed_at ?? null, performed_on: record && Object.hasOwn(record, 'performed_on') ? record.performed_on ?? step?.performed_on : legacy.date || step?.performed_on,
    operator_name: record?.operator_name || batch.operator_name, parameters: { ...step?.parameters, ...record?.parameters },
    skipped: record?.skipped ?? false, outcome: record?.outcome ?? '', outcome_note: legacy.notes };
}
export function groupRevision(batch: BatchDetail, id: string, target: BulkTarget, step?: string): string | null {
  if (target === 'fraction') return batch.fractions.find(f => f.id === id)?.updated_at ?? null;
  return (target === 'spike' ? batch.spikes.find(r => r.fraction_id === id && r.step_id === step)?.updated_at : undefined)
    ?? batch.fraction_step_records.find(r => r.fraction_id === id && r.step_id === step)?.updated_at ?? null;
}
export function bulkPayload(batch: BatchDetail, fractions: FractionOut[], target: BulkTarget, step: StepOut | undefined, touched: Parameters, batchDefault = false): BulkInput {
  return { target, ...(target !== 'fraction' && step ? { step_id: step.id } : {}), fraction_ids: fractions.map(f => f.id), set: structuredClone(touched),
    expected: Object.fromEntries(fractions.map(f => [f.id, groupRevision(batch, f.id, target, step?.id)])),
    ...(batchDefault && step ? { batch_default: true, expected_step: step.updated_at } : {}) };
}
export function undoPayload(edit: UndoEdit, batch: BatchDetail): BulkInput {
  const ids = Object.keys(edit.result.previous);
  return { target: edit.input.target, ...(edit.input.step_id ? { step_id: edit.input.step_id } : {}), fraction_ids: ids, set: {},
    expected: Object.fromEntries(ids.map(id => [id, groupRevision(edit.result.batch, id, edit.input.target, edit.input.step_id)])), restore: edit.result.previous,
    ...(edit.result.previous_default ? { restore_default: edit.result.previous_default, expected_step: edit.result.batch.steps.find(s => s.id === edit.input.step_id)!.updated_at } : {}) };
}
const capsuleCount = (n: number) => `${n} capsule${n === 1 ? '' : 's'}`;
export function groupPreview(batch: BatchDetail, fractions: FractionOut[], target: BulkTarget, step: StepOut | undefined, touched: Parameters, names: Record<string, string> = {}): string {
  const active = fractions.filter(f => !lost(f)), skipped = fractions.filter(lost);
  const fields: [string, unknown][] = Object.entries(touched).flatMap<[string, unknown]>(([key, value]) => key === 'parameters' ? Object.entries(value as Parameters) : [[key, value]]);
  const lines = fields.map(([key, value]) => {
    const differing = active.filter(f => { const current = groupValue(batch, f, target, step); const old = key in (touched.parameters as Parameters ?? {}) ? (current.parameters as Parameters)?.[key] : current[key]; return old !== null && old !== undefined && old !== '' && JSON.stringify(old) !== JSON.stringify(value); });
    return `${({ spike_version_id: 'spike', outcome_note: 'notes' } as Record<string,string>)[key] ?? key.replaceAll('_', ' ')} → ${names[String(value)] ?? (value === null || value === '' ? 'clear' : String(value))}${differing.length ? `; ${capsuleCount(differing.length)} already had a different value (${differing.map(f => f.capsule_label).join(', ')})` : ''}`;
  });
  return `Apply to ${capsuleCount(active.length)}: ${lines.join('; ')}${skipped.length ? `; ${capsuleCount(skipped.length)} lost or dissolved in CA and skipped (${skipped.map(f => f.capsule_label).join(', ')})` : ''}`;
}
