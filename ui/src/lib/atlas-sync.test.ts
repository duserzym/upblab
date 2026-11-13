import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atlasSync, changeCounts, needsLeaveGuard, refreshDecision, statusLabel } from './atlas-sync.svelte';
import { atlasStatusFixture, atlasDraftsFixture, atlasSyncedFixture } from '../../tests/fixtures/atlas-sync';
import { shell } from './shell.svelte';
import { logWarn } from './platform';

vi.mock('./shell.svelte', () => ({ shell: { show: vi.fn(async () => true) } }));
vi.mock('./platform', () => ({ logWarn: vi.fn(async () => {}) }));

beforeEach(() => { atlasSync.v4 = false; atlasSync.status = null; atlasSync.drafts = []; atlasSync.lastSynced = null; atlasSync.note = ''; atlasSync.finishLeave(null); });
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
describe('Atlas snapshots and presentation', () => {
  it('adopts only valid v4 events and replaces snapshots', () => {
    atlasSync.receive({ type: 'lab.atlas.status' });
    atlasSync.receive({ type: 'grainatlas.files.opened' });
    expect(atlasSync.v4).toBe(false);
    atlasSync.receive(atlasStatusFixture);
    expect(atlasSync.v4).toBe(true);
    expect(atlasSync.status).toEqual(atlasStatusFixture);
    atlasSync.receive(atlasDraftsFixture);
    atlasSync.receive(atlasDraftsFixture);
    expect(atlasSync.drafts).toHaveLength(1);
    atlasSync.receive({ type: 'lab.atlas.drafts', drafts: [] });
    expect(atlasSync.drafts).toEqual([]);
    expect(atlasSync.receive(atlasSyncedFixture)).toEqual(atlasSyncedFixture);
    expect(atlasSync.lastSynced).toEqual(atlasSyncedFixture);
  });
  it.each([
    ['checking', 'Checking…'], ['unregistered', 'Not in the database'], ['in-sync', 'In sync · v3 r41'],
    ['local-changes', 'Local changes · 12 spots, 2 grains'], ['server-newer', 'Database is newer'],
    ['both-changed', 'Both changed'], ['offline', 'Offline, changes kept here'],
  ] as const)('labels %s', (state, label) => {
    expect(statusLabel({ ...atlasStatusFixture, state, changes: { spots: 12, grains: 2, labels: 0, pixels: false } })).toBe(label);
  });
  it('handles unpublished projects and singular counts', () => {
    expect(statusLabel({ ...atlasStatusFixture, state: 'in-sync', revision: null, atlasVersion: null })).toBe('In sync');
    expect(changeCounts({ spots: 1, grains: 1, labels: 1, pixels: true })).toBe('1 spot, 1 grain, 1 label, new images');
  });
  it('guards edit mode only, for each nonzero count or pixels', () => {
    expect(needsLeaveGuard(null)).toBe(false);
    expect(needsLeaveGuard({ ...atlasStatusFixture, mode: 'view' })).toBe(false);
    expect(needsLeaveGuard({ ...atlasStatusFixture, changes: null })).toBe(false);
    const zero = { spots: 0, grains: 0, labels: 0, pixels: false };
    expect(needsLeaveGuard({ ...atlasStatusFixture, changes: zero })).toBe(false);
    for (const key of ['spots', 'grains', 'labels', 'pixels'] as const)
      expect(needsLeaveGuard({ ...atlasStatusFixture, changes: { ...zero, [key]: key === 'pixels' ? true : 1 } })).toBe(true);
  });
  it('does not replace a pending leave request and cancels with Stay', async () => {
    atlasSync.receive(atlasStatusFixture);
    const request = atlasSync.requestLeave();
    expect(await atlasSync.requestLeave()).toBeNull();
    atlasSync.finishLeave('keep-draft');
    expect(await request).toBe('keep-draft');
    const stay = atlasSync.requestLeave();
    atlasSync.finishLeave(null);
    expect(await stay).toBeNull();
  });
  it('refreshes matching ready scopes or row mounts and the matching Home row', () => {
    const state = { state: 'ready', scope: { kind: 'session', id: 's' }, rows: [{ mountId: 'm' }] };
    expect(refreshDecision('m', state, [{ mount: { id: 'm' } }])).toEqual({ review: true, home: true });
    expect(refreshDecision('other', state, [])).toEqual({ review: false, home: false });
    expect(refreshDecision('m', { ...state, state: 'loading' }, [])).toEqual({ review: false, home: false });
    expect(refreshDecision('m', { state: 'ready', scope: { kind: 'mount', id: 'm' }, rows: [] }, [])).toEqual({ review: true, home: false });
  });
  it.each([
    [false, 'another-project', 'set-mode'],
    [true, atlasStatusFixture.project, 'set-mode'],
    [true, 'another-project', 'open-project'],
    [true, null, 'open-project'],
  ] as const)('shows Images and requests edit with a 10 s timeout (Home: %s, current: %s)', async (home, current, type) => {
    atlasSync.status = current ? { ...atlasStatusFixture, project: current } : null;
    const request = vi.spyOn(atlasSync, 'request').mockResolvedValue({
      type: 'lab.command.result', id: 'edit-1', command: type, ok: true,
    });
    await atlasSync.openForConfirmation(atlasStatusFixture.project,
      { retireGrains: 1, grainsTotal: 40, deleteSpots: 12, spotsTotal: 100 }, home);
    expect(shell.show).toHaveBeenCalledWith('images');
    expect(request).toHaveBeenCalledExactlyOnceWith({ type, project: atlasStatusFixture.project, mode: 'edit' }, 10_000);
    expect(atlasSync.note).toBe('Needs your confirmation: this retires 1 of 40 grains and deletes 12 spots');
    expect(logWarn).not.toHaveBeenCalled();
  });
  it.each([
    { timeout: true } as const,
    { type: 'lab.command.result', id: 'edit-1', command: 'set-mode', ok: false, code: 'failed' } as const,
  ])('only logs an unsuccessful edit handoff (%j)', async result => {
    vi.spyOn(atlasSync, 'request').mockResolvedValue(result);
    await atlasSync.openForConfirmation('p', { retireGrains: 0, grainsTotal: 40, deleteSpots: 1, spotsTotal: 100 });
    expect(logWarn).toHaveBeenCalledOnce();
    expect(atlasSync.note).toBe('Needs your confirmation: this deletes 1 spot');
    expect(shell.show).toHaveBeenCalledExactlyOnceWith('images');
  });
});
