import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'https://invented.example' }, account: { id: 'invented-account' }, revision: 0 } }));
vi.mock('./tims-api', async original => ({ ...await original<typeof import('./tims-api')>(), tims: { columnProtocols: vi.fn() } }));
vi.mock('./tims-rights.svelte', () => ({ timsRights: {} }));
vi.mock('./outbox.svelte', () => ({ outbox: {}, onlineOnlyReason: () => '' }));
import { identity } from './identity.svelte';
import { tims, TimsReadError, type ColumnProtocolOut, type ListPage } from './tims-api';
import { LabColumnProtocols } from './tims-lab-protocols.svelte';
const row: ColumnProtocolOut = { id: 'invented-protocol', lab_id: 'invented-lab', scheme: 'HCl anion', title: 'Invented protocol', text: 'Invented column\nStep A: rinse twice.', attribution: 'Invented lab', source_url: 'https://example.org/invented', revision: 1, created_at: '2026-11-23T10:00:00Z', updated_at: '2026-11-23T10:00:00Z', created_by_id: 'invented-account' };
const page = (items = [row]): ListPage<ColumnProtocolOut> => ({ items, nextCursor: null, more: async () => null });
beforeEach(() => {
  vi.clearAllMocks(); identity.revision = 0; identity.account!.id = 'invented-account'; identity.target!.server = 'https://invented.example';
  vi.mocked(tims.columnProtocols).mockResolvedValue(page());
});
it('shares one bounded read across 5000 invented capsule consumers and never fetches during lookups', async () => {
  const store = new LabColumnProtocols(), start = performance.now();
  await Promise.all(Array.from({ length: 5000 }, () => store.load(row.lab_id)));
  for (let i = 0; i < 5000; i++) expect(store.labProtocol(row.lab_id, row.scheme)).toEqual(row);
  await store.load(row.lab_id);
  expect(tims.columnProtocols).toHaveBeenCalledExactlyOnceWith({ lab: row.lab_id, limit: '2' });
  expect(store.labProtocol(row.lab_id, 'HBr-HCl')).toBeNull();
  console.info(`TIMS lab protocols: 0 previous requests; 1 shared request for 5000 invented consumers, ${(performance.now() - start).toFixed(1)} ms (mock network).`);
});
it('publishes a page immediately and loads the next cursor only on demand', async () => {
  const second = { ...row, id: 'invented-second', scheme: 'HBr-HCl' as const };
  const more = vi.fn(async () => page([second]));
  vi.mocked(tims.columnProtocols).mockResolvedValue({ ...page(), nextCursor: 'invented-cursor', more });
  const store = new LabColumnProtocols(); await store.load(row.lab_id);
  expect(store.labProtocol(row.lab_id, row.scheme)).toEqual(row); expect(more).not.toHaveBeenCalled();
  await store.load(row.lab_id, false, true);
  expect(store.labProtocol(row.lab_id, second.scheme)).toEqual(second); expect(more).toHaveBeenCalledTimes(1);
  expect(store.labProtocol(row.lab_id, row.scheme)).toEqual(row);
});
it('treats only 404 as absent and reports other read failures without dropping a saved protocol', async () => {
  const store = new LabColumnProtocols();
  vi.mocked(tims.columnProtocols).mockRejectedValueOnce(new TimsReadError(404, {}, 'Server returned 404: Not found'));
  await store.load(row.lab_id); expect(store.state(row.lab_id)).toMatchObject({ loaded: true, error: '', rows: {} });
  await store.load(row.lab_id, true);
  vi.mocked(tims.columnProtocols).mockRejectedValueOnce(new TimsReadError(503, {}, 'Server returned 503: Invented maintenance'));
  await store.load(row.lab_id, true);
  expect(store.state(row.lab_id).error).toContain('503: Invented maintenance');
  expect(store.labProtocol(row.lab_id, row.scheme)).toEqual(row);
});
it('isolates labs, server and account changes and rejects late responses from an earlier identity', async () => {
  const store = new LabColumnProtocols(); await store.load(row.lab_id);
  expect(store.labProtocol('another-lab', row.scheme)).toBeNull();
  identity.account!.id = 'another-account'; expect(store.labProtocol(row.lab_id, row.scheme)).toBeNull();
  await store.load(row.lab_id); expect(tims.columnProtocols).toHaveBeenCalledTimes(2);
  let finish!: (value: ListPage<ColumnProtocolOut>) => void;
  vi.mocked(tims.columnProtocols).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const old = store.load(row.lab_id, true);
  identity.target!.server = 'https://another-invented.example';
  expect(store.labProtocol(row.lab_id, row.scheme)).toBeNull();
  vi.mocked(tims.columnProtocols).mockResolvedValue(page([]));
  await store.load(row.lab_id); finish(page()); await old;
  expect(store.labProtocol(row.lab_id, row.scheme)).toBeNull();
  identity.revision++; expect(store.state(row.lab_id).loaded).toBe(false);
});
it('publishes saves and revalidates the list through identity for the existing offline mirror', async () => {
  const store = new LabColumnProtocols(); await store.load(row.lab_id);
  const saved = { ...row, text: 'Invented changed column', revision: 2 };
  let finish!: (value: ListPage<ColumnProtocolOut>) => void;
  vi.mocked(tims.columnProtocols).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const saving = store.saved(saved);
  expect(store.labProtocol(row.lab_id, row.scheme)).toEqual(saved);
  expect(tims.columnProtocols).toHaveBeenCalledTimes(2);
  finish(page([saved])); await saving;
  // A cached identity GET returns the same rows offline; no new protocol cache is introduced.
  vi.mocked(tims.columnProtocols).mockResolvedValue(page([saved]));
  const reopened = new LabColumnProtocols(); await reopened.load(row.lab_id);
  expect(reopened.labProtocol(row.lab_id, row.scheme)).toEqual(saved);
});

it('ignores an older read superseded by a save in the same identity', async () => {
  let finish!: (value: ListPage<ColumnProtocolOut>) => void;
  vi.mocked(tims.columnProtocols).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const store = new LabColumnProtocols(), old = store.load(row.lab_id);
  const saved = { ...row, revision: 2, text: 'Invented newer column' };
  vi.mocked(tims.columnProtocols).mockResolvedValue(page([saved]));
  await store.saved(saved); finish(page()); await old;
  expect(store.labProtocol(row.lab_id, row.scheme)).toEqual(saved);
});

it('keeps the saved revision when post-save revalidation falls back to an older offline list', async () => {
  const store = new LabColumnProtocols(); await store.load(row.lab_id);
  const saved = { ...row, revision: 2, text: 'Invented saved column' };
  await store.saved(saved); // The mirrored GET still returns revision 1.
  expect(store.labProtocol(row.lab_id, row.scheme)).toEqual(saved);
  vi.mocked(tims.columnProtocols).mockResolvedValue(page([]));
  await store.saved({ ...saved, revision: 3 }); // The prior mirror may also have had no protocol.
  expect(store.labProtocol(row.lab_id, row.scheme)?.revision).toBe(3);
});
