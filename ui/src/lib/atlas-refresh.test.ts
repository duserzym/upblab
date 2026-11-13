import { beforeEach, describe, expect, it, vi } from 'vitest';
import { atlasStatusFixture, atlasSyncedFixture } from '../../tests/fixtures/atlas-sync';
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'https://lab' }, revision: 0, signedIn: true, get: vi.fn() } }));
vi.mock('./review.svelte', () => ({ review: { state: 'ready', scope: { kind: 'session', id: 's' }, rows: [{ mountId: 'mount-demo', atlasProjectId: 'project-demo' }], load: vi.fn(async () => {}) } }));
vi.mock('./overview.svelte', () => ({ overview: { mounts: [{ mount: { id: 'mount-demo' } }], refreshMount: vi.fn(async () => {}) } }));
vi.mock('./incoming', () => ({ sendCommand: vi.fn(async () => true), moduleSurfaces: new Set() }));
const { identity } = await import('./identity.svelte');
const { review } = await import('./review.svelte');
const { overview } = await import('./overview.svelte');
const { sendCommand, moduleSurfaces } = await import('./incoming');
const { atlasSync } = await import('./atlas-sync.svelte');
const { atlasSyncedNotice, checkStandaloneSync } = await import('./atlas-refresh');
const get = vi.mocked(identity.get);
beforeEach(() => {
  vi.clearAllMocks();
  identity.revision++;
  atlasSync.v4 = true; atlasSync.status = atlasStatusFixture;
  review.state = 'ready';
  review.rows = [{ mountId: 'mount-demo', atlasProjectId: 'project-demo' }] as typeof review.rows;
  moduleSurfaces.clear();
  get.mockResolvedValue({ status: 200, body: { mount_id: 'mount-demo', revision: 42, atlas_version: 4 } } as never);
});
describe('sync refreshes', () => {
  it('deduplicates by mount, revision and atlas version across project ids and forwards only to open Sessions', async () => {
    await atlasSyncedNotice(atlasSyncedFixture);
    expect(review.load).toHaveBeenCalledOnce();
    expect(overview.refreshMount).toHaveBeenCalledWith('mount-demo');
    expect(sendCommand).not.toHaveBeenCalled();
    moduleSurfaces.add('sessions');
    await atlasSyncedNotice({ ...atlasSyncedFixture, project: 'other-project' });
    expect(review.load).toHaveBeenCalledOnce();
    expect(sendCommand).not.toHaveBeenCalled();
    await atlasSyncedNotice({ ...atlasSyncedFixture, revision: 43 });
    expect(sendCommand).toHaveBeenCalledWith('sessions', { type: 'atlas-synced', project: 'project-demo', mount: 'mount-demo', revision: 43 });
  });
  it('forwards the first module notice even if focus polling saw its revision', async () => {
    await checkStandaloneSync(0);
    moduleSurfaces.add('sessions');
    await atlasSyncedNotice(atlasSyncedFixture);
    expect(sendCommand).toHaveBeenCalledExactlyOnceWith('sessions', { type: 'atlas-synced', project: 'project-demo', mount: 'mount-demo', revision: 42 });
    expect(review.load).toHaveBeenCalledOnce();
    expect(overview.refreshMount).toHaveBeenCalledOnce();
  });
  it('refreshes only Home for a different non-null bundle at the same revision, including another project on that mount', async () => {
    moduleSurfaces.add('sessions');
    await atlasSyncedNotice(atlasSyncedFixture);
    vi.clearAllMocks();
    const pixels = { ...atlasSyncedFixture, project: 'other-project', atlasVersion: 5 };
    await atlasSyncedNotice(pixels);
    expect(overview.refreshMount).toHaveBeenCalledExactlyOnceWith('mount-demo');
    expect(review.load).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
    await atlasSyncedNotice(pixels);
    expect(overview.refreshMount).toHaveBeenCalledOnce();
    // Bundle identity, rather than numeric ordering, determines a publication change.
    await atlasSyncedNotice({ ...pixels, atlasVersion: 4 });
    expect(overview.refreshMount).toHaveBeenCalledTimes(2);
    await atlasSyncedNotice({ ...pixels, revision: 41, atlasVersion: 6 });
    expect(overview.refreshMount).toHaveBeenCalledTimes(2);
  });
  it('tracks null bundle versions without refreshing until a non-null bundle appears', async () => {
    await atlasSyncedNotice({ ...atlasSyncedFixture, atlasVersion: null });
    vi.clearAllMocks();
    await atlasSyncedNotice({ ...atlasSyncedFixture, atlasVersion: null });
    expect(overview.refreshMount).not.toHaveBeenCalled();
    await atlasSyncedNotice({ ...atlasSyncedFixture, atlasVersion: 0 });
    expect(overview.refreshMount).toHaveBeenCalledOnce();
    await atlasSyncedNotice({ ...atlasSyncedFixture, atlasVersion: null });
    expect(overview.refreshMount).toHaveBeenCalledOnce();
    await atlasSyncedNotice({ ...atlasSyncedFixture, atlasVersion: 0 });
    expect(overview.refreshMount).toHaveBeenCalledTimes(2);
    expect(review.load).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
  });
  it('refreshes only Home for a pixel notice after a focus baseline', async () => {
    await checkStandaloneSync(0);
    vi.clearAllMocks();
    moduleSurfaces.add('sessions');
    await atlasSyncedNotice({ ...atlasSyncedFixture, atlasVersion: 5 });
    expect(overview.refreshMount).toHaveBeenCalledExactlyOnceWith('mount-demo');
    expect(review.load).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
  });
  it('leaves unrelated or loading Review alone' , async () => {
    await atlasSyncedNotice({ ...atlasSyncedFixture, mount: 'other' });
    expect(review.load).not.toHaveBeenCalled();
    review.state = 'loading';
    await atlasSyncedNotice(atlasSyncedFixture);
    expect(review.load).not.toHaveBeenCalled();
  });
  it('performs no standalone requests before v4 adoption', async () => {
    atlasSync.v4 = false;
    await checkStandaloneSync(0);
    expect(get).not.toHaveBeenCalled();
  });
  it('throttles focus checks, refreshes only increasing revisions, and deduplicates projects', async () => {
    review.rows.push(...review.rows);
    await checkStandaloneSync(0);
    expect(get).toHaveBeenCalledExactlyOnceWith('/v1/atlas/projects/project-demo');
    expect(review.load).toHaveBeenCalledOnce();
    await checkStandaloneSync(20_000);
    expect(get).toHaveBeenCalledOnce();
    await checkStandaloneSync(31_000);
    expect(get).toHaveBeenCalledTimes(2);
    expect(review.load).toHaveBeenCalledOnce();
    get.mockResolvedValue({ status: 200, body: { mount_id: 'mount-demo', revision: 43, atlas_version: 4 } } as never);
    await checkStandaloneSync(62_000);
    expect(review.load).toHaveBeenCalledTimes(2);
  });
  it('uses both status fields as a focus baseline and refreshes only Home for pixel publications', async () => {
    get.mockResolvedValue({ status: 200, body: { mount_id: 'mount-demo', revision: 41, atlas_version: 3 } } as never);
    await checkStandaloneSync(0);
    expect(overview.refreshMount).not.toHaveBeenCalled();
    get.mockResolvedValue({ status: 200, body: { mount_id: 'mount-demo', revision: 41, atlas_version: 4 } } as never);
    await checkStandaloneSync(31_000);
    expect(overview.refreshMount).toHaveBeenCalledExactlyOnceWith('mount-demo');
    await checkStandaloneSync(62_000);
    expect(overview.refreshMount).toHaveBeenCalledOnce();
    expect(review.load).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
  });
  it('shares the last seen bundle between notices and focus checks', async () => {
    moduleSurfaces.add('sessions');
    await atlasSyncedNotice(atlasSyncedFixture);
    vi.clearAllMocks();
    await checkStandaloneSync(0);
    expect(overview.refreshMount).not.toHaveBeenCalled();
    get.mockResolvedValue({ status: 200, body: { mount_id: 'mount-demo', revision: 42, atlas_version: 5 } } as never);
    await checkStandaloneSync(31_000);
    await atlasSyncedNotice({ ...atlasSyncedFixture, atlasVersion: 5 });
    expect(overview.refreshMount).toHaveBeenCalledExactlyOnceWith('mount-demo');
    expect(review.load).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
  });
  it('accepts a null focus bundle and refreshes Home when the first bundle appears', async () => {
    atlasSync.status = { ...atlasStatusFixture, atlasVersion: null };
    get.mockResolvedValue({ status: 200, body: { mount_id: 'mount-demo', revision: 41, atlas_version: null } } as never);
    await checkStandaloneSync(0);
    expect(overview.refreshMount).not.toHaveBeenCalled();
    get.mockResolvedValue({ status: 200, body: { mount_id: 'mount-demo', revision: 41, atlas_version: 0 } } as never);
    await checkStandaloneSync(31_000);
    expect(overview.refreshMount).toHaveBeenCalledExactlyOnceWith('mount-demo');
    expect(review.load).not.toHaveBeenCalled();
  });
  it('refreshes once without a status baseline and forgets versions when the identity changes', async () => {
    atlasSync.status = null;
    await checkStandaloneSync(0);
    expect(review.load).toHaveBeenCalledOnce();
    await checkStandaloneSync(31_000);
    expect(review.load).toHaveBeenCalledOnce();
    identity.revision++;
    await checkStandaloneSync(32_000);
    expect(review.load).toHaveBeenCalledTimes(2);
  });
  it.each([undefined, -1, 1.5, '4', false, {}, [], NaN, Infinity])('treats invalid atlas_version %j as unavailable for ten minutes', async atlas_version => {
    get.mockResolvedValueOnce({ status: 200, body: { mount_id: 'mount-demo', revision: 42, atlas_version } } as never);
    await checkStandaloneSync(0);
    await checkStandaloneSync(31_000);
    await checkStandaloneSync(590_000);
    expect(get).toHaveBeenCalledOnce();
    expect(overview.refreshMount).not.toHaveBeenCalled();
    expect(review.load).not.toHaveBeenCalled();
    await checkStandaloneSync(621_000);
    expect(get).toHaveBeenCalledTimes(2);
    expect(review.load).toHaveBeenCalledOnce();
  });
  it.each(['404', 'network'])('remembers %s failures for ten minutes', async failure => {
    if (failure === '404') get.mockResolvedValue({ status: 404, body: {} } as never);
    else get.mockRejectedValue(new Error('offline'));
    await checkStandaloneSync(0);
    await checkStandaloneSync(31_000);
    await checkStandaloneSync(590_000);
    expect(get).toHaveBeenCalledOnce();
    expect(review.load).not.toHaveBeenCalled();
    await checkStandaloneSync(621_000);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('checks at most eight distinct projects per focus', async () => {
    review.rows = Array.from({ length: 12 }, (_, i) => ({ mountId: `m${i}`, atlasProjectId: `p${i}` })) as typeof review.rows;
    await checkStandaloneSync(0);
    expect(get).toHaveBeenCalledTimes(8);
  });
});
