import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'https://synthetic.example' }, revision: 0, signedIn: true, account: { is_superuser: false } } }));
vi.mock('./tims-api', () => ({ firstPage: vi.fn() }));
vi.mock('./outbox.svelte', () => ({ outbox: { pending: () => [] } }));
import { identity } from './identity.svelte';
import { firstPage } from './tims-api';
import { TimsRights } from './tims-rights.svelte';
import { oversight, READ_ONLY_REASON, WriteError } from './oversight.svelte';
beforeEach(() => { oversight.reset(); identity.revision = 0; identity.account!.is_superuser = false; vi.mocked(firstPage).mockResolvedValue({ items: [{ id: 'member-lab', my_role: 'member' }, { id: 'owner-lab', my_role: 'owner' }, { id: 'visible-lab', my_role: null }], nextCursor: null, more: async () => null } as never); });
it('uses lab membership or superuser status only to show editing; a refusal stays on the record', async () => {
  const rights = new TimsRights(); await rights.load();
  expect(rights.canEdit('member-lab')).toBe(true); expect(rights.canEdit('owner-lab')).toBe(true); expect(rights.canEdit('visible-lab')).toBe(false);
  identity.account!.is_superuser = true; expect(rights.canEdit('unrelated')).toBe(true);
  rights.reject('fraction:f', new WriteError(403, { code: 'forbidden', detail: 'Only members of this lab may edit.' }, 'Server returned 403: Only members of this lab may edit.'));
  expect(rights.recordReason('fraction:f')).toContain('Only members of this lab may edit.'); expect(rights.canEdit('member-lab', 'fraction:f')).toBe(false);
  oversight.select({ username: 'synthetic-viewer', name: 'Synthetic' }); expect(rights.canEdit('member-lab')).toBe(false); expect(rights.recordReason('fraction:f')).toBe(READ_ONLY_REASON);
  oversight.reset(); identity.revision++; expect(rights.canEdit('member-lab')).toBe(false); expect(rights.recordReason('fraction:f')).toBe('');
});
it('publishes lab rights progressively, adds further pages on demand, and fails closed if loading fails', async () => {
  const more = vi.fn(async () => ({ items: [{ id: 'second', my_role: 'member' }], nextCursor: null, more: async () => null }));
  vi.mocked(firstPage).mockResolvedValueOnce({ items: [], nextCursor: 'opaque', more } as never);
  const rights = new TimsRights(); await rights.load(); expect(more).not.toHaveBeenCalled(); expect(rights.canEdit('second')).toBe(false);
  rights.rememberLabs((await more()).items as never); expect(more).toHaveBeenCalledTimes(1); expect(rights.canEdit('second')).toBe(true);
  vi.mocked(firstPage).mockRejectedValueOnce(new Error('Server returned 503: maintenance')); await rights.load(); expect(rights.error).toContain('503'); expect(rights.canEdit('second')).toBe(false);
});

it('limits lab protocol editing to owners and superusers and respects identity and view-as', async () => {
  const rights = new TimsRights(); await rights.load();
  expect(rights.canEditLabProtocol('member-lab')).toBe(false);
  expect(rights.canEditLabProtocol('owner-lab')).toBe(true);
  expect(rights.canEditLabProtocol('visible-lab')).toBe(false);
  identity.account!.is_superuser = true;
  expect(rights.canEditLabProtocol('unrelated')).toBe(true);
  oversight.select({ username: 'invented', name: 'Invented' });
  expect(rights.canEditLabProtocol('owner-lab')).toBe(false);
  oversight.reset(); identity.revision++;
  expect(rights.canEditLabProtocol('owner-lab')).toBe(false);
});
