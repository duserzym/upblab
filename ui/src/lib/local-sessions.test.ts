import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), open: vi.fn() }));
vi.mock('./platform', () => ({ localSessions: mocks.list, openLocalSession: mocks.open }));
vi.mock('./shell.svelte', () => ({ shell: { studioConfig: { path: '', checkout: '' } } }));
const { LocalSessions } = await import('./local-sessions.svelte');
beforeEach(() => { vi.clearAllMocks(); });
it('caps large inventories, loads once and explicitly refreshes', async () => {
  mocks.list.mockResolvedValue(Array.from({ length: 3000 }, (_, n) => ({ path: `/invented/${n}`, key: `local${n}` })));
  const local = new LocalSessions(); await local.load(); await local.load();
  expect(local.rows).toHaveLength(500); expect(mocks.list).toHaveBeenCalledTimes(1);
  await local.load(true); expect(mocks.list).toHaveBeenCalledTimes(2);
});
it('opens local folders directly and surfaces launch failures inline', async () => {
  const local = new LocalSessions();
  const row = { path: '/invented/local', key: 'local' } as never;
  mocks.open.mockRejectedValue(new Error('Studio is missing'));
  await local.open(row); expect(mocks.open).toHaveBeenCalledWith('/invented/local', { path: '', checkout: '' });
  expect(local.error).toContain('Studio is missing'); expect(local.opening).toBe('');
});
it('preserves manifest compatibility fields and never opens old-format bundles', async () => {
  const old = { path: '/invented/old', key: 'old', format: 'laicpmsdb-session-bundle', openable: false };
  const current = { path: '/invented/current', key: 'current', format: 'upbdb-session-bundle', openable: true };
  const earliest = { path: '/invented/earliest', key: 'earliest', format: null, openable: true };
  mocks.list.mockResolvedValue([old, current, earliest]);
  mocks.open.mockResolvedValue(undefined);
  const local = new LocalSessions(); await local.load();
  expect(local.rows).toEqual([old, current, earliest]);
  await local.open(local.rows[0]);
  expect(mocks.open).not.toHaveBeenCalled();
  expect(local.opening).toBe(''); expect(local.error).toBe('');
  await local.open(local.rows[1]); await local.open(local.rows[2]);
  expect(mocks.open).toHaveBeenCalledTimes(2);
  expect(mocks.open).toHaveBeenNthCalledWith(1, current.path, { path: '', checkout: '' });
  expect(mocks.open).toHaveBeenNthCalledWith(2, earliest.path, { path: '', checkout: '' });
});
