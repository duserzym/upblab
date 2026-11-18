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
