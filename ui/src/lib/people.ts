import type { AuthState } from './platform';

/** Presentation only; UPbDB enforces access on every management endpoint. */
export function canManagePeople(state: AuthState): boolean {
  const account = state.account;
  if (!state.signedIn || state.offline || !account) return false;
  return account.can_manage_people === true ||
    (account.can_manage_people === undefined && account.is_lab_staff === true);
}

/** A retained profile may keep the tab visible; its offline surface has no management page. */
export function canShowPeopleTab(state: AuthState): boolean {
  return canManagePeople({ ...state, offline: false });
}
