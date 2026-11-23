import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'https://invented.example' }, revision: 1, account: { id: 'invented' }, get: vi.fn() } }));
vi.mock('./tims-rights.svelte', () => ({ timsRights: { recordReason: () => '' } }));
vi.mock('./outbox.svelte', () => ({ outbox: {}, onlineOnlyReason: () => '' }));
import { identity } from './identity.svelte';
import { grainImages } from './tims-grain-image-cache';
import { mountElements } from './tims-requests';
import { findSpotMounts, mountSpotIndex } from './tims-spot-finder';
import type { MountGeometry } from './tims-geometry';

const mounts = ['a', 'b'].map(id => ({ id, label: `Invented mount ${id}`, atlas: null }));
function elements(sample: string, count = 1): MountGeometry {
  return { current_project_uuid: null,
    grains: Array.from({ length: count }, (_, i) => ({ id: `a${i}`, server_id: `g${i}`, label: `grain/${i}`, sample, polygon_um: null })),
    spots: Array.from({ length: count }, (_, i) => ({ id: `s${i}`, server_id: `s${i}`, grain_id: `a${i}`, name: `${sample}_S_${i + 195}`, x_um: 0, y_um: 0 })),
  };
}
beforeEach(() => { vi.resetAllMocks(); grainImages.clear(); identity.revision = 1; });

it('finds the sample on the right mount, reuses its index and snapshot, and measures bounded reads on large mounts', async () => {
  const first = elements('ZZ02', 5000), second = elements('ZZ01', 5000);
  vi.mocked(identity.get).mockImplementation(async path => ({ status: 200, body: path.endsWith('/elements') ? path.includes('/a/') ? first : second : mounts }) as never);
  const before = performance.now();
  await mountElements('b');
  const baseline = performance.now() - before;
  expect(identity.get).toHaveBeenCalledTimes(1);
  vi.mocked(identity.get).mockClear();
  const start = performance.now(), publish = vi.fn();
  const found = await findSpotMounts('ZZ01 195', 'ZZ01', publish, () => true);
  const elapsed = performance.now() - start;
  expect(found.matches.map(m => m.mount.id)).toEqual(['b']);
  expect(found.matches[0].matches[0].spotNames).toEqual(['ZZ01_S_195']);
  expect(found.checked).toBe(2);
  expect(publish).toHaveBeenCalledTimes(2);
  expect(vi.mocked(identity.get).mock.calls.map(([path]) => path)).toEqual(['/v1/mounts?limit=5&q=ZZ01', '/v1/mounts/a/elements']);
  expect(mountSpotIndex(second)).toBe(mountSpotIndex(await mountElements('b')));
  await findSpotMounts('S 195', 'ZZ01', vi.fn(), () => true);
  expect(vi.mocked(identity.get).mock.calls.filter(([path]) => path.endsWith('/elements'))).toHaveLength(1);
  console.info(`TIMS Find spot / two 5000-grain mounts: before 1 manual mount read in ${baseline.toFixed(2)} ms; after 1 bounded list + 1 uncached mount in ${elapsed.toFixed(2)} ms; repeated search 0 element reads (mock network).`);
});

it('publishes each mount progressively, but returns matches in server order', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(identity.get).mockImplementation(path => path.includes('/a/elements') ? new Promise(resolve => { finish = resolve as typeof finish; }) : Promise.resolve({ status: 200, body: path.endsWith('/elements') ? elements('ZZ01') : mounts }) as never);
  const publish = vi.fn(), pending = findSpotMounts('195', 'ZZ01', publish, () => true);
  await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
  expect(publish.mock.calls[0][0].matches[0].mount.id).toBe('b');
  finish({ status: 200, body: elements('ZZ01') });
  expect((await pending).matches.map(m => m.mount.id)).toEqual(['a', 'b']);
});

it('follows short list pages with cursors but reads no more than five candidate mounts', async () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ ...mounts[0], id: `m${i}` }));
  vi.mocked(identity.get).mockImplementation(async path => ({ status: 200,
    body: path.endsWith('/elements') ? elements('ZZ01') : path.includes('after=') ? rows.slice(2) : rows.slice(0, 2),
    nextCursor: !path.endsWith('/elements') && !path.includes('after=') ? 'next' : null,
  }) as never);
  const found = await findSpotMounts('195', 'ZZ01', vi.fn(), () => true);
  expect(found.matches).toHaveLength(5);
  expect(found.checked).toBe(5);
  expect(found.hasMore).toBe(true);
  expect(identity.get).toHaveBeenCalledWith('/v1/mounts?limit=5&after=next&q=ZZ01');
  expect(vi.mocked(identity.get).mock.calls.filter(([path]) => path.endsWith('/elements'))).toHaveLength(5);
});

it('retains successful mount choices and reports a failed candidate with its status and reply', async () => {
  vi.mocked(identity.get).mockImplementation(async path => (path.includes('/a/elements') ? { status: 403, body: { detail: 'Invented refusal' } } : { status: 200, body: path.endsWith('/elements') ? elements('ZZ01') : mounts }) as never);
  const found = await findSpotMounts('195', 'ZZ01', vi.fn(), () => true);
  expect(found.matches).toHaveLength(1);
  expect(found.errors[0]).toMatch(/Invented mount a.*403.*Invented refusal/);
});

it('does not publish or load elements for a superseded lookup', async () => {
  vi.mocked(identity.get).mockResolvedValue({ status: 200, body: mounts });
  const publish = vi.fn();
  await findSpotMounts('195', 'ZZ01', publish, () => false);
  expect(publish).not.toHaveBeenCalled();
  expect(identity.get).toHaveBeenCalledTimes(1);
});
