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

/**
 * What "Edit in UPbRPy Studio" opens from Review. A selected spot opens its own
 * analysis (its run, focused on the acquisition); with no selection the whole
 * run shown opens, or the session when no complete run is available. For a mount,
 * opens the one session the shown spots come from, using their run when all agree.
 * `null` when Studio has nothing single to open.
 */
export function studioTarget(
  scope: { kind: 'session'; id: string; run: string } | { kind: 'mount'; id: string } | null,
  selected: { sessionId: string | null; runId: string | null; acquisitionId: string | null } | null,
  shown: { sessionId: string | null; runId?: string | null }[],
  runs: RunOut[],
): { target: { session: string | null; run: string | null; acquisition?: string | null } | null; reason: string } {
  if (selected && (selected.sessionId || selected.runId)) {
    return { target: { session: selected.sessionId, run: selected.runId, acquisition: selected.acquisitionId }, reason: 'Edit this spot\'s data reduction in UPbRPy Studio (S)' };
  }
  if (scope?.kind === 'session') {
    // Review clears runs on scope changes; also reject any list from another session.
    const run = resolvedRun(completeRuns(runs.filter(r => r.session_id === scope.id)), scope.run);
    return { target: { session: scope.id, run: run?.id ?? null }, reason: run ? 'Edit the run shown in Review in UPbRPy Studio (S)' : 'Edit this session\'s data reduction in UPbRPy Studio (S)' };
  }
  const sessions = [...new Set(shown.map(s => s.sessionId).filter((s): s is string => !!s))];
  if (sessions.length === 1) {
    const runIds = new Set(shown.filter(s => s.sessionId === sessions[0]).map(s => s.runId));
    const run = runIds.size === 1 ? [...runIds][0] || null : null;
    return { target: { session: sessions[0], run }, reason: run ? 'Edit the run shown in Review in UPbRPy Studio (S)' : 'Edit this session\'s data reduction in UPbRPy Studio (S)' };
  }
  return {
    target: null,
    reason: sessions.length ? `These spots come from ${plural(sessions.length, 'session')}: select a spot to open its session in UPbRPy Studio` : 'No measured spots to open in UPbRPy Studio',
  };
}
