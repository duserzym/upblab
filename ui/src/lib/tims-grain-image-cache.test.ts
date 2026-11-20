import { expect, it, vi } from 'vitest';
import { AtlasHttpError, GrainImageCache, TileQueue } from './tims-grain-image-cache';
import { grainCrop } from './tims-grain-image';
import { inventedAtlas, inventedElements, atlasListing } from '../../tests/fixtures/tims-atlas';

it('adds only 3 listings and 3 manifests for 15 grains on 3 mounts, and remains bounded for 5000', async () => {
  for (const count of [15, 5000]) {
    const json = vi.fn().mockResolvedValue(inventedAtlas), cache = new GrainImageCache(json);
    const elements = vi.fn((mount: number) => Promise.resolve({ ...inventedElements, grains: Array.from({ length: Math.ceil(count / 3) }, (_, i) => ({ ...inventedElements.grains[0], id: `grain-${mount}-${i}`, polygon_um: inventedElements.grains[0].polygon_um!.map(([x, y]) => [x + i % 5, y]) })) }));
    const listing = vi.fn((mount: number) => Promise.resolve({ ...atlasListing, current: { ...atlasListing.current, project_id: `project-${mount}`, base_url: `/atlas/projects/project-${mount}/` } }));
    const before = performance.now();
    await Promise.all([0, 1, 2].map(mount => elements(mount)));
    const beforeMs = performance.now() - before;
    elements.mockClear();
    const start = performance.now();
    const crops = await Promise.all(Array.from({ length: count }, async (_, i) => {
      const mount = i % 3;
      const geometry = await cache.elements('account/server', `mount-${mount}`, () => elements(mount));
      const image = await cache.published('account/server', 'https://invented.example/prefix', `mount-${mount}`, () => listing(mount));
      const crop = grainCrop(image.atlas, geometry.grains[Math.floor(i / 3)], geometry.spots[0], 72);
      return crop.tiles.map(t => image.url(t.path));
    }));
    expect(elements).toHaveBeenCalledTimes(3); expect(listing).toHaveBeenCalledTimes(3); expect(json).toHaveBeenCalledTimes(3);
    expect(new Set(crops.flat()).size).toBe(3); // One shared cell tile per invented mount.
    expect(crops[0][0]).toBe('https://invented.example/prefix/atlas/projects/project-0/pyramid/area-a/1/0_0.webp?version=3&access=invented-read-access');
    console.info(`TIMS images, ${count} grains / 3 mounts: before 3 element reads in ${beforeMs.toFixed(2)} ms; after 9 metadata reads in ${(performance.now() - start).toFixed(2)} ms, 3 distinct cell tile URLs (mock network).`);
  }
});
it('shares a token renewal after tile errors, expires grants after 12 h and keeps each version immutable', async () => {
  let now = 1000;
  const json = vi.fn().mockResolvedValue(inventedAtlas), cache = new GrainImageCache(json, () => now);
  const read = vi.fn().mockResolvedValue(atlasListing);
  const old = await cache.published('scope', 'https://invented.example', 'mount', read);
  read.mockResolvedValue({ ...atlasListing, access: 'renewed' });
  const renewed = await Promise.all(Array.from({ length: 15 }, () => cache.published('scope', 'https://invented.example', 'mount', read, old)));
  expect(read).toHaveBeenCalledTimes(2); expect(json).toHaveBeenCalledTimes(1);
  expect(renewed.every(r => r.url('tile').endsWith('access=renewed'))).toBe(true);
  now += 12 * 60 * 60 * 1000;
  await cache.published('scope', 'https://invented.example', 'mount', read);
  expect(read).toHaveBeenCalledTimes(3); expect(json).toHaveBeenCalledTimes(1);
  now += 12 * 60 * 60 * 1000;
  read.mockResolvedValue({ ...atlasListing, current: { ...atlasListing.current, version: 4 } });
  await cache.published('scope', 'https://invented.example', 'mount', read);
  expect(json).toHaveBeenCalledTimes(2);
});
it.each([401, 403])('refreshes signed access on atlas.json HTTP %s once for all grains', async status => {
  const json = vi.fn().mockRejectedValueOnce(new AtlasHttpError(status, `Atlas returned ${status}: expired access`)).mockResolvedValue(inventedAtlas);
  const cache = new GrainImageCache(json), read = vi.fn().mockResolvedValue(atlasListing);
  const replies = await Promise.all(Array.from({ length: 15 }, () => cache.published('scope', 'https://invented.example', 'mount', read)));
  expect(replies).toHaveLength(15); expect(read).toHaveBeenCalledTimes(2); expect(json).toHaveBeenCalledTimes(2);
});
it('caches missing atlases and unavailable listings per mount without per-grain request storms', async () => {
  const cache = new GrainImageCache(vi.fn()), missing = vi.fn().mockResolvedValue({ current: null, access: null });
  const read404 = vi.fn().mockRejectedValue(new AtlasHttpError(404, 'Server returned 404: no published atlas'));
  for (const read of [missing, read404]) {
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => cache.published('scope', 'https://invented.example', read === missing ? 'none' : '404', read)));
    expect(results.every(r => r.status === 'rejected')).toBe(true); expect(read).toHaveBeenCalledTimes(1);
  }
});
it('backs off a failed manifest across newly visible grains and retries after the backoff', async () => {
  let now = 1000;
  const json = vi.fn().mockRejectedValueOnce(new AtlasHttpError(503, 'Atlas returned 503: maintenance')).mockResolvedValue(inventedAtlas);
  const cache = new GrainImageCache(json, () => now), read = vi.fn().mockResolvedValue(atlasListing);
  for (let i = 0; i < 15; i++) await expect(cache.published('scope', 'https://invented.example', 'mount', read)).rejects.toThrow('503');
  expect(read).toHaveBeenCalledTimes(1); expect(json).toHaveBeenCalledTimes(1);
  now += 30_000;
  await cache.published('scope', 'https://invented.example', 'mount', read);
  expect(read).toHaveBeenCalledTimes(1); expect(json).toHaveBeenCalledTimes(2);
});
it('clears account, server and view scopes and refuses old in-flight replies after sign-out', async () => {
  const json = vi.fn().mockResolvedValue(inventedAtlas), cache = new GrainImageCache(json), read = vi.fn().mockResolvedValue(atlasListing);
  for (const scope of ['account-a/server-a', 'account-b/server-a', 'account-b/server-b', 'account-b/server-b/view-as']) await cache.published(scope, 'https://invented.example', 'mount', read);
  expect(read).toHaveBeenCalledTimes(4); expect(json).toHaveBeenCalledTimes(4);
  let finish!: (value: typeof atlasListing) => void;
  const pending = cache.published('scope', 'https://invented.example', 'mount', () => new Promise(resolve => { finish = resolve; }));
  cache.clear(); finish(atlasListing);
  await expect(pending).rejects.toThrow('account or server changed');
});
it('starts at most six actual SVG tiles and skips cells disposed before their turn', () => {
  const queue = new TileQueue(), starts: number[] = [], releases: (() => void)[] = [];
  const cancel = Array.from({ length: 30 }, (_, i) => queue.add(release => { starts.push(i); releases.push(release); }));
  expect(starts).toEqual([0, 1, 2, 3, 4, 5]);
  cancel[6](); releases[0](); expect(starts.at(-1)).toBe(7);
  releases[0](); expect(starts).toHaveLength(7);
  for (let i = 1; i < releases.length; i++) releases[i]();
  expect(starts).toHaveLength(29); expect(starts).not.toContain(6);
});
it('does not renew an old grant under another account after a late manifest refusal', async () => {
  let refuse!: (error: Error) => void;
  const json = vi.fn(() => new Promise<typeof inventedAtlas>((_, reject) => { refuse = reject; }));
  const cache = new GrainImageCache(json), read = vi.fn().mockResolvedValue(atlasListing);
  const pending = cache.published('old-account', 'https://invented.example', 'mount', read);
  await vi.waitFor(() => expect(json).toHaveBeenCalledTimes(1));
  cache.clear(); refuse(new AtlasHttpError(401, 'Atlas returned 401: expired'));
  await expect(pending).rejects.toThrow('account or server changed');
  expect(read).toHaveBeenCalledTimes(1);
});
