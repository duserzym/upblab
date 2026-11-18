import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const get = vi.fn();
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'https://invented.invalid', key: 'server' }, revision: 0, signedIn: true, get: (path: string) => get(path) } }));
vi.mock('./platform', () => ({ logInfo: vi.fn() }));
import { RecordList, ownerName } from './records.svelte';
import { oversight } from './oversight.svelte';
import { identity } from './identity.svelte';
beforeEach(() => { get.mockReset(); oversight.reset(); identity.revision = 0; });
afterEach(() => { vi.useRealTimers(); });
it('uses bounded pages, combines narrowing filters and preserves owners without row requests', async () => {
  const all = Array.from({ length: 3000 }, (_, i) => ({ id: `s${i}`, name: `Invented ${i}`, owner_name: 'Cedar' }));
  oversight.filters = { owner: 'cedar', team: 'Team A', project: 'DEMO', lab: 'lab' };
  get.mockResolvedValueOnce({ status: 200, body: all.slice(0, 500), nextCursor: 'opaque/next' }).mockResolvedValueOnce({ status: 200, body: all.slice(500, 1000) });
  const list = new RecordList<{ id: string; name: string; owner_name: string }>('/v1/samples', true);
  const start = performance.now(); await list.load();
  expect(list.rows).toHaveLength(500); expect(get).toHaveBeenCalledTimes(1); expect(ownerName(list.rows[0])).toBe('Cedar');
  expect(get.mock.calls[0][0]).toBe('/v1/samples?limit=500&owner=cedar&team=Team+A&project=DEMO&lab=lab');
  await list.load(true); expect(list.rows).toHaveLength(1000); expect(list.cursor).toBeNull(); expect(get).toHaveBeenCalledTimes(2);
  expect(get.mock.calls[1][0]).toContain('&after=opaque%2Fnext&owner=cedar');
  console.info(`[records scale] 3000 available, 1000 requested: ${get.mock.calls.length} reads in ${(performance.now() - start).toFixed(1)} ms`);
});
it('drops rows and rejects an old in-flight page when view-as or filters change', async () => {
  let finish!: (r: unknown) => void;
  get.mockResolvedValueOnce({ status: 200, body: [{ id: 'old' }], nextCursor: 'next' });
  const list = new RecordList('/v1/projects', true); await list.load();
  get.mockImplementationOnce(() => new Promise(resolve => finish = resolve)); const old = list.load(true);
  oversight.select({ username: 'cedar', name: 'Cedar' }); identity.revision++;
  get.mockResolvedValueOnce({ status: 200, body: [{ id: 'new' }] });
  const fresh = list.load(); expect(list.rows).toEqual([]); await fresh;
  finish({ status: 200, body: [{ id: 'stale' }] }); await old; expect(list.rows).toEqual([{ id: 'new' }]);
  oversight.filters.owner = 'moss'; get.mockResolvedValueOnce({ status: 200, body: [] }); await list.load(); expect(list.rows).toEqual([]);
});
it('reports the status and reply excerpt instead of a generic failure', async () => {
  get.mockResolvedValue({ status: 503, body: { detail: 'Invented server unavailable' } });
  const list = new RecordList('/v1/labs'); await list.load(); expect(list.error).toContain('503'); expect(list.error).toContain('Invented server unavailable');
});
it('retains loaded pages for 60 seconds and allows explicit refresh, expiry and clearing', async () => {
  vi.useFakeTimers();
  get.mockResolvedValueOnce({ status: 200, body: [{ id: 'one' }], nextCursor: 'next' })
    .mockResolvedValueOnce({ status: 200, body: [{ id: 'two' }] })
    .mockResolvedValue({ status: 200, body: [] });
  const list = new RecordList('/v1/accounts', false, { view_as: 'true' });
  await list.load(); await list.load(true); await list.load();
  expect(list.rows).toEqual([{ id: 'one' }, { id: 'two' }]); expect(get).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(59_999); await list.load(); expect(get).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1); await list.load(); expect(get).toHaveBeenCalledTimes(3);
  await list.load(false, { force: true }); expect(get).toHaveBeenCalledTimes(4);
  list.clear(); await list.load(); expect(get).toHaveBeenCalledTimes(5);
  expect(get.mock.calls[0][0]).toBe('/v1/accounts?limit=500&view_as=true');
});
it('retains failures until explicit retry and never shares fresh rows across accounts or servers', async () => {
  get.mockResolvedValueOnce({ status: 503, body: {} }).mockResolvedValue({ status: 200, body: [] });
  const list = new RecordList('/v1/labs');
  await list.load(); await list.load(); expect(get).toHaveBeenCalledTimes(1); expect(list.error).toContain('503');
  await list.load(false, { force: true }); expect(get).toHaveBeenCalledTimes(2); expect(list.error).toBe('');
  identity.revision++; await list.load(); expect(get).toHaveBeenCalledTimes(3);
  const target = identity.target;
  try { identity.target = { ...target!, server: 'https://other.invalid' }; await list.load(); expect(get).toHaveBeenCalledTimes(4); }
  finally { identity.target = target; }
});
it('reuses Home directory pages on reactivation with thousands of available rows', async () => {
  const rows = Array.from({ length: 3000 }, (_, i) => ({ id: `person-${i}` }));
  get.mockResolvedValue({ status: 200, body: rows.slice(0, 500), nextCursor: 'next' });
  const lists = () => [new RecordList('/v1/accounts'), new RecordList('/v1/groups'), new RecordList('/v1/labs'),
    new RecordList('/v1/projects'), new RecordList('/v1/samples', true), new RecordList('/v1/projects', true)];
  const before = lists(), after = lists();
  const started = performance.now();
  for (let activation = 0; activation < 2; activation++) await Promise.all(before.map(list => list.load(false, { force: true })));
  const beforeTime = performance.now() - started, beforeCount = get.mock.calls.length;
  get.mockClear(); const cachedStart = performance.now();
  for (let activation = 0; activation < 2; activation++) await Promise.all(after.map(list => list.load()));
  expect(beforeCount).toBe(12); expect(get).toHaveBeenCalledTimes(6);
  expect(after.every(list => list.rows.length === 500 && list.cursor === 'next')).toBe(true);
  console.info(`[records reactivation] before: ${beforeCount} reads in ${beforeTime.toFixed(2)} ms; after: ${get.mock.calls.length} reads in ${(performance.now() - cachedStart).toFixed(2)} ms`);
});
it('shows only recorded owner labels', () => {
  expect(ownerName({ owner_name: 'Cedar Analyst', owner: 'cedar' })).toBe('Cedar Analyst');
  expect(ownerName({ owner: 'cedar' })).toBe('cedar');
  expect(ownerName({ creator: { name: 'Moss Analyst' } })).toBe('Moss Analyst');
  expect(ownerName({})).toBe('');
});
