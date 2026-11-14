import { atlasDrafts, atlasStatus, atlasSynced, type AtlasDraft, type AtlasStatusEvent, type AtlasSyncedEvent } from '@lab/bridge';

export function refreshDecision(mount: string, review: { state: string; scope: { kind: string; id: string } | null; rows: { mountId: string | null }[] }, home: { mount: { id: string } }[]) {
  return {
    review: review.state === 'ready' && (review.scope?.kind === 'mount' && review.scope.id === mount || review.rows.some(row => row.mountId === mount)),
    home: home.some(row => row.mount.id === mount),
  };
}
class AtlasSync {
  v4 = $state(false);
  status = $state<AtlasStatusEvent | null>(null);
  lastSynced = $state<AtlasSyncedEvent | null>(null);
  /** Unsynced edits left in UPb Lab's own storage by the former Images tab. Shown, never sent. */
  strandedDrafts = $state<AtlasDraft[]>([]);
  receive(event: unknown): AtlasSyncedEvent | null {
    const status = atlasStatus(event), synced = atlasSynced(event), drafts = atlasDrafts(event);
    if (status || synced || drafts) this.v4 = true;
    if (status) this.status = status;
    if (drafts) this.strandedDrafts = drafts.drafts;
    if (synced) this.lastSynced = synced;
    return synced;
  }
}
export const atlasSync = new AtlasSync();
