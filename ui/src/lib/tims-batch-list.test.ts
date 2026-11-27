import { expect, it } from 'vitest';
import type { BatchOut, CapsuleOut } from './tims-api';
import { emptyBatchFilters } from './tims-model';
import { axisTicks, batchState, batchProgress, batchSamples, batchSetName, packLane, monthGrid, monthWindow, shiftMonth, defaultLaneWindow, extendLaneWindow, barPosition, viewQuery, visibleBatches } from './tims-batch-list';
const row = (id: string, start: string, end?: string): BatchOut => ({ id, started_on: start, capsule_set_id: 'set-a', completed_at: end ?? null } as BatchOut);
const counts = { positions: 15, capsules: 2, grain: 2, spike: 1, ready: 1 };
it('uses only stored completion and readiness for overall state, including degraded replies', () => {
  expect(batchState({})).toEqual({ text: 'Open', tone: 'neutral' });
  expect(batchState({ counts })).toEqual({ text: 'In progress', tone: 'warning' });
  expect(batchState({ counts: { ...counts, ready: 2 } })).toEqual({ text: 'Ready to complete', tone: 'success' });
  expect(batchState({ counts: { ...counts, capsules: 0, ready: 0 } }).text).toBe('Empty');
  expect(batchState({ completed_at: '2026-11-25', counts: { ...counts, capsules: 0 } }).text).toBe('Complete');
});
it('degrades rows without summary fields, samples or catalog names without fetching details', () => {
  const batch = row('a', '2026-11-01');
  expect(batchProgress(batch)).toBe('—'); expect(batchSamples(batch)).toBe('—');
  expect(batchSetName(batch, [])).toBe('Capsule set name unavailable');
  expect(batchSetName(batch, [{ id: 'set-a', name: 'Invented' } as CapsuleOut])).toBe('Invented');
  expect(batchProgress({ ...batch, counts })).toBe('1 of 2 spiked');
  expect(batchSamples({ ...batch, samples: [{ id: 'a', name: 'Synthetic A' }, { id: 'b', name: 'Synthetic B' }] })).toBe('Synthetic A, Synthetic B');
});
it('packs inclusive overlapping ranges deterministically and reuses free tracks', () => {
  const rows = [row('c', '2026-11-11'), row('b', '2026-11-05', '2026-11-10T12:00:00Z'), row('a', '2026-11-01', '2026-11-05')];
  const packed = packLane(rows, '2026-11-25');
  expect(packed.tracks).toBe(2); expect(packed.bars.map(bar => [bar.row.id, bar.track])).toEqual([['a', 0], ['b', 1], ['c', 0]]);
  expect(packed.bars[2].end).toBe('2026-11-25'); expect(rows[0].id).toBe('c');
  expect(packLane([row('future', '2026-12-01')], '2026-11-25').bars[0].end).toBe('2026-12-01');
});
it('builds Mon–Sun month grids across years and leap days without timezone shifts', () => {
  expect(monthGrid('2026-11-25')[0]).toBe('2026-10-26');
  expect(monthGrid('2026-11-25').at(-1)).toBe('2026-12-06');
  expect(monthGrid('2021-02-01')).toHaveLength(28);
  expect(monthGrid('2021-02-01', true)).toHaveLength(42);
  expect(monthGrid('2026-09-01', true)).toHaveLength(42);
  expect(monthWindow('2024-02-20').end).toBe('2024-02-29');
  expect(shiftMonth('2026-12-25', 1)).toBe('2027-01-01');
});
it('extends the drawing window and clips bars to it with an inclusive last day', () => {
  const window = defaultLaneWindow('2026-11-25');
  expect(window).toEqual({ start: '2026-09-30', end: '2026-12-23' });
  expect(axisTicks(window, 'months')).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);
  expect(axisTicks(window, 'weeks').slice(0, 2)).toEqual(['2026-09-30', '2026-10-07']);
  expect(extendLaneWindow(window, -1).start).toBe('2026-09-02');
  expect(extendLaneWindow(window, 1).end).toBe('2027-01-20');
  expect(barPosition('2026-08-01', '2027-02-01', window, 8)).toEqual({ left: 0, width: 85 * 8 });
});
it('intersects month and lane requests with shared filters and bounds older-server scans', () => {
  const filters = { ...emptyBatchFilters(), started_after: '2026-11-10', started_before: '2026-11-20', status: 'picked' };
  const window = monthWindow('2026-11-25');
  expect(viewQuery('lab', filters, 'calendar', window)).toMatchObject({ schedule_after: '2026-11-10', schedule_before: '2026-11-20', order: '-started_on', limit: '200' });
  expect(viewQuery('lab', emptyBatchFilters(), 'lanes', window)).toMatchObject({ schedule_after: '2026-11-01', schedule_before: '2026-11-30' });
  expect(viewQuery('lab', filters, 'calendar', window)).not.toHaveProperty('started_after');
  const rows = [row('old-open', '2026-01-01'), row('old-complete', '2026-01-01', '2026-10-31'), row('nov', '2026-11-01'), row('dec', '2026-12-01')];
  expect(visibleBatches(rows, emptyBatchFilters(), 'lanes', window, '2026-11-25').map(row => row.id)).toEqual(['old-open', 'nov']);
  expect(visibleBatches(rows, emptyBatchFilters(), 'calendar', window, '2026-11-25').map(row => row.id)).toEqual(['nov']);
});
