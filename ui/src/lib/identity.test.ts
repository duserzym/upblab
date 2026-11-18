import { describe, expect, it, vi } from 'vitest';
import type { AuthState } from './platform';

vi.mock('./platform', () => ({
  isDesktop: true,
  desktopAuth: { restore: vi.fn(), get: vi.fn(), logout: vi.fn() },
  logInfo: vi.fn(async () => {}),
  logWarn: vi.fn(async () => {}),
}));

const { desktopAuth } = await import('./platform');
const { identity } = await import('./identity.svelte');

describe('identity server changes', () => {
  it('drops the old account before waiting for the new server to confirm access', async () => {
    identity.target = { server: 'https://old.example', key: 'old' };
    identity.state = { signedIn: true, offline: false, account: { username: 'demo', can_manage_people: true } };
    let finish!: (state: AuthState) => void;
    vi.mocked(desktopAuth.restore).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const restoring = identity.restore({ server: 'https://new.example', key: 'new' });
    expect(identity.checking).toBe(true);
    expect(identity.state).toEqual({ signedIn: false, account: null, offline: false });
    finish({ signedIn: true, offline: false, account: { username: 'demo', can_manage_people: false } });
    await restoring;
    expect(identity.checking).toBe(false);
    expect(identity.state.account?.can_manage_people).toBe(false);
  });
});

describe('identity API diagnostics', () => {
  it.each([502, 200])('rejects a non-JSON reply with status %s and its excerpt', async status => {
    identity.target = { server: 'https://lab.example', key: 'lab' };
    vi.mocked(desktopAuth.get).mockResolvedValueOnce({ status, body: null, error: `Server returned ${status}: Bad gateway` });
    await expect(identity.get('/v1/mounts/demo/results')).rejects.toThrow(`Server returned ${status}: Bad gateway`);
  });
  it('preserves a body-read failure from the host', async () => {
    const error = 'Reading the reply from lab.example/v1/mounts/demo/results failed after 30.0 s: timed out (status 200, 919000 bytes expected)';
    vi.mocked(desktopAuth.get).mockRejectedValueOnce(error);
    await expect(identity.get('/v1/mounts/demo/results')).rejects.toBe(error);
  });
});

it('retains the account offline and reports saved replies without opening sign-in', async () => {
  const { connectivity } = await import('./connectivity.svelte');
  vi.mocked(desktopAuth.restore).mockResolvedValueOnce({ signedIn: true, offline: true, account: { username: 'invented', display_name: 'Saved analyst' } });
  await identity.restore({ server: 'https://offline.example', key: 'offline' });
  expect(identity.label).toBe('Saved analyst'); expect(identity.signedIn).toBe(true); expect(identity.dialog).toBe(false);
  const reply = { status: 200, body: [], cached: { asOf: '2026-11-17T21:49:00Z', reason: 'unreachable' as const } };
  vi.mocked(desktopAuth.get).mockResolvedValueOnce(reply);
  expect(await identity.get('/v1/sessions?limit=500')).toEqual(reply);
  expect(connectivity.state).toBe('offline'); expect(connectivity.asOf).toBe(reply.cached.asOf);
});

it('records restored copy marking, hides Images credentials and clears the marking on a target change', async () => {
  const { connectivity } = await import('./connectivity.svelte');
  const offlineCopy = 'invented read-only copy';
  vi.mocked(desktopAuth.restore).mockResolvedValueOnce({ signedIn: true, offline: false, offlineCopy, account: { username: 'invented' } });
  await identity.restore({ server: 'https://copy.example', key: 'copy' });
  expect(connectivity.offlineCopy).toBe(offlineCopy);
  expect(identity.frameToken('images')).toBeNull();
  expect(identity.frameToken('grainatlas')).toBeNull();
  vi.mocked(desktopAuth.restore).mockResolvedValueOnce({ signedIn: true, offline: false, account: { username: 'other' } });
  await identity.restore({ server: 'https://other.example', key: 'other' });
  expect(connectivity.offlineCopy).toBeNull();
});

it('keeps copy knowledge for the same target on sign-out while clearing saved-data status', async () => {
  const { connectivity } = await import('./connectivity.svelte');
  connectivity.offlineCopy = 'invented read-only copy';
  connectivity.asOf = '2026-11-17T21:49:00Z';
  identity.state = { signedIn: true, account: { username: 'invented' }, offline: true };
  vi.mocked(desktopAuth.logout).mockResolvedValueOnce({ signedIn: false, account: null, offline: false });
  await identity.logout();
  expect(identity.signedIn).toBe(false);
  expect(connectivity.asOf).toBeNull();
  expect(connectivity.offlineCopy).toBe('invented read-only copy');
});
