import { describe, expect, it } from 'vitest';
import { completeRuns, formatRunTime, listboxMove, resolvedRun, runBadge, scopeRows, sessionStatus, studioTarget } from './review-header';
import { mount, runs, session } from '../../tests/fixtures/review';
describe('Review header', () => {
  it('formats local timestamps and handles missing times', () => {
    expect(formatRunTime(new Date(2026, 10, 11, 16, 20).toISOString())).toBe('11 Nov 16:20');
    expect(formatRunTime(null)).toBe('Unknown time');
  });
  it('uses preferred metadata and tolerates older session replies', () => {
    expect(sessionStatus({ ...session, preferred_run: { id: 'p' } })).toBe('preferred run');
    expect(sessionStatus({ ...session, preferred_run: null, run_count: 2 })).toBe('2 runs');
    expect(sessionStatus({ ...session, preferred_run: undefined, run_count: undefined })).toBe('not reduced');
  });
  it('sorts newest sessions first with nulls last and filters name and material', () => {
    const older = { ...session, id: 'old', session_key: 'Old', started_at: null, material: 'apatite' };
    expect(scopeRows([older, session], [mount], '').sessions.map(s => s.id)).toEqual([session.id, 'old']);
    expect(scopeRows([older, session], [mount], 'APATITE').sessions).toEqual([older]);
    expect(scopeRows([session], [mount], 'DEMO').mounts).toEqual([mount]);
    expect(scopeRows([session], [mount], 'absent')).toEqual({ sessions: [], mounts: [] });
  });
  it('resolves preferred or newest complete runs and gives status badges', () => {
    const complete = completeRuns([...runs, { ...runs[1], id: 'pending', status: 'running', started_at: '2027-01-01' }]);
    expect(complete.map(r => r.id)).toEqual(['run-newer', 'run-preferred']);
    expect(resolvedRun(complete)?.id).toBe('run-preferred');
    expect(resolvedRun(complete, 'run-newer')?.id).toBe('run-newer');
    expect(runBadge(complete[0], complete)).toEqual({ text: 'Newest, not preferred', tone: 'warning' });
    expect(runBadge(complete[1], complete).tone).toBe('success');
    const noPreferred = complete.map(r => ({ ...r, is_preferred_for_session: false }));
    expect(resolvedRun(noPreferred)?.id).toBe('run-newer');
    expect(runBadge(noPreferred[1], noPreferred).tone).toBe('neutral');
    expect(resolvedRun([])).toBeUndefined();
  });
  it('moves within columns, clamps between unequal columns, and skips empty columns', () => {
    expect(listboxMove([4, 2], 0, 3, 'ArrowRight')).toEqual({ column: 1, index: 1 });
    expect(listboxMove([4, 2], 1, 0, 'ArrowLeft')).toEqual({ column: 0, index: 0 });
    expect(listboxMove([4, 0], 0, 3, 'ArrowRight')).toEqual({ column: 0, index: 3 });
    expect(listboxMove([4, 2], 0, 3, 'ArrowDown').index).toBe(3);
    expect(listboxMove([4, 2], 0, 0, 'ArrowUp').index).toBe(0);
    expect(listboxMove([4, 2], 0, 2, 'Home').index).toBe(0);
    expect(listboxMove([4, 2], 0, 0, 'End').index).toBe(3);
    expect(listboxMove([0, 0], 0, 0, 'ArrowDown')).toEqual({ column: 0, index: 0 });
  });
});

describe('studioTarget', () => {
  const session = { kind: 'session' as const, id: 's1', run: 'preferred' };
  const spot = { sessionId: 's1', runId: 'r1', acquisitionId: 'a1' };
  const sessionRuns = runs.map(r => ({ ...r, session_id: session.id }));
  it('opens the selected spot\'s own analysis', () => {
    expect(studioTarget(session, spot, [], sessionRuns).target).toEqual({ session: 's1', run: 'r1', acquisition: 'a1' });
  });
  it('opens the preferred run shown when nothing is selected, or keeps an explicit run', () => {
    expect(studioTarget(session, null, [], sessionRuns).target).toEqual({ session: 's1', run: 'run-preferred' });
    expect(studioTarget(session, null, [], sessionRuns).reason).toMatch(/run shown in Review/);
    expect(studioTarget({ ...session, run: 'r9' }, null, [], [...sessionRuns, { ...sessionRuns[1], id: 'r9' }]).target).toEqual({ session: 's1', run: 'r9' });
  });
  it('uses the newest complete run when none is preferred', () => {
    const noPreferred = sessionRuns.map(r => ({ ...r, is_preferred_for_session: false }));
    const pending = { ...sessionRuns[1], id: 'pending', status: 'running', started_at: '2027-01-01', is_preferred_for_session: true };
    expect(studioTarget(session, null, [], [...noPreferred, pending]).target).toEqual({ session: 's1', run: 'run-newer' });
  });
  it('falls back to the session for incomplete or unloaded runs', () => {
    const incomplete = sessionRuns.map(r => ({ ...r, status: 'running' }));
    expect(studioTarget(session, null, [], incomplete).target).toEqual({ session: 's1', run: null });
    expect(studioTarget(session, null, [], []).target).toEqual({ session: 's1', run: null });
    expect(studioTarget(session, null, [], incomplete).reason).toMatch(/session's data reduction/);
  });
  it('ignores runs from a previous session, including an explicit id', () => {
    expect(studioTarget(session, null, [], runs).target).toEqual({ session: 's1', run: null });
    expect(studioTarget({ ...session, run: runs[0].id }, null, [], runs).target).toEqual({ session: 's1', run: null });
    expect(studioTarget(session, null, [], [...runs, { ...sessionRuns[1], status: 'complete' }]).target).toEqual({ session: 's1', run: 'run-newer' });
  });
  it('for a mount, opens the one session its spots come from, else asks for a selection', () => {
    const mount = { kind: 'mount' as const, id: 'm1' };
    expect(studioTarget(mount, null, [{ sessionId: 's2' }, { sessionId: 's2' }, { sessionId: null }], []).target).toEqual({ session: 's2', run: null });
    const two = studioTarget(mount, null, [{ sessionId: 's2' }, { sessionId: 's3' }], []);
    expect(two.target).toBeNull();
    expect(two.reason).toMatch(/2 sessions: select a spot/);
    expect(studioTarget(mount, null, [], []).reason).toMatch(/No measured spots/);
  });
  it('for a mount, opens a run only when every shown row of the single session agrees', () => {
    const mount = { kind: 'mount' as const, id: 'm1' };
    const row = { sessionId: 's2', runId: 'r2' };
    const agreed = studioTarget(mount, null, [row, { ...row }, { sessionId: null, runId: null }], []);
    expect(agreed.target).toEqual({ session: 's2', run: 'r2' });
    expect(agreed.reason).toMatch(/run shown in Review/);
    for (const other of [{ ...row, runId: 'r3' }, { ...row, runId: null }, { sessionId: 's2' }]) {
      const mixed = studioTarget(mount, null, [row, other], []);
      expect(mixed.target).toEqual({ session: 's2', run: null });
      expect(mixed.reason).toMatch(/session's data reduction/);
    }
    expect(studioTarget(mount, spot, [row], []).target).toEqual({ session: 's1', run: 'r1', acquisition: 'a1' });
    expect(studioTarget(mount, null, [row, { ...row, sessionId: 's3' }], []).target).toBeNull();
  });
});
