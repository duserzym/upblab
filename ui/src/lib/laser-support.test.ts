import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'https://laser.invalid' }, revision: 0, authentication: 0, signedIn: true, get: vi.fn() } }));
const { identity } = await import('./identity.svelte');
const { takesLaserLogs, clearLaserSupport } = await import('./laser-support');
beforeEach(() => { identity.revision++; vi.mocked(identity.get).mockReset(); });
it('shares one bounded authenticated probe, even for thousands of concurrent opens', async () => {
  vi.mocked(identity.get).mockResolvedValue({ status: 200, body: Array.from({ length: 3000 }, (_, id) => ({ id })) });
  expect(identity.get).not.toHaveBeenCalled(); // No requests until a laser log is opened.
  const start = performance.now();
  expect((await Promise.all(Array.from({ length: 3000 }, () => takesLaserLogs(identity)))).every(Boolean)).toBe(true);
  console.info(`Laser support: 0 requests before open, ${vi.mocked(identity.get).mock.calls.length} after 3000 opens, ${(performance.now() - start).toFixed(1)} ms`);
  expect(identity.get).toHaveBeenCalledExactlyOnceWith('/v1/laser-logs?limit=1');
});
it('caches a 404 refusal and invalidates on server change and sign-out', async () => {
  vi.mocked(identity.get).mockResolvedValue({ status: 404, body: {} });
  expect(await takesLaserLogs(identity)).toBe(false);
  expect(await takesLaserLogs(identity)).toBe(false);
  expect(identity.get).toHaveBeenCalledTimes(1);
  identity.target = { ...identity.target!, server: 'https://next.invalid' };
  expect(await takesLaserLogs(identity)).toBe(false);
  Object.assign(identity, { signedIn: false }); identity.revision++;
  expect(await takesLaserLogs(identity)).toBe(false);
  expect(identity.get).toHaveBeenCalledTimes(3);
});
it('hands over on a network failure but recognises a non-JSON 404', async () => {
  vi.mocked(identity.get).mockRejectedValue(new Error('offline'));
  expect(await takesLaserLogs(identity)).toBe(true);
  identity.revision++;
  vi.mocked(identity.get).mockRejectedValue({ status: 404 });
  expect(await takesLaserLogs(identity)).toBe(false);
});

it('explicit clearing discards even the same origin and identity answer', async () => {
  vi.mocked(identity.get).mockResolvedValueOnce({ status: 404, body: {} }).mockResolvedValueOnce({ status: 200, body: [] });
  expect(await takesLaserLogs(identity)).toBe(false); clearLaserSupport();
  expect(await takesLaserLogs(identity)).toBe(true);
  expect(identity.get).toHaveBeenCalledTimes(2);
});
