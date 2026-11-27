import { describe, expect, it } from 'vitest';
import type { BatchOut, ScheduleItem } from './tims-api';
import { emptyBatchFilters } from './tims-model';
import { batchEvents, groupSchedule, packScheduleLane, scheduleTitle, stepCode } from './tims-schedule';
const item = (code: string, minerals = ['zircon'], extra: Partial<ScheduleItem> = {}): ScheduleItem => ({ step_id: 'step', method_code: `SP-TIMS-${code}`, step_name: 'Full method name', date: '2026-11-16', capsule_count: 1, minerals, ...extra });
describe('lab step codes', () => {
  it.each([['zircon', 'Z1'], ['apatite', 'A1'], ['rutile', 'R1'], ['titanite', 'T1'], ['garnet', 'G1'], ['baddeleyite', 'B1'], ['monazite', 'M1'], ['xenotime', 'X1'], ['other', 'O1']])('%s dissolution is %s', (mineral, code) => {
    expect(stepCode(item('DISS', [mineral]))).toEqual({ label: code, kind: 'dissolution' });
  });
  it('combines mixed minerals deterministically without assuming zircon for an empty set', () => {
    expect(stepCode(item('DISS', ['apatite', 'zircon', 'apatite'])).label).toBe('Z1/A1');
    expect(stepCode(item('DISS', [])).label).toBe('Dissolution');
  });
  it('uses the recorded CA temperature, including capsule overrides, and omits unknown temperatures', () => {
    expect(stepCode(item('CA', [], { temperature_c: 210 })).label).toBe('CA 210 °C');
    expect(stepCode(item('CA', [], { parameters: { temperature_c: 190 } })).label).toBe('CA 190 °C');
    expect(stepCode(item('CA')).label).toBe('CA');
  });
  it.each([[1, 'HCl'], [2, 'HF'], [3, 'HCl'], [4, 'HF']])('maps P%s to %s only when numbered explicitly', (number, acid) => {
    expect(stepCode(item(`P${number}`))).toEqual({ label: `P${number} ${acid}`, kind: 'cleaning' });
    expect(stepCode(item('WASH', [], { parameters: { cleaning_step: `P${number}` } })).label).toBe(`P${number} ${acid}`);
  });
  it('keeps the Boise nitric wash name and does not invent a cleaning number', () => {
    expect(stepCode(item('WASH', [], { step_name: 'Non-CA wash', parameters: { acid: '3.5 M HNO3' } }))).toEqual({ label: 'Non-CA wash', kind: 'cleaning' });
  });
  it('uses Load and the single Boise conversion code Z2 for all minerals', () => {
    expect(stepCode(item('LOAD')).label).toBe('Load');
    expect(stepCode(item('CHLOR', ['apatite'])).label).toBe('Z2');
  });
  it('shortens unknown names and retains full names for titles', () => {
    expect(stepCode(item('FUTURE', [], { step_name: 'A future method with a very long name' })).label).toBe('A future method with a …');
  });
});
it('groups per-capsule dates separately, combining counts and minerals on the same step/date', () => {
  const items = [item('DISS'), item('DISS', ['apatite']), item('DISS', ['zircon'], { date: '2026-11-17', capsule_count: 9 })];
  const grouped = groupSchedule(items);
  expect(grouped.map(i => [i.date, i.capsule_count, stepCode(i).label])).toEqual([['2026-11-16', 2, 'Z1/A1'], ['2026-11-17', 9, 'Z1']]);
  expect(items[0].capsule_count).toBe(1);
});
it('keeps distinct steps and CA temperatures on the same day separate', () => {
  expect(groupSchedule([item('CA', [], { temperature_c: 190 }), item('CA', [], { temperature_c: 210 }), item('CA', [], { step_id: 'other', temperature_c: 210 })])).toHaveLength(3);
});
const batch = (schedule?: ScheduleItem[]): BatchOut => ({ id: 'batch', capsule_set_id: 'set', started_on: '2025-01-01', schedule } as BatchOut);
it('filters item dates, not batch starts, and honours capsule sets', () => {
  const rows = [batch([item('LOAD'), item('DISS', [], { date: '2026-11-18' })])];
  const window = { start: '2026-11-01', end: '2026-11-30' };
  expect(batchEvents(rows, emptyBatchFilters(), window)).toHaveLength(2);
  expect(batchEvents(rows, { ...emptyBatchFilters(), started_after: '2026-11-18', started_before: '2026-11-18' }, window).map(i => i.label)).toEqual(['Dissolution']);
  expect(batchEvents(rows, { ...emptyBatchFilters(), capsule_set: 'different' }, window)).toEqual([]);
});
it('does not invent steps for an empty schedule and degrades old servers without detail reads', () => {
  const window = { start: '2025-01-01', end: '2025-01-31' };
  expect(batchEvents([batch([])], emptyBatchFilters(), window)).toEqual([]);
  expect(batchEvents([batch()], emptyBatchFilters(), window)[0]).toMatchObject({ legacy: true, label: 'Started' });
});
it('provides full date, step, count and temperature in the title, and packs adjacent lane labels', () => {
  const events = batchEvents([batch([item('CA', [], { temperature_c: 210 }), item('LOAD', [], { date: '2026-11-17', step_id: 'load' })])], emptyBatchFilters(), { start: '2026-11-01', end: '2026-11-30' });
  expect(scheduleTitle(events[0], 'Krogh')).toBe('Krogh · Full method name · 2026-11-16 · 1 capsules · 210 °C');
  expect(packScheduleLane(events, 22).tracks).toBe(2);
});
it('groups thousands of synthetic capsules without any server calls', () => {
  const many = Array.from({ length: 4000 }, (_, i) => item('DISS', ['zircon'], { date: i % 2 ? '2026-11-16' : '2026-11-17' }));
  expect(groupSchedule(many).map(i => i.capsule_count)).toEqual([2000, 2000]);
});
