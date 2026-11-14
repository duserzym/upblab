import { beforeEach, describe, expect, it, vi } from 'vitest';
import { atlasSync, refreshDecision } from './atlas-sync.svelte';
import { atlasStatusFixture, atlasDraftsFixture, atlasSyncedFixture } from '../../tests/fixtures/atlas-sync';
import { sendCommand } from './incoming';

vi.mock('./incoming', () => ({ sendCommand: vi.fn(async () => true) }));

beforeEach(() => { atlasSync.v4 = false; atlasSync.status = null; atlasSync.lastSynced = null; atlasSync.strandedDrafts = []; });
describe('Atlas snapshots', () => {
  it('adopts only valid v4 events and replaces snapshots', () => {
    atlasSync.receive({ type: 'lab.atlas.status' });
    atlasSync.receive({ type: 'grainatlas.files.opened' });
    expect(atlasSync.v4).toBe(false);
    atlasSync.receive(atlasStatusFixture);
    expect(atlasSync.v4).toBe(true);
    expect(atlasSync.status).toEqual(atlasStatusFixture);
    atlasSync.receive({ ...atlasStatusFixture, revision: 42 });
    expect(atlasSync.status?.revision).toBe(42);
    expect(atlasSync.receive(atlasSyncedFixture)).toEqual(atlasSyncedFixture);
    expect(atlasSync.lastSynced).toEqual(atlasSyncedFixture);
  });
  it('stores valid stranded drafts for display only and clears them with an empty list', () => {
    expect(atlasSync.receive(atlasDraftsFixture)).toBeNull();
    expect(atlasSync.v4).toBe(true);
    expect(atlasSync.strandedDrafts).toEqual(atlasDraftsFixture.drafts);
    atlasSync.receive({ type: 'lab.atlas.drafts', drafts: [{ project: 'bad/id' }] });
    expect(atlasSync.strandedDrafts).toEqual(atlasDraftsFixture.drafts);
    atlasSync.receive({ type: 'lab.atlas.drafts', drafts: [] });
    expect(atlasSync.strandedDrafts).toEqual([]);
    expect(atlasSync.status).toBeNull();
    expect(atlasSync.lastSynced).toBeNull();
    expect(sendCommand).not.toHaveBeenCalled();
  });
  it('refreshes matching ready scopes or row mounts and the matching Home row', () => {
    const state = { state: 'ready', scope: { kind: 'session', id: 's' }, rows: [{ mountId: 'm' }] };
    expect(refreshDecision('m', state, [{ mount: { id: 'm' } }])).toEqual({ review: true, home: true });
    expect(refreshDecision('other', state, [])).toEqual({ review: false, home: false });
    expect(refreshDecision('m', { ...state, state: 'loading' }, [])).toEqual({ review: false, home: false });
    expect(refreshDecision('m', { state: 'ready', scope: { kind: 'mount', id: 'm' }, rows: [] }, [])).toEqual({ review: true, home: false });
  });
});
