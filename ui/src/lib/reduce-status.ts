import type { SessionRow } from './overview.svelte';
export function reduceStatus(row: SessionRow, opened?: string): { label: 'not started' | 'in progress' | 'submitted'; date?: string } {
  const latest = row.latest;
  if (latest && ['pending', 'queued', 'running'].includes(latest.status)) return { label: 'in progress' };
  if (opened && (!latest || Date.parse(latest.started_at) <= Date.parse(opened))) return { label: 'in progress' };
  const completed = row.preferred?.status === 'completed' ? row.preferred
    : row.completed ?? (latest?.status === 'completed' ? latest : null);
  if (completed) return { label: 'submitted', date: completed.completed_at ?? completed.started_at };
  return { label: row.runs || latest ? 'in progress' : 'not started' };
}
