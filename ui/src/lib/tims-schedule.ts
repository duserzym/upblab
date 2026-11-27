import type { BatchOut, ScheduleItem } from './tims-api';
import type { BatchFilters } from './tims-model';
export type StepKind = 'abrasion' | 'dissolution' | 'conversion' | 'cleaning' | 'loading' | 'other';
// Same mineral letters as UPbDB validation.LETTERS; garnet is forward compatible.
const letters: Record<string, string> = { zircon: 'Z', baddeleyite: 'B', apatite: 'A', rutile: 'R', titanite: 'T', garnet: 'G', monazite: 'M', xenotime: 'X', other: 'O' };
export function stepCode(item: Pick<ScheduleItem, 'method_code' | 'step_name' | 'minerals' | 'temperature_c' | 'parameters'>): { label: string; kind: StepKind } {
  const code = item.method_code.replace(/^SP-TIMS-/, '');
  const temperature = item.temperature_c ?? item.parameters?.temperature_c;
  if (code === 'LOAD') return { label: 'Load', kind: 'loading' };
  if (code === 'CA') return { label: `CA${temperature == null ? '' : ` ${temperature} °C`}`, kind: 'abrasion' };
  if (code === 'DISS') return { label: [...new Set(item.minerals.map(m => letters[m.toLowerCase()] ?? m))].sort((a, b) => a === 'Z' ? -1 : b === 'Z' ? 1 : a.localeCompare(b)).map(m => `${m}1`).join('/') || 'Dissolution', kind: 'dissolution' };
  // Boise recipes use one chloride conversion method; no A2 etc. is defined.
  if (code === 'CHLOR') return { label: 'Z2', kind: 'conversion' };
  const cleaning = /^P([1-4])$/.exec(code)?.[1]
    ?? (['WASH', 'LEACH', 'CLEAN'].includes(code) ? /^P?([1-4])$/.exec(String(item.parameters?.cleaning_step ?? ''))?.[1] : undefined);
  if (cleaning) return { label: `P${cleaning} ${Number(cleaning) % 2 ? 'HCl' : 'HF'}`, kind: 'cleaning' };
  const full = item.step_name || item.method_code;
  return { label: full.length > 24 ? `${full.slice(0, 23)}…` : full, kind: ['WASH', 'LEACH'].includes(code) ? 'cleaning' : 'other' };
}
/** Coalesce capsule/date groups without merging different steps or temperatures. */
export function groupSchedule(items: ScheduleItem[]): ScheduleItem[] {
  const groups = new Map<string, ScheduleItem>();
  for (const item of items) {
    const key = JSON.stringify([item.step_id, item.date, item.temperature_c ?? null]);
    const group = groups.get(key);
    if (group) { group.capsule_count += item.capsule_count; group.minerals = [...new Set([...group.minerals, ...item.minerals])].sort(); }
    else groups.set(key, { ...item, minerals: [...item.minerals] });
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.step_id.localeCompare(b.step_id) || String(a.temperature_c).localeCompare(String(b.temperature_c)));
}
export interface BatchEvent extends ScheduleItem { batch: BatchOut; key: string; label: string; kind: StepKind; legacy: boolean }
export function batchEvents(rows: BatchOut[], filters: BatchFilters, window: { start: string; end: string }): BatchEvent[] {
  return rows.filter(row => !filters.capsule_set || row.capsule_set_id === filters.capsule_set).flatMap(batch => {
    const legacy = batch.schedule === undefined;
    const schedule = batch.schedule ?? [{ step_id: '', method_code: '', step_name: 'Started', date: batch.started_on, capsule_count: batch.counts?.capsules ?? 0, minerals: [] }];
    return groupSchedule(schedule).filter(item => item.date >= window.start && item.date <= window.end
      && (!filters.started_after || item.date >= filters.started_after) && (!filters.started_before || item.date <= filters.started_before))
      .map((item, index) => ({ ...item, batch, key: `${batch.id}:${item.step_id}:${item.date}:${index}`, ...stepCode(item), legacy }));
  });
}
export function scheduleTitle(item: BatchEvent, name: string) {
  return `${name} · ${item.step_name} · ${item.date} · ${item.capsule_count} capsules${item.temperature_c == null ? '' : ` · ${item.temperature_c} °C`}`;
}
/** Reserve label width on each track so events on adjacent dates cannot overlap. */
export function packScheduleLane(items: BatchEvent[], dayWidth: number) {
  const ends: number[] = [];
  const bars = [...items].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key)).map(item => {
    const start = Date.parse(item.date) / 86400000;
    let track = ends.findIndex(end => end < start);
    if (track < 0) track = ends.length;
    ends[track] = start + Math.ceil(148 / dayWidth);
    return { item, track };
  });
  return { bars, tracks: Math.max(1, ends.length) };
}
