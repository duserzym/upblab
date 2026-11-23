import { identity } from './identity.svelte';
import { oversight, READ_ONLY_REASON, WriteError } from './oversight.svelte';
import { firstPage } from './tims-api';
import { outbox } from './outbox.svelte';
export interface LabRight { id: string; my_role: 'owner' | 'member' | null }
export class TimsRights {
  labs = $state<LabRight[]>([]);
  error = $state('');
  private source = '';
  private generation = 0;
  private refused = $state<Record<string, string>>({});
  private current() { return `${identity.target?.server}:${identity.revision}`; }
  async load() {
    const source = this.current(), gen = ++this.generation;
    if (source !== this.source) { this.labs = []; this.refused = {}; }
    this.source = source; this.error = '';
    try {
      const page = await firstPage<LabRight>('/v1/labs');
      if (source === this.current() && gen === this.generation) this.rememberLabs(page.items);
    } catch (error) { if (source === this.current() && gen === this.generation) { this.labs = []; this.error = String(error); } }
  }
  /** TIMS supplies further pages when the viewer chooses Load more labs. */
  rememberLabs(labs: LabRight[]) {
    if (this.source !== this.current()) return;
    this.labs = [...new Map([...this.labs, ...labs].map(lab => [lab.id, lab])).values()];
  }
  canEdit(labId: string, objectKey?: string) {
    return this.source === this.current() && identity.signedIn && !oversight.viewAs && (!objectKey || !this.recordReason(objectKey)) &&
      (identity.account?.is_superuser === true || this.labs.some(lab => lab.id === labId && !!lab.my_role));
  }
  canEditLabProtocol(labId: string) {
    return this.canEdit(labId) && (identity.account?.is_superuser === true || this.labs.some(lab => lab.id === labId && lab.my_role === 'owner'));
  }
  recordReason(objectKey: string): string {
    if (oversight.viewAs) return READ_ONLY_REASON;
    if (this.source !== this.current()) return '';
    return this.refused[objectKey] ?? outbox.pending(objectKey).find(e => e.lastStatus === 403)?.lastError ?? '';
  }
  reject(objectKey: string, error: unknown) {
    if (error instanceof WriteError && error.status === 403) this.refused[objectKey] = error.message;
  }
}
export const timsRights = new TimsRights();
