import { describe, expect, it } from 'vitest';
import type { Account, AuthState } from './platform';
import { canManagePeople } from './people';

const signedIn = (account: Account | null, overrides: Partial<AuthState> = {}): AuthState => ({
  signedIn: true, offline: false, account, ...overrides,
});

describe('canManagePeople', () => {
  it.each([
    [{ username: 'demo', can_manage_people: true }, true],
    [{ username: 'demo', can_manage_people: true, is_lab_staff: false }, true],
    [{ username: 'demo', can_manage_people: false, is_lab_staff: true }, false],
    [{ username: 'demo', can_manage_people: false }, false],
    [{ username: 'demo', is_lab_staff: true }, true],
    [{ username: 'demo', is_lab_staff: false }, false],
    [{ username: 'demo', is_admin: true, is_superuser: true }, false],
    [{ username: 'demo' }, false],
    // Malformed fields must not be treated as a grant or as an older server.
    [{ username: 'demo', can_manage_people: 'true', is_lab_staff: true }, false],
    [{ username: 'demo', can_manage_people: null, is_lab_staff: true }, false],
    [{ username: 'demo', is_lab_staff: 'true' }, false],
  ])('reads the server permission for %j as %s', (account, allowed) => {
    expect(canManagePeople(signedIn(account as Account))).toBe(allowed);
  });

  it('requires a signed-in, online account even with a retained staff profile', () => {
    const account = { username: 'demo', can_manage_people: true, is_lab_staff: true };
    expect(canManagePeople(signedIn(account, { signedIn: false }))).toBe(false);
    expect(canManagePeople(signedIn(account, { offline: true }))).toBe(false);
    expect(canManagePeople(signedIn(null))).toBe(false);
  });
});
