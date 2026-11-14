import { plural } from './plural';
import type { MountOut, RunOut, SessionOut } from './overview.svelte';

/** A compact local timestamp, with stable English month names. */
export function formatRunTime(value?: string | null): string {
  const date = new Date(value ?? '');
  if (!Number.isFinite(date.getTime())) return 'Unknown time';
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()];
  return `${date.getDate()} ${month} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export function sessionStatus(session: SessionOut): string {
  return session.preferred_run ? 'preferred run' : session.run_count ? plural(session.run_count, 'run') : 'not reduced';
}
export function scopeRows(sessions: SessionOut[], mounts: MountOut[], query: string) {
  const text = query.trim().toLowerCase();
  return {
    sessions: sessions.filter(s => `${s.session_key} ${s.material}`.toLowerCase().includes(text))
      .sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? '')),
    mounts: mounts.filter(m => m.label.toLowerCase().includes(text)),
  };
}
export function completeRuns(runs: RunOut[]): RunOut[] {
  return runs.filter(r => r.status === 'completed' || r.status === 'complete')
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
}
export function resolvedRun(runs: RunOut[], value = 'preferred'): RunOut | undefined {
  return value === 'preferred' ? runs.find(r => r.is_preferred_for_session) ?? runs[0] : runs.find(r => r.id === value);
}
export function runBadge(run: RunOut, runs: RunOut[]): { text: string; tone: 'success' | 'warning' | 'neutral' } {
  if (run.is_preferred_for_session) return { text: 'Preferred', tone: 'success' };
  if (run.id === runs[0]?.id) return { text: 'Newest, not preferred', tone: 'warning' };
  return { text: formatRunTime(run.started_at).split(' ').slice(0, 2).join(' '), tone: 'neutral' };
}
/** Roving focus across independently sized columns; never lands in an empty column. */
export function listboxMove(lengths: number[], column: number, index: number, key: string): { column: number; index: number } {
  let nextColumn = column, nextIndex = index;
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const step = key === 'ArrowLeft' ? -1 : 1;
    for (let c = column + step; c >= 0 && c < lengths.length; c += step) {
      if (lengths[c]) { nextColumn = c; break; }
    }
  }
  if (key === 'Home') nextIndex = 0;
  if (key === 'End') nextIndex = lengths[nextColumn] - 1;
  if (key === 'ArrowDown') nextIndex++;
  if (key === 'ArrowUp') nextIndex--;
  return { column: nextColumn, index: Math.max(0, Math.min(nextIndex, Math.max(0, lengths[nextColumn] - 1))) };
}
