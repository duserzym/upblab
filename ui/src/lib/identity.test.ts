import { describe, expect, it, vi } from 'vitest';
import type { AuthState } from './platform';

vi.mock('./platform', () => ({
  isDesktop: true,
  desktopAuth: { restore: vi.fn() },
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
