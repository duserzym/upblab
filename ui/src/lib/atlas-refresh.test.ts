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
  get.mockResolvedValue({ status: 200, body: { mount_id: 'mount-demo', revision: 42 } } as never);
});
describe('sync refreshes', () => {
  it('deduplicates by mount and revision across project ids and forwards only to open Sessions', async () => {
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
    get.mockResolvedValue({ status: 200, body: { mount_id: 'mount-demo', revision: 43 } } as never);
    await checkStandaloneSync(62_000);
    expect(review.load).toHaveBeenCalledTimes(2);
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
