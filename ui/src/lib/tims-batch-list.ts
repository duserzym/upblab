import type { BatchOut, CapsuleOut } from './tims-api';
import { batchQuery, type BatchFilters } from './tims-model';
import type { ListView } from './tims-guidance';
export type BatchState = { text: string; tone: 'neutral' | 'warning' | 'success' };
/** Display stored readiness only; no chemistry is calculated here. */
export function batchState(batch: Pick<BatchOut, 'completed_at' | 'counts'>): BatchState {
  if (batch.completed_at) return { text: 'Complete', tone: 'success' };
  if (!batch.counts) return { text: 'Open', tone: 'neutral' };
  if (!batch.counts.capsules) return { text: 'Empty', tone: 'neutral' };
  if (batch.counts.ready === batch.counts.capsules) return { text: 'Ready to complete', tone: 'success' };
  return { text: 'In progress', tone: 'warning' };
}
export const batchSetName = (row: BatchOut, sets: CapsuleOut[]) => row.capsule_set_name ?? sets.find(set => set.id === row.capsule_set_id)?.name ?? 'Capsule set name unavailable';
export const batchProgress = (row: BatchOut) => row.counts ? `${row.counts.spike} of ${row.counts.capsules} spiked` : '—';
export const batchSamples = (row: BatchOut) => row.samples?.map(sample => sample.name).join(', ') || '—';
export const hasBatchSummary = (row: BatchOut) => row.counts !== undefined || row.samples !== undefined;
const dayMs = 86_400_000;
export const dateNumber = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / dayMs;
export const addDays = (iso: string, days: number) => new Date((dateNumber(iso) + days) * dayMs).toISOString().slice(0, 10);
export const daysBetween = (start: string, end: string) => dateNumber(end) - dateNumber(start);
export function shiftMonth(iso: string, offset: number) {
  const date = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset); return date.toISOString().slice(0, 10);
}
export function monthWindow(iso: string) { const start = `${iso.slice(0, 7)}-01`; return { start, end: addDays(shiftMonth(start, 1), -1) }; }
export function monthGrid(iso: string, fixedRows = false): string[] {
  const { start, end } = monthWindow(iso);
  const weekday = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7;
  const first = addDays(start, -weekday);
  return Array.from({ length: fixedRows ? 42 : Math.ceil((weekday + Number(end.slice(8))) / 7) * 7 }, (_, i) => addDays(first, i));
}
export interface DateWindow { start: string; end: string }
export function axisTicks(window: DateWindow, zoom: string) {
  if (zoom === 'weeks') return Array.from({ length: Math.ceil((daysBetween(window.start, window.end) + 1) / 7) }, (_, n) => addDays(window.start, n * 7));
  const ticks: string[] = Number(window.start.slice(8)) <= 20 ? [window.start] : [];
  for (let month = shiftMonth(window.start, 1); month <= window.end; month = shiftMonth(month, 1)) ticks.push(month);
  return ticks;
}

export const defaultLaneWindow = (today: string): DateWindow => ({ start: addDays(today, -56), end: addDays(today, 28) });
export const extendLaneWindow = (window: DateWindow, direction: -1 | 1): DateWindow => direction < 0 ? { ...window, start: addDays(window.start, -28) } : { ...window, end: addDays(window.end, 28) };
export const batchEnd = (row: BatchOut, today: string) => (row.completed_at?.slice(0, 10) ?? today) < row.started_on ? row.started_on : row.completed_at?.slice(0, 10) ?? today;
export function packLane(rows: BatchOut[], today: string) {
  const ends: string[] = [];
  const bars = [...rows].sort((a, b) => a.started_on.localeCompare(b.started_on) || a.id.localeCompare(b.id)).map(row => {
    const end = batchEnd(row, today);
    let track = ends.findIndex(last => last < row.started_on);
    if (track < 0) track = ends.length;
    ends[track] = end;
    return { row, start: row.started_on, end, track };
  });
  return { bars, tracks: Math.max(1, ends.length) };
}
/** Date positions are calendar drawing arithmetic, never data reduction. */
export function barPosition(start: string, end: string, window: DateWindow, dayWidth: number) {
  return { left: Math.max(0, daysBetween(window.start, start)) * dayWidth,
    width: Math.max(1, daysBetween(start < window.start ? window.start : start, end > window.end ? window.end : end) + 1) * dayWidth };
}
export function viewQuery(lab: string, filters: BatchFilters, view: ListView, window: DateWindow, legacy = false) {
  if (view === 'rows') return batchQuery(lab, filters);
  if (legacy) return batchQuery(lab, filters);
  return Object.fromEntries(Object.entries({ lab, capsule_set: filters.capsule_set, status: filters.status,
    schedule_after: filters.started_after > window.start ? filters.started_after : window.start,
    schedule_before: filters.started_before && filters.started_before < window.end ? filters.started_before : window.end,
    order: '-started_on', limit: '200' }).filter(([, value]) => !!value));
}
export function visibleBatches(rows: BatchOut[], filters: BatchFilters, view: ListView, window: DateWindow, today: string) {
  return rows.filter(row => (!filters.capsule_set || row.capsule_set_id === filters.capsule_set)
    && (!filters.started_after || row.started_on >= filters.started_after) && (!filters.started_before || row.started_on <= filters.started_before)
    && (view === 'rows' || (row.started_on <= window.end && (view === 'calendar' ? row.started_on >= window.start : batchEnd(row, today) >= window.start))));
}
