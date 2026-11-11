import type { AuthState } from './platform';

/** Presentation only; laicpmsdb enforces access on every management endpoint. */
export function canManagePeople(state: AuthState): boolean {
  const account = state.account;
  if (!state.signedIn || state.offline || !account) return false;
  return account.can_manage_people === true ||
    (account.can_manage_people === undefined && account.is_lab_staff === true);
}
