import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./platform', () => ({ isDesktop: false, desktopAuth: {}, logInfo: vi.fn(), logWarn: vi.fn() }));
const { identity } = await import('./identity.svelte');
const { connectivity } = await import('./connectivity.svelte');
afterEach(() => { connectivity.reset(); vi.unstubAllGlobals(); });
it('shares the web token with the embedded Images viewer on a copy, while Studio handoff remains available', async () => {
  const offlineCopy = 'offline copy as of 2026-11-17 21:49 UTC, read-only';
  vi.stubGlobal('sessionStorage', { getItem: () => 'invented-token' });
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/v1/auth/handoff') ? { code: 'studio-code' } : { username: 'invented' }), {
    status: 200, headers: { 'X-UPbDB-Offline-Copy': offlineCopy },
  }));
  vi.stubGlobal('fetch', fetch);
  await identity.restore({ server: 'https://copy.invalid', key: 'copy' });
  expect(connectivity.offlineCopy).toBe(offlineCopy);
  expect(identity.frameToken('images')).toBe('invented-token');
  expect(identity.frameToken('grainatlas')).toBe('invented-token');
  expect(identity.frameToken('sessions')).toBe('invented-token');
  expect(await identity.handoff()).toBe('studio-code');
  fetch.mockImplementationOnce(async () => new Response('{}', { status: 200 }));
  await identity.get('/v1/mounts');
  expect(connectivity.offlineCopy).toBeNull();
  expect(identity.frameToken('images')).toBe('invented-token');
  identity.state = { signedIn: false, account: null, offline: false };
  expect(identity.frameToken('images')).toBeNull();
});
