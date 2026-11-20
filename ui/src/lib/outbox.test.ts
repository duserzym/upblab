import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./platform', () => ({ isDesktop: false }));
vi.mock('./identity.svelte', () => ({ identity: { signedIn: false } }));
import { Outbox, durableOutboxStorage, outboxStorageKey, retryAfterMs, retryDelay, type OutboxEntry, type OutboxScope } from './outbox.svelte';
import { WriteError } from './oversight.svelte';
const A = { server: 'https://synthetic.example', accountId: 'account-a' };
const B = { ...A, accountId: 'account-b' };
const input = (objectKey = 'batch:1', body: unknown = { notes: 'local' }) => ({ objectKey, method: 'PATCH' as const, path: '/v1/tims/batches/1', body });
const boxes: Outbox[] = [];
afterEach(() => { boxes.forEach(b => b.stop()); boxes.length = 0; vi.unstubAllGlobals(); });
function setup() {
  const saved = new Map<string, OutboxEntry[]>();
  let online = false, now = 1000, seq = 0;
  const storage = { read: vi.fn(async (key: string) => structuredClone(saved.get(key) ?? [])), write: vi.fn(async (key: string, entries: OutboxEntry[]) => { saved.set(key, structuredClone(entries)); }) };
  const send = vi.fn<(entry: OutboxEntry) => Promise<unknown>>(async () => ({}));
  const deps = { storage, send, reachable: () => online, now: () => now, random: () => 1, uuid: () => `synthetic-${++seq}` };
  const create = () => { const box = new Outbox(deps); boxes.push(box); return box; };
  return { box: create(), create, saved, storage, send, online: (value = true) => online = value, clock: (value: number) => now = value };
}
it('persists the exact request and fixed key, partitioned across restart, server and account', async () => {
  const s = setup(); await s.box.activate(A);
  const body = { parameters: { temperature_c: 190 }, notes: 'Synthetic-A' };
  const entry = await s.box.enqueue(input('batch:1', body)); body.notes = 'changed form';
  const restored = s.create(); await restored.activate(A);
  expect(restored.entries[0]).toEqual(entry); expect(restored.entries[0].body).toMatchObject({ notes: 'Synthetic-A' });
  await restored.activate(B); expect(restored.entries).toEqual([]);
  await restored.activate({ ...A, server: 'https://other.example' }); expect(restored.entries).toEqual([]);
  await restored.activate(null); expect(restored.entries).toEqual([]);
  await restored.activate(A); expect(restored.pending('batch:1')).toHaveLength(1);
  expect(s.saved.get(outboxStorageKey(A))).toHaveLength(1);
});
it('sends in order per object with one in flight, while other objects progress independently', async () => {
  const s = setup(); await s.box.activate(A);
  const first = await s.box.enqueue(input('batch:1', { notes: 'first' }));
  const second = await s.box.enqueue(input('batch:1', { notes: 'second' }));
  const other = await s.box.enqueue(input('batch:2'));
  let finish!: () => void;
  s.send.mockImplementation(e => e.id === first.id ? new Promise(resolve => { finish = () => resolve({}); }) : Promise.resolve({}));
  s.online(); void s.box.flush(); void s.box.flush();
  await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(2));
  expect(s.send.mock.calls.map(([e]) => e.id)).toEqual([first.id, other.id]);
  await s.box.flush(); expect(s.send).toHaveBeenCalledTimes(2);
  finish(); await vi.waitFor(() => expect(s.box.entries).toHaveLength(0));
  expect(s.send.mock.calls.map(([e]) => e.id)).toEqual([first.id, other.id, second.id]);
});
it.each([new WriteError(503, { detail: 'Synthetic maintenance' }, 'Server returned 503: Synthetic maintenance'), new Error('Timed out')])('retries transient failures with backoff and the same key/body', async error => {
  const s = setup(); await s.box.activate(A); const entry = await s.box.enqueue(input());
  s.send.mockRejectedValueOnce(error); s.online(); await s.box.flush();
  expect(s.box.entries[0]).toMatchObject({ attempts: 1, nextAttempt: 6000, stopped: false });
  s.clock(5999); await s.box.flush(); expect(s.send).toHaveBeenCalledTimes(1);
  s.clock(6000); await s.box.flush(); expect(s.send).toHaveBeenCalledTimes(2);
  expect(s.send.mock.calls.map(([e]) => e.idempotencyKey)).toEqual([entry.idempotencyKey, entry.idempotencyKey]);
  expect(s.send.mock.calls[0][0].body).toEqual(s.send.mock.calls[1][0].body); expect(s.box.entries).toEqual([]);
});
it('uses exponential jittered delays capped at five minutes and honors Retry-After seconds and dates', () => {
  expect([1, 2, 3, 7, 20].map(n => retryDelay(n, 1))).toEqual([5000, 10000, 20000, 300000, 300000]);
  expect(retryDelay(1, 0)).toBe(4000); expect(retryAfterMs('7')).toBe(7000); expect(retryAfterMs('0')).toBe(0);
  expect(retryAfterMs('Thu, 01 Jan 1970 00:00:12 GMT', 1000)).toBe(11000);
});
it('waits on an in-progress key rather than putting it in attention', async () => {
  const s = setup(); await s.box.activate(A); await s.box.enqueue(input());
  s.send.mockRejectedValueOnce(new WriteError(409, { code: 'idempotency_in_progress' }, 'Still running', '2'));
  s.online(); await s.box.flush(); expect(s.box.entries[0]).toMatchObject({ stopped: false, nextAttempt: 3000 });
  expect(s.box.attention).toEqual([]); s.clock(3000); await s.box.flush(); expect(s.box.entries).toEqual([]);
});
it.each([[403, 'forbidden'], [404, 'not_found'], [409, 'step_in_use'], [409, 'conflict'], [422, 'validation_failed'], [422, 'idempotency_key_reused']] as const)('stops definitive %s %s, blocks later edits, and supports Retry and Discard', async (status, code) => {
  const s = setup(); await s.box.activate(A);
  const first = await s.box.enqueue(input()); await s.box.enqueue(input());
  s.send.mockRejectedValueOnce(new WriteError(status, { code, detail: 'Synthetic refusal.' }, `Server returned ${status}: Synthetic refusal.`));
  s.online(); await s.box.flush();
  expect(s.box.attention[0]).toMatchObject({ id: first.id, lastStatus: status, errorCode: code, lastError: `Server returned ${status}: Synthetic refusal.` });
  expect(s.box.counts).toEqual({ pending: 1, attention: 1, total: 2 });
  await s.box.flush(); expect(s.send).toHaveBeenCalledTimes(1);
  s.online(false); await s.box.retry(first.id); expect(s.box.attention).toEqual([]);
  expect(s.box.entries[0].idempotencyKey).toBe(first.idempotencyKey);
  await s.box.discard(first.id); expect(s.box.entries).toHaveLength(1);
  s.online(); await s.box.flush(); expect(s.box.counts.total).toBe(0);
});
it('never sends or displays a previous account while it waits for another sign-in', async () => {
  const s = setup(); await s.box.activate(A); await s.box.enqueue(input());
  await s.box.activate(B); s.online(); await s.box.flush(); expect(s.send).not.toHaveBeenCalled(); expect(s.box.counts.total).toBe(0);
  await s.box.activate(null); await s.box.flush(); expect(s.send).not.toHaveBeenCalled();
  await s.box.activate(A); await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(1));
  expect(s.send.mock.calls[0][0]).toMatchObject(A);
});
it('does not start the next send after the account changes during an in-flight request', async () => {
  const s = setup(); await s.box.activate(A); await s.box.enqueue(input()); await s.box.enqueue(input());
  let finish!: () => void; s.send.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({}); }));
  s.online(); void s.box.flush(); await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(1));
  await s.box.activate(B); finish(); await vi.waitFor(() => expect(s.saved.get(outboxStorageKey(A))).toHaveLength(1));
  expect(s.box.entries).toEqual([]); expect(s.send).toHaveBeenCalledTimes(1);
});
it('fails closed on mismatched stored entries and on persistence failure', async () => {
  const s = setup(); await s.box.activate(A); const entry = await s.box.enqueue(input());
  s.saved.set(outboxStorageKey(B), [entry]); const other = s.create(); await other.activate(B);
  expect(other.error).toContain('do not match'); expect(other.entries).toEqual([]);
  s.storage.write.mockRejectedValueOnce(new Error('Disk full'));
  await expect(s.box.enqueue(input())).rejects.toThrow('Disk full'); expect(s.box.entries).toHaveLength(1); expect(s.send).not.toHaveBeenCalled();
});
it('notifies owning views only after success and durable removal', async () => {
  const s = setup(); await s.box.activate(A); const listener = vi.fn(); s.box.subscribe(listener);
  const entry = await s.box.enqueue(input()); s.online(); await s.box.flush();
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: entry.id })); expect(s.saved.get(outboxStorageKey(A))).toEqual([]);
});
it('round trips web storage with keys containing both account and server', async () => {
  const values = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) });
  const s = setup(); await s.box.activate(A); const entry = await s.box.enqueue(input());
  await durableOutboxStorage.write(outboxStorageKey(A), [entry]);
  expect(await durableOutboxStorage.read(outboxStorageKey(A))).toEqual([entry]);
  expect(await durableOutboxStorage.read(outboxStorageKey(B))).toEqual([]);
});
it('ignores an old storage read when the same account is reopened and edited before it finishes', async () => {
  const s = setup(); let finish!: (entries: OutboxEntry[]) => void;
  s.storage.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const old = s.box.activate(A);
  // Allow the first activation to reach storage before switching away.
  await vi.waitFor(() => expect(s.storage.read).toHaveBeenCalledTimes(1));
  await s.box.activate(B); await s.box.activate(A); const first = await s.box.enqueue(input());
  finish([]); await old; const second = await s.box.enqueue(input());
  expect(s.box.entries.map(e => e.id)).toEqual([first.id, second.id]);
  expect(s.saved.get(outboxStorageKey(A))?.map(e => e.id)).toEqual([first.id, second.id]);
});

it('keeps a 401 waiting until the same account signs in again, retaining its key', async () => {
  const s = setup(); await s.box.activate(A); const entry = await s.box.enqueue(input());
  s.send.mockRejectedValueOnce(new WriteError(401, { code: 'unauthenticated' }, 'Sign in again.'));
  s.online(); await s.box.flush();
  expect(s.box.entries[0]).toMatchObject({ stopped: false, lastStatus: 401 });
  expect(s.box.counts).toEqual({ pending: 1, attention: 0, total: 1 });
  s.clock(100000); await s.box.flush(); expect(s.send).toHaveBeenCalledTimes(1);
  await s.box.activate(null); await s.box.activate(B); expect(s.box.entries).toEqual([]);
  await s.box.activate(A); await vi.waitFor(() => expect(s.box.entries).toEqual([]));
  expect(s.send.mock.calls[1][0].idempotencyKey).toBe(entry.idempotencyKey);
});
it('resumes a waiting 401 after token renewal without requiring a sign-out', async () => {
  const s = setup(); await s.box.activate(A); const entry = await s.box.enqueue(input());
  s.send.mockRejectedValueOnce(new WriteError(401, { code: 'unauthenticated' }, 'Sign in again.'));
  s.online(); await s.box.flush();
  expect(s.box.attention).toEqual([]); expect(s.send).toHaveBeenCalledTimes(1);
  await s.box.activate(A); await vi.waitFor(() => expect(s.box.entries).toEqual([]));
  expect(s.send.mock.calls.map(([e]) => e.idempotencyKey)).toEqual([entry.idempotencyKey, entry.idempotencyKey]);
});
