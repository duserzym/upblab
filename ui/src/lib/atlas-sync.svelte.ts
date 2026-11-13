import { atlasStatus, atlasDrafts, atlasSynced, type AtlasStatusEvent, type AtlasDraft, type AtlasSyncedEvent, type AtlasChanges } from '@lab/bridge';

export function changeCounts(changes: AtlasChanges | null): string {
  if (!changes) return '';
  return ([['spots', 'spot'], ['grains', 'grain'], ['labels', 'label']] as const)
    .flatMap(([key, label]) => changes[key] ? [`${changes[key]} ${label}${changes[key] === 1 ? '' : 's'}`] : [])
    .concat(changes.pixels ? ['new images'] : []).join(', ');
}
export function statusLabel(status: AtlasStatusEvent): string {
  switch (status.state) {
    case 'checking': return 'Checking…';
    case 'unregistered': return 'Not in the database';
    case 'in-sync': return ['In sync', [status.atlasVersion === null ? '' : `v${status.atlasVersion}`, status.revision === null ? '' : `r${status.revision}`].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
    case 'local-changes': return ['Local changes', changeCounts(status.changes)].filter(Boolean).join(' · ');
    case 'server-newer': return 'Database is newer';
    case 'both-changed': return 'Both changed';
    case 'offline': return 'Offline, changes kept here';
  }
}
export function needsLeaveGuard(status: AtlasStatusEvent | null): boolean {
  return status?.mode === 'edit' && !!status.changes &&
    (status.changes.pixels || status.changes.spots > 0 || status.changes.grains > 0 || status.changes.labels > 0);
}
export function refreshDecision(mount: string, review: { state: string; scope: { kind: string; id: string } | null; rows: { mountId: string | null }[] }, home: { mount: { id: string } }[]) {
  return {
    review: review.state === 'ready' && (review.scope?.kind === 'mount' && review.scope.id === mount || review.rows.some(row => row.mountId === mount)),
    home: home.some(row => row.mount.id === mount),
  };
}
export type LeaveDecision = 'sync' | 'keep-draft' | 'discard';
class AtlasSync {
  v4 = $state(false);
  status = $state<AtlasStatusEvent | null>(null);
  drafts = $state<AtlasDraft[]>([]);
  lastSynced = $state<AtlasSyncedEvent | null>(null);
  snapshot = $state(0);
  leave = $state<{ status: AtlasStatusEvent } | null>(null);
  private resolveLeave: ((decision: LeaveDecision | null) => void) | null = null;
  receive(event: unknown): AtlasSyncedEvent | null {
    const status = atlasStatus(event), drafts = atlasDrafts(event), synced = atlasSynced(event);
    if (!status && !drafts && !synced) return null;
    this.v4 = true;
    if (status) { this.status = status; this.snapshot++; }
    if (drafts) { this.drafts = drafts.drafts; this.snapshot++; }
    if (synced) this.lastSynced = synced;
    return synced;
  }
  get guardNeeded() { return this.v4 && needsLeaveGuard(this.status); }
  requestLeave(): Promise<LeaveDecision | null> {
    // A second navigation while the dialog is open must not replace its resolver.
    if (this.leave || !this.status) return Promise.resolve(null);
    this.leave = { status: this.status };
    return new Promise(resolve => { this.resolveLeave = resolve; });
  }
  finishLeave(decision: LeaveDecision | null) {
    this.resolveLeave?.(decision);
    this.resolveLeave = null;
    this.leave = null;
  }
}
export const atlasSync = new AtlasSync();
