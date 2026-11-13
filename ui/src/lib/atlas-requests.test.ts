import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAtlasRequests, requestTimeout, resultReason } from './atlas-requests';
import type { AtlasRequest } from './atlas-requests';

const command = { type: 'sync-draft', project: 'p' } as const;
const reply = (id: string, extra = {}) => ({ type: 'lab.command.result', id, command: 'sync-draft', ok: true, ...extra });
afterEach(() => vi.useRealTimers());
describe('identified Atlas requests', () => {
  it('waits for the matching id and command, ignores invalid and duplicate replies', async () => {
    const send = vi.fn(async (_command: AtlasRequest) => false);
    const requests = createAtlasRequests(send, () => true);
    const resolved = vi.fn();
    const result = requests.request(command).then(value => { resolved(value); return value; });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const id = send.mock.calls[0][0].id!;
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    requests.receive(reply('other-id'));
    requests.receive(reply(id, { command: 'discard-draft' }));
    requests.receive(reply(id, { code: 'failed' }));
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    requests.receive(reply(id, { revision: 43 }));
    expect(await result).toEqual(reply(id, { revision: 43 }));
    requests.receive(reply(id, { ok: false, code: 'failed' }));
    expect(resolved).toHaveBeenCalledOnce();
  });
  it('times out and serialises requests; late replies cannot finish the next request', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (_command: AtlasRequest) => true);
    const requests = createAtlasRequests(send, () => true);
    const first = requests.request(command, 50);
    const second = requests.request(command, 50);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    const firstId = send.mock.calls[0][0].id!;
    await vi.advanceTimersByTimeAsync(50);
    expect(await first).toEqual({ timeout: true });
    expect(send).toHaveBeenCalledTimes(2);
    const secondId = send.mock.calls[1][0].id!;
    expect(secondId).not.toBe(firstId);
    requests.receive(reply(firstId));
    requests.receive(reply(secondId, { ok: false, code: 'conflict' }));
    expect(await second).toEqual(reply(secondId, { ok: false, code: 'conflict' }));
  });
  it('starts the next request after a result, before the prior timeout', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (_command: AtlasRequest) => true);
    const requests = createAtlasRequests(send, () => true);
    const first = requests.request(command);
    const second = requests.request(command);
    await vi.advanceTimersByTimeAsync(0);
    requests.receive(reply(send.mock.calls[0][0].id!));
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    requests.receive(reply(send.mock.calls[1][0].id!));
    await second;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not send before v4; send rejection resolves and releases the queue', async () => {
    const send = vi.fn(async () => { throw new Error('transport failure'); });
    let v4 = false;
    const requests = createAtlasRequests(send, () => v4);
    expect(await requests.request(command)).toMatchObject({ ok: false, code: 'failed' });
    expect(send).not.toHaveBeenCalled();
    v4 = true;
    expect(await requests.request(command)).toMatchObject({ ok: false, code: 'failed' });
    expect(await requests.request(command)).toMatchObject({ ok: false });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('uses 60 s only for sync, and 10 s for other actions', () => {
    expect(requestTimeout(command)).toBe(60_000);
    expect(requestTimeout({ type: 'leave-edit', project: 'p', decision: 'sync' })).toBe(60_000);
    for (const decision of ['keep-draft', 'discard'] as const)
      expect(requestTimeout({ type: 'leave-edit', project: 'p', decision })).toBe(10_000);
    expect(requestTimeout({ type: 'discard-draft', project: 'p' })).toBe(10_000);
    expect(requestTimeout({ type: 'open-project', project: 'p' })).toBe(10_000);
    expect(requestTimeout({ type: 'set-mode', project: 'p', mode: 'edit' })).toBe(10_000);
    expect(resultReason({ timeout: true }, 60)).toBe('no reply in 60 s');
    expect(resultReason({ type: 'lab.command.result', id: 'a', command: 'sync-draft', ok: false, code: 'offline', error: 'Server unreachable' }, 10)).toBe('Server unreachable');
  });
});
