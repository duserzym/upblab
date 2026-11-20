import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'https://invented.example' }, revision: 1, account: { id: 'invented' }, get: vi.fn(), write: vi.fn() } }));
vi.mock('./tims-rights.svelte', () => ({ timsRights: { recordReason: () => '', reject: vi.fn() } }));
vi.mock('./outbox.svelte', () => ({ outbox: {}, onlineOnlyReason: () => '' }));
import { identity } from './identity.svelte';
import { grainImages } from './tims-grain-image-cache';
import { read } from './tims-api';
import { batchGeometry, clearTimsNames, operatorAccounts, OnlineAction, ReplyScope } from './tims-requests';
import { timsBatch, timsFraction } from '../../tests/fixtures/review';
beforeEach(() => { vi.resetAllMocks(); clearTimsNames(); grainImages.clear(); identity.revision = 1; identity.target = { server: 'https://invented.example' } as typeof identity.target; identity.account!.id = 'invented'; });
it('requests outlines and missing labels once per distinct mount and publishes progressively for thousands of sources', async () => {
  const batch = { ...timsBatch, fractions: Array.from({ length: 5000 }, (_, i) => ({ ...timsFraction, id: `invented-${i}`, sources: [{ ...timsFraction.sources[0], mount_label: null, mount_id: `mount-${i % 3}` }] })) };
  let finish!: (reply: never) => void;
  vi.mocked(identity.get).mockImplementation(path => path === '/v1/mounts/mount-0/elements' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ status: 200, body: path.endsWith('/elements') ? { grains: [], spots: [] } : { label: 'Invented mount' } }) as never);
  const publish = vi.fn(), report = vi.fn(), start = performance.now(); const task = batchGeometry(batch, publish, report);
  await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(5)); expect(identity.get).toHaveBeenCalledTimes(6);
  expect(publish).toHaveBeenCalledWith('mount-0', expect.objectContaining({ label: 'Invented mount' }));
  finish({ status: 200, body: { grains: [], spots: [] } } as never); await task; expect(publish).toHaveBeenCalledTimes(6);
  expect(publish.mock.calls.at(-1)?.[1]).toMatchObject({ label: 'Invented mount', grains: [], spots: [] }); expect(report).not.toHaveBeenCalled();
  const progressiveMs = performance.now() - start;
  // Compare the former outlines-only reads with the current label-enriched reads,
  // using immediate mock replies for both so the deliberate stall does not skew timing.
  vi.mocked(identity.get).mockResolvedValue({ status: 200, body: { label: 'Invented mount', grains: [], spots: [] } });
  vi.mocked(identity.get).mockClear();
  const beforeStart = performance.now();
  await Promise.all([...new Set(batch.fractions.flatMap(f => f.sources.map(s => s.mount_id)))].map(id => read(`/v1/mounts/${id}/elements`)));
  const beforeMs = performance.now() - beforeStart; expect(identity.get).toHaveBeenCalledTimes(3);
  vi.mocked(identity.get).mockClear(); const afterStart = performance.now();
  await batchGeometry(batch, vi.fn(), report, true); const afterMs = performance.now() - afterStart; expect(identity.get).toHaveBeenCalledTimes(6);
  console.info(`TIMS outlines/names, 5000 sources / 3 mounts: before 3 requests in ${beforeMs.toFixed(2)} ms; after 6 in ${afterMs.toFixed(2)} ms; progressive stall check ${progressiveMs.toFixed(1)} ms (mock network).`);
});
it('adds no mount detail requests when source labels are already present', async () => {
  vi.mocked(identity.get).mockResolvedValue({ status: 200, body: { grains: [], spots: [] } });
  await batchGeometry({ ...timsBatch, fractions: [{ ...timsFraction, sources: [{ ...timsFraction.sources[0], mount_label: 'Invented mount' }] }] }, vi.fn(), vi.fn());
  expect(identity.get).toHaveBeenCalledTimes(1); expect(vi.mocked(identity.get).mock.calls[0][0]).toMatch(/\/elements$/);
});
it('resolves 5000 operator labels with one bounded cached account page and clears it on identity changes', async () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ id: `invented-${i}`, username: `operator-${i}` }));
  vi.mocked(identity.get).mockResolvedValue({ status: 200, body: rows, nextCursor: 'not-followed' });
  const start = performance.now(); const replies = await Promise.all(Array.from({ length: 5000 }, () => operatorAccounts()));
  expect(replies.every(r => r === rows)).toBe(true); expect(identity.get).toHaveBeenCalledExactlyOnceWith('/v1/accounts?limit=500');
  console.info(`TIMS operators: before 0 requests; after 1 bounded page for 5000 labels; ${(performance.now() - start).toFixed(1)} ms (mock network).`);
  identity.revision++; await operatorAccounts(); expect(identity.get).toHaveBeenCalledTimes(2);
  clearTimsNames(); await operatorAccounts(); expect(identity.get).toHaveBeenCalledTimes(3);
});
it('caches an unavailable account directory without repeating a forbidden request per operator', async () => {
  vi.mocked(identity.get).mockResolvedValue({ status: 403, body: { detail: 'Not visible' } });
  expect(await operatorAccounts()).toEqual([]); expect(await operatorAccounts()).toEqual([]); expect(identity.get).toHaveBeenCalledTimes(1);
});
it('keeps an online key across uncertain failure and changes it for a changed payload', async () => {
  const action = new OnlineAction<unknown>(); vi.mocked(identity.write).mockRejectedValueOnce(new Error('Stall')).mockResolvedValue({ status: 200, body: {} });
  await expect(action.send('/v1/tims/recipes', 'POST', { name: 'Invented' })).rejects.toThrow('Stall'); await action.send('/v1/tims/recipes', 'POST', { name: 'Invented' });
  expect(vi.mocked(identity.write).mock.calls[0]).toEqual(vi.mocked(identity.write).mock.calls[1]); await action.send('/v1/tims/recipes', 'POST', { name: 'Changed' });
  expect(vi.mocked(identity.write).mock.calls[2][3]?.idempotencyKey).not.toBe(vi.mocked(identity.write).mock.calls[1][3]?.idempotencyKey);
});
it('preserves the newer form retry key when an earlier form completes late', async () => {
  const action = new OnlineAction<unknown>();
  let finish!: (reply: never) => void;
  vi.mocked(identity.write).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockRejectedValueOnce(new Error('Stall')).mockResolvedValue({ status: 200, body: {} });
  const earlier = action.send('/v1/tims/recipes', 'POST', { name: 'Earlier' });
  await expect(action.send('/v1/tims/recipes', 'POST', { name: 'Newer' })).rejects.toThrow('Stall');
  finish({ status: 200, body: {} } as never); await earlier;
  await action.send('/v1/tims/recipes', 'POST', { name: 'Newer' });
  expect(vi.mocked(identity.write).mock.calls[2]).toEqual(vi.mocked(identity.write).mock.calls[1]);
});
it('rejects a late successful creation after the account changes', async () => {
  let finish!: (reply: never) => void;
  vi.mocked(identity.write).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = new OnlineAction<unknown>().send('/v1/tims/recipes', 'POST', { name: 'Earlier' });
  identity.account!.id = 'another-account'; finish({ status: 200, body: { id: 'old-id' } } as never);
  await expect(pending).rejects.toThrow('account or server changed');
});
it('scopes replies to the identity, lab and form, including changes before effects and form disposal', () => {
  let lab = 'lab-a', form = 'recipe-a', name = 'original';
  const scope = new ReplyScope(() => [lab, form]);
  const original = scope.capture(() => name), settled = scope.capture();
  name = 'revised'; expect(original()).toBe(false); expect(settled()).toBe(true);
  lab = 'lab-b'; expect(settled()).toBe(false); lab = 'lab-a';
  form = 'recipe-b'; expect(settled()).toBe(false); form = 'recipe-a';
  identity.account!.id = 'other'; expect(settled()).toBe(false); identity.account!.id = 'invented';
  identity.target!.server = 'https://other.example'; expect(settled()).toBe(false); identity.target!.server = 'https://invented.example';
  identity.revision++; expect(settled()).toBe(false);
  const reopened = scope.capture(); scope.invalidate(); expect(reopened()).toBe(false); expect(scope.capture()()).toBe(true);
});
