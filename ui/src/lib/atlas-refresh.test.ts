import { beforeEach, describe, expect, it, vi } from 'vitest';
import { atlasSyncedFixture } from '../../tests/fixtures/atlas-sync';
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'https://lab' }, revision: 0, signedIn: true, get: vi.fn() } }));
vi.mock('./review.svelte', () => ({ review: { state: 'ready', scope: { kind: 'session', id: 's' }, rows: [{ mountId: 'mount-demo', atlasProjectId: 'project-demo' }], refresh: vi.fn(async () => {}) } }));
vi.mock('./overview.svelte', () => ({ overview: { mounts: [{ mount: { id: 'mount-demo' } }], refreshMount: vi.fn(async () => {}) } }));
vi.mock('./incoming', () => ({ sendCommand: vi.fn(async () => true), moduleSurfaces: new Set() }));
const { identity } = await import('./identity.svelte');
const { review } = await import('./review.svelte');
const { overview } = await import('./overview.svelte');
const { sendCommand, moduleSurfaces } = await import('./incoming');
const { atlasSyncedNotice, refreshAtlasMount, refreshAtlasProject } = await import('./atlas-refresh');
const get = vi.mocked(identity.get);
const strict = { strict: true };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
  vi.clearAllMocks();
  identity.revision++;
  review.state = 'ready';
  review.rows = [{ mountId: 'mount-demo', atlasProjectId: 'project-demo' }] as typeof review.rows;
  moduleSurfaces.clear();
  get.mockResolvedValue({ status: 200, body: { mount_id: 'mount-demo', revision: 42, atlas_version: 4 } } as never);
});
describe('sync refreshes', () => {
  it('refreshes Review and Home, then forwards to an open Sessions surface', async () => {
    moduleSurfaces.add('sessions');
    let finishReview!: () => void;
    vi.mocked(review.refresh).mockImplementationOnce(() => new Promise(resolve => { finishReview = resolve; }));
    const pending = atlasSyncedNotice(atlasSyncedFixture);
    await flush();
    expect(review.refresh).toHaveBeenCalledOnce();
    expect(overview.refreshMount).toHaveBeenCalledExactlyOnceWith('mount-demo', strict);
    expect(sendCommand).not.toHaveBeenCalled();
    finishReview();
    await pending;
    expect(sendCommand).toHaveBeenCalledExactlyOnceWith('sessions', { type: 'atlas-synced', project: 'project-demo', mount: 'mount-demo', revision: 42 });
  });
  it('refreshes Home even if Review rejects, rejects, and retries the same revision next time', async () => {
    vi.mocked(review.refresh).mockRejectedValueOnce(new Error('offline'));
    await expect(atlasSyncedNotice(atlasSyncedFixture)).rejects.toThrow('offline');
    expect(review.refresh).toHaveBeenCalledOnce();
    expect(overview.refreshMount).toHaveBeenCalledExactlyOnceWith('mount-demo', strict);
    await atlasSyncedNotice(atlasSyncedFixture);
    expect(review.refresh).toHaveBeenCalledTimes(2);
    await atlasSyncedNotice(atlasSyncedFixture);
    expect(review.refresh).toHaveBeenCalledTimes(2);
  });
  it('still forwards to an open Sessions surface when its own refresh fails, once per revision', async () => {
    moduleSurfaces.add('sessions');
    vi.mocked(review.refresh).mockRejectedValueOnce(new Error('offline'));
    await expect(atlasSyncedNotice(atlasSyncedFixture)).rejects.toThrow('offline');
    expect(sendCommand).toHaveBeenCalledExactlyOnceWith('sessions', { type: 'atlas-synced', project: 'project-demo', mount: 'mount-demo', revision: 42 });
    await atlasSyncedNotice(atlasSyncedFixture);
    expect(sendCommand).toHaveBeenCalledOnce();
  });
  it('does not forward or record a version if the identity changes while refreshing', async () => {
    moduleSurfaces.add('sessions');
    vi.mocked(review.refresh).mockImplementationOnce(async () => { identity.revision++; });
    await atlasSyncedNotice(atlasSyncedFixture);
    expect(sendCommand).not.toHaveBeenCalled();
    await atlasSyncedNotice(atlasSyncedFixture);
    expect(review.refresh).toHaveBeenCalledTimes(2);
  });
  it('deduplicates by mount, revision and atlas version across project ids and forwards only to open Sessions', async () => {
    await atlasSyncedNotice(atlasSyncedFixture);
    expect(review.refresh).toHaveBeenCalledOnce();
    expect(overview.refreshMount).toHaveBeenCalledWith('mount-demo', strict);
    expect(sendCommand).not.toHaveBeenCalled();
    moduleSurfaces.add('sessions');
    await atlasSyncedNotice({ ...atlasSyncedFixture, project: 'other-project' });
    expect(review.refresh).toHaveBeenCalledOnce();
    expect(sendCommand).not.toHaveBeenCalled();
    await atlasSyncedNotice({ ...atlasSyncedFixture, revision: 43 });
    expect(sendCommand).toHaveBeenCalledWith('sessions', { type: 'atlas-synced', project: 'project-demo', mount: 'mount-demo', revision: 43 });
  });
  it('forwards the first module notice even if a project read saw its revision', async () => {
    await refreshAtlasProject('project-demo');
    moduleSurfaces.add('sessions');
    await atlasSyncedNotice(atlasSyncedFixture);
    expect(sendCommand).toHaveBeenCalledExactlyOnceWith('sessions', { type: 'atlas-synced', project: 'project-demo', mount: 'mount-demo', revision: 42 });
    expect(review.refresh).toHaveBeenCalledOnce();
    expect(overview.refreshMount).toHaveBeenCalledOnce();
  });
  it('refreshes only Home for a different non-null bundle at the same revision, including another project on that mount', async () => {
    moduleSurfaces.add('sessions');
    await atlasSyncedNotice(atlasSyncedFixture);
    vi.clearAllMocks();
    const pixels = { ...atlasSyncedFixture, project: 'other-project', atlasVersion: 5 };
    await atlasSyncedNotice(pixels);
    expect(overview.refreshMount).toHaveBeenCalledExactlyOnceWith('mount-demo', strict);
    expect(review.refresh).not.toHaveBeenCalled();
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
    expect(review.refresh).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
  });
  it('leaves unrelated or loading Review alone' , async () => {
    await atlasSyncedNotice({ ...atlasSyncedFixture, mount: 'other' });
    expect(review.refresh).not.toHaveBeenCalled();
    review.state = 'loading';
    await atlasSyncedNotice(atlasSyncedFixture);
    expect(review.refresh).not.toHaveBeenCalled();
  });
});
describe('refreshAtlasMount', () => {
  it('settles both refreshes, then rejects with the failure', async () => {
    vi.mocked(overview.refreshMount).mockRejectedValueOnce(new Error('offline'));
    await expect(refreshAtlasMount('mount-demo')).rejects.toThrow('offline');
    expect(review.refresh).toHaveBeenCalledOnce();
    await refreshAtlasMount('mount-demo', false);
    expect(review.refresh).toHaveBeenCalledOnce();
    expect(overview.refreshMount).toHaveBeenLastCalledWith('mount-demo', strict);
  });
});
describe('refreshAtlasProject', () => {
  it('reads the project, refreshes increasing revisions only and Home only for pixel publications', async () => {
    await refreshAtlasProject('project-demo', 'mount-demo');
    expect(get).toHaveBeenCalledExactlyOnceWith('/v1/atlas/projects/project-demo');
    expect(review.refresh).toHaveBeenCalledOnce();
    await refreshAtlasProject('project-demo');
    expect(review.refresh).toHaveBeenCalledOnce();
    expect(overview.refreshMount).toHaveBeenCalledOnce();
    get.mockResolvedValue({ status: 200, body: { mount_id: 'mount-demo', revision: 42, atlas_version: 5 } } as never);
    await refreshAtlasProject('project-demo');
    expect(overview.refreshMount).toHaveBeenCalledTimes(2);
    expect(review.refresh).toHaveBeenCalledOnce();
    get.mockResolvedValue({ status: 200, body: { mount_id: 'mount-demo', revision: 43, atlas_version: 5 } } as never);
    await refreshAtlasProject('project-demo');
    expect(review.refresh).toHaveBeenCalledTimes(2);
  });
  it('shares one in-flight read per project and the last seen bundle with notices', async () => {
    await Promise.all([refreshAtlasProject('project-demo'), refreshAtlasProject('project-demo')]);
    expect(get).toHaveBeenCalledOnce();
    expect(review.refresh).toHaveBeenCalledOnce();
    await atlasSyncedNotice(atlasSyncedFixture);
    expect(review.refresh).toHaveBeenCalledOnce();
    expect(overview.refreshMount).toHaveBeenCalledOnce();
  });
  it('records a version only after a successful refresh, so a failed refresh is retried', async () => {
    vi.mocked(overview.refreshMount).mockRejectedValueOnce(new Error('offline'));
    await expect(refreshAtlasProject('project-demo')).rejects.toThrow('offline');
    await refreshAtlasProject('project-demo');
    expect(review.refresh).toHaveBeenCalledTimes(2);
    expect(overview.refreshMount).toHaveBeenCalledTimes(2);
    await refreshAtlasProject('project-demo');
    expect(overview.refreshMount).toHaveBeenCalledTimes(2);
  });
  it('forgets versions when the identity changes', async () => {
    await refreshAtlasProject('project-demo');
    identity.revision++;
    await refreshAtlasProject('project-demo');
    expect(review.refresh).toHaveBeenCalledTimes(2);
  });
  it('ignores a reply that arrives after the identity changed', async () => {
    let finish!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as never);
    const pending = refreshAtlasProject('project-demo');
    identity.revision++;
    finish({ status: 200, body: { mount_id: 'mount-demo', revision: 42, atlas_version: 4 } });
    await pending;
    expect(review.refresh).not.toHaveBeenCalled();
    expect(overview.refreshMount).not.toHaveBeenCalled();
  });
  it.each([undefined, -1, 1.5, '4', false, {}, [], NaN, Infinity])('rejects invalid atlas_version %j without refreshing', async atlas_version => {
    get.mockResolvedValueOnce({ status: 200, body: { mount_id: 'mount-demo', revision: 42, atlas_version } } as never);
    await expect(refreshAtlasProject('project-demo')).rejects.toThrow('unavailable');
    expect(overview.refreshMount).not.toHaveBeenCalled();
    expect(review.refresh).not.toHaveBeenCalled();
  });
  it.each(['404', 'network', 'other mount', 'bad mount id'])('rejects a %s reply without refreshing', async failure => {
    if (failure === '404') get.mockResolvedValue({ status: 404, body: {} } as never);
    else if (failure === 'network') get.mockRejectedValue(new Error('unavailable offline'));
    else if (failure === 'bad mount id') get.mockResolvedValue({ status: 200, body: { mount_id: '../x', revision: 42, atlas_version: 4 } } as never);
    await expect(refreshAtlasProject('project-demo', failure === 'other mount' ? 'mount-other' : undefined)).rejects.toThrow('unavailable');
    expect(review.refresh).not.toHaveBeenCalled();
    expect(overview.refreshMount).not.toHaveBeenCalled();
  });
});
