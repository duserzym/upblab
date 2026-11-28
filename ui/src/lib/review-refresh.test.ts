import { beforeEach, expect, it, vi } from 'vitest';
import type { MountGeometry } from './tims-geometry';
import { normalise } from './review-data';
import { rows, session, mount } from '../../tests/fixtures/review';
import { inventedElements } from '../../tests/fixtures/tims-atlas';
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'https://invented.invalid' }, signedIn: true, account: { id: 'synthetic' }, revision: 0, get: vi.fn() } }));
vi.mock('./review.svelte', () => ({ review: { refreshContext: 'initial', state: 'ready', scope: { kind: 'session', id: 'session', run: 'chosen-run' }, rows: [], mounts: [], sessions: [], region: null, refresh: vi.fn() } }));
vi.mock('./overview.svelte', () => ({ overview: { refreshMount: vi.fn() } }));
vi.mock('./atlas-refresh', () => ({ readAtlasProject: vi.fn() }));
vi.mock('./incoming', () => ({ reloadReviewViewer: vi.fn(async () => {}) }));
// Exercise the real shared geometry cache, without pulling the unrelated TIMS forms into this test.
vi.mock('./tims-requests', async () => {
  const { grainImages } = await import('./tims-grain-image-cache');
  const { identity } = await import('./identity.svelte');
  return { mountElements: (mount: string, revalidate = false) => grainImages.elements(String(identity.revision), mount, async () => {
    const reply = await identity.get<MountGeometry>(`/v1/mounts/${mount}/elements`);
    if (reply.status !== 200) throw new Error(`Server returned ${reply.status}: ${(reply.body as unknown as { detail: string }).detail}`);
    return reply.body;
  }, revalidate) };
});
const { identity } = await import('./identity.svelte');
const { review } = await import('./review.svelte');
const { overview } = await import('./overview.svelte');
const { readAtlasProject } = await import('./atlas-refresh');
const { reloadReviewViewer } = await import('./incoming');
const { grainImages } = await import('./tims-grain-image-cache');
const { mountElements } = await import('./tims-requests');
const { ReviewRefresh } = await import('./review-refresh.svelte');
let refresh: InstanceType<typeof ReviewRefresh>;
beforeEach(() => {
  vi.resetAllMocks(); grainImages.clear(); identity.revision++;
  (review as unknown as { refreshContext: string }).refreshContext = `context-${identity.revision}`;
  review.scope = { kind: 'session', id: session.id, run: 'chosen-run' };
  review.state = 'ready'; review.rows = rows.map(row => normalise(row)) as never;
  review.mounts = [mount] as never; review.sessions = [session] as never; review.region = null;
  vi.mocked(review.refresh).mockResolvedValue(undefined);
  vi.mocked(identity.get).mockImplementation(async path => ({ status: 200, body: path.endsWith('/elements') ? inventedElements : session }) as never);
  vi.mocked(overview.refreshMount).mockResolvedValue({ mount: { ...mount, spot_count: 99 }, atlas: { projectId: 'project-demo', version: 4 } } as never);
  vi.mocked(readAtlasProject).mockResolvedValue({ status: 200, body: { mount_id: mount.id, revision: 42, atlas_version: 4 } } as never);
  vi.mocked(reloadReviewViewer).mockResolvedValue(undefined);
  refresh = new ReviewRefresh();
});
it('deduplicates clicks, preserves scope/run and refreshes only current scope summaries', async () => {
  let finish!: () => void;
  vi.mocked(review.refresh).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const scope = review.scope;
  const pending = refresh.refresh();
  expect(refresh.refresh()).toBe(pending);
  expect(refresh.state).toBe('loading');
  expect(refresh.message).toContain('Refreshing');
  finish(); await pending;
  expect(review.scope).toBe(scope);
  expect(review.refresh).toHaveBeenCalledOnce();
  expect(overview.refreshMount).toHaveBeenCalledExactlyOnceWith(mount.id, { strict: true });
  expect(identity.get).toHaveBeenCalledWith(`/v1/sessions/${session.id}`);
  expect(identity.get).toHaveBeenCalledWith(`/v1/mounts/${mount.id}/elements`);
  expect(review.mounts[0].spot_count).toBe(99);
  expect(refresh.state).toBe('success');
  expect(refresh.message).toBe('Database refreshed.');
});
it('updates same-version cached outlines and spot-to-grain links, then reloads the viewer once', async () => {
  const old = await mountElements(mount.id);
  const next = { ...inventedElements, grains: inventedElements.grains.map(grain => ({ ...grain, polygon_um: [[1, 1], [3, 1], [2, 3]] })),
    spots: inventedElements.spots.map(spot => ({ ...spot, grain_id: 'synthetic-relinked-grain' })) };
  vi.mocked(identity.get).mockImplementation(async path => ({ status: 200, body: path.endsWith('/elements') ? next : session }) as never);
  await refresh.refresh();
  expect(await mountElements(mount.id)).toEqual(next);
  expect(await mountElements(mount.id)).not.toEqual(old);
  expect(reloadReviewViewer).toHaveBeenCalledOnce();
  expect(refresh.state).toBe('success');
});
it('keeps cached elements on failure and actually revalidates them again on retry', async () => {
  const old = await mountElements(mount.id);
  vi.mocked(identity.get).mockImplementationOnce(async () => ({ status: 200, body: session }) as never)
    .mockImplementationOnce(async () => ({ status: 503, body: { detail: 'Synthetic unavailable' } }) as never);
  await refresh.refresh();
  expect(refresh.state).toBe('error'); expect(refresh.message).toContain('503: Synthetic unavailable');
  expect(await mountElements(mount.id)).toBe(old);
  const reads = vi.mocked(identity.get).mock.calls.length;
  await refresh.refresh();
  expect(refresh.state).toBe('success');
  expect(vi.mocked(identity.get).mock.calls.length).toBe(reads + 2);
});
it.each(['scope', 'account'])('discards stale feedback and follow-up requests when %s changes', async change => {
  let finish!: () => void;
  vi.mocked(review.refresh).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = refresh.refresh();
  (review as unknown as { refreshContext: string }).refreshContext = change;
  if (change === 'account') identity.revision++;
  finish(); await pending;
  expect(refresh.state).toBe('idle'); expect(refresh.message).toBe('');
  expect(overview.refreshMount).not.toHaveBeenCalled(); expect(readAtlasProject).not.toHaveBeenCalled();
});
it('can refresh a new context while an old request remains in flight, without old cleanup hiding progress', async () => {
  let old!: () => void, fresh!: () => void;
  vi.mocked(review.refresh).mockImplementationOnce(() => new Promise(resolve => { old = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { fresh = resolve; }));
  const previous = refresh.refresh(); (review as unknown as { refreshContext: string }).refreshContext = 'next'; const pending = refresh.refresh();
  old(); await previous; expect(refresh.state).toBe('loading'); expect(refresh.refresh()).toBe(pending);
  fresh(); await pending; expect(refresh.state).toBe('success');
});
it('includes new and previously visible mounts, deduplicating thousands of spot rows', async () => {
  const counts: number[] = [], timings: number[] = [];
  for (const count of [15, 5000]) {
    review.rows = Array.from({ length: count }, (_, index) => normalise({ ...rows[0], acquisition_id: `synthetic-${index}`, mount_id: `mount-${index % 3}`, atlas_project_id: `project-${index % 3}` })) as never;
    review.mounts = [];
    vi.mocked(identity.get).mockClear(); vi.mocked(overview.refreshMount).mockClear(); vi.mocked(readAtlasProject).mockClear();
    vi.mocked(overview.refreshMount).mockImplementation(async id => ({ mount: { ...mount, id }, atlas: null }) as never);
    vi.mocked(readAtlasProject).mockImplementation(async id => ({ status: 200, body: { mount_id: id.replace('project-', 'mount-'), revision: 42, atlas_version: 4 } }) as never);
    const start = performance.now(); await refresh.refresh(); timings.push(performance.now() - start);
    expect(refresh.state).toBe('success');
    expect(overview.refreshMount).toHaveBeenCalledTimes(3); expect(readAtlasProject).toHaveBeenCalledTimes(3);
    counts.push(vi.mocked(identity.get).mock.calls.length);
    expect(counts.at(-1)).toBe(4); // Session summary + three mount element reads; never a read per spot.
  }
  console.info(`Manual Review metadata, 15 / 5000 spots on 3 mounts: ${counts.join(' / ')} direct reads + 3 shared mount refreshes + 3 project reads; ${timings.map(ms => ms.toFixed(2)).join(' / ')} ms (mock network). Results refresh is shared once per click group.`);
});
it('ignores mount summaries and project follow-ups arriving after a scope change', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(overview.refreshMount).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish; }) as never);
  const oldMounts = review.mounts;
  const pending = refresh.refresh();
  await vi.waitFor(() => expect(overview.refreshMount).toHaveBeenCalled());
  (review as unknown as { refreshContext: string }).refreshContext = 'other-scope';
  finish({ mount: { ...mount, label: 'Stale summary' }, atlas: null }); await pending;
  expect(review.mounts).toBe(oldMounts); expect(readAtlasProject).not.toHaveBeenCalled();
  expect(refresh.state).toBe('idle');
});
it('does not mistake a saved offline session summary for revalidation success', async () => {
  vi.mocked(identity.get).mockImplementationOnce(async () => ({ status: 200, body: session, cached: { asOf: '2026-11-28T00:00:00Z', reason: 'unreachable', detail: 'Synthetic connection stalled' } }) as never);
  await refresh.refresh();
  expect(refresh.state).toBe('error'); expect(refresh.message).toContain('Synthetic connection stalled');
});
it('reloads the viewer only once when results mention several projects', async () => {
  review.rows = [normalise(rows[0]), normalise({ ...rows[1], atlas_project_id: 'project-other' })] as never;
  vi.mocked(readAtlasProject).mockImplementation(async project => ({ status: 200, body: { mount_id: mount.id, revision: project === 'project-other' ? 43 : 42, atlas_version: 4 } }) as never);
  await refresh.refresh();
  expect(reloadReviewViewer).toHaveBeenCalledOnce();
});
