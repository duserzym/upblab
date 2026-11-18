import { describe, expect, it, vi } from 'vitest';
import { Oversight, WriteError } from './oversight.svelte';
const rejected = () => new WriteError(403, { code: 'oversight_confirm', owner: 'Cedar Analyst' }, '403: confirm the change');
describe('oversight operation consent', () => {
  it('names the owner and resends that operation once, then resets consent', async () => {
    const scope = new Oversight(), changes: unknown[] = [];
    scope.subscribe(() => changes.push({ ...scope.state }));
    const op = vi.fn(async (consent: boolean) => { if (!consent) throw rejected(); return 'saved'; });
    const result = scope.write(op);
    await vi.waitFor(() => expect(scope.pending?.owner).toBe('Cedar Analyst'));
    expect(op.mock.calls).toEqual([[false]]);
    scope.confirm(true);
    expect(await result).toBe('saved');
    expect(op.mock.calls).toEqual([[false], [true]]);
    expect(changes).toEqual([{ viewAs: null, onBehalf: true }, { viewAs: null, onBehalf: false }]);
    const next = scope.write(op).catch(error => error);
    await vi.waitFor(() => expect(scope.pending).not.toBeNull());
    scope.confirm(false); expect(await next).toBeInstanceOf(WriteError);
    expect(op.mock.calls).toEqual([[false], [true], [false]]);
  });
  it('never retries a failed resend or asks for an unrelated 403', async () => {
    const scope = new Oversight(), op = vi.fn(async () => { throw rejected(); });
    const result = scope.write(op).catch(error => error);
    await vi.waitFor(() => expect(scope.pending).not.toBeNull()); scope.confirm(true);
    await result; expect(op).toHaveBeenCalledTimes(2); expect(scope.pending).toBeNull(); expect(scope.onBehalf).toBe(false);
    await expect(scope.write(async () => { throw new WriteError(403, { code: 'forbidden' }, '403 denied'); })).rejects.toThrow('403 denied');
    expect(scope.pending).toBeNull();
  });
  it('cancels consent on scope change and blocks every write, including supplied as=', async () => {
    const scope = new Oversight(), op = vi.fn(async () => { throw rejected(); });
    const result = scope.write(op).catch(error => error);
    await vi.waitFor(() => expect(scope.pending).not.toBeNull());
    scope.select({ username: 'cedar', name: 'Cedar Analyst' });
    scope.confirm(true); await result; expect(op).toHaveBeenCalledTimes(1);
    await expect(scope.write(op)).rejects.toThrow('read-only'); expect(op).toHaveBeenCalledTimes(1);
    expect(scope.readPath('/v1/sessions?limit=500&as=wrong')).toBe('/v1/sessions?limit=500&as=cedar');
    scope.select(null); expect(scope.readPath('/v1/accounts/me?as=cedar')).toBe('/v1/accounts/me');
    expect(() => scope.assertWritable('/v1/samples/s?as=cedar')).toThrow('read-only');
  });
  it('does not apply confirmation after an account or server changes', async () => {
    const scope = new Oversight(); let current = true;
    const op = vi.fn(async () => { throw rejected(); });
    const result = scope.write(op, () => current).catch(error => error);
    await vi.waitFor(() => expect(scope.pending).not.toBeNull()); current = false; scope.confirm(true); await result;
    expect(op).toHaveBeenCalledTimes(1);
  });
  it('requires separate consent for overlapping operations and stays active until both finish', async () => {
    const scope = new Oversight();
    const finish: (() => void)[] = [];
    const op = vi.fn(async (consent: boolean) => {
      if (!consent) throw rejected();
      await new Promise<void>(resolve => finish.push(resolve));
    });
    const first = scope.write(op);
    await vi.waitFor(() => expect(scope.pending).not.toBeNull()); scope.confirm(true);
    await vi.waitFor(() => expect(finish).toHaveLength(1));
    const second = scope.write(op);
    await vi.waitFor(() => expect(scope.pending).not.toBeNull());
    expect(op.mock.calls).toEqual([[false], [true], [false]]); scope.confirm(true);
    await vi.waitFor(() => expect(finish).toHaveLength(2));
    finish[0](); await first; expect(scope.onBehalf).toBe(true);
    finish[1](); await second; expect(scope.onBehalf).toBe(false); expect(scope.owner).toBe('');
  });
});
