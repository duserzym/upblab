import type { AtlasSyncedEvent } from '@lab/bridge';
import { atlasSync, refreshDecision } from './atlas-sync.svelte';
import { identity } from './identity.svelte';
import { overview } from './overview.svelte';
import { review } from './review.svelte';
import { sendCommand, moduleSurfaces } from './incoming';

const revisions = new Map<string, number>();
const notices = new Map<string, number>();
const failedUntil = new Map<string, number>();
let source = '', lastCheck = -Infinity, checking = false;
function currentSource() {
  const next = `${identity.target?.server ?? ''}:${identity.revision}`;
  if (next !== source) {
    source = next; revisions.clear(); notices.clear(); failedUntil.clear(); lastCheck = -Infinity;
  }
  return next;
}
export async function refreshAtlasMount(mount: string) {
  const decision = refreshDecision(mount, review, overview.mounts);
  await Promise.allSettled([
    decision.review ? review.load() : Promise.resolve(),
    // Also discover a newly registered mount that Home has not loaded yet.
    overview.refreshMount(mount),
  ]);
}
export async function atlasSyncedNotice(event: AtlasSyncedEvent) {
  currentSource();
  if (event.revision <= (notices.get(event.mount) ?? -1)) return;
  notices.set(event.mount, event.revision);
  // Focus polling may have seen this revision before its first module notice;
  // that notice must still reach an open Sessions surface.
  revisions.set(event.mount, Math.max(event.revision, revisions.get(event.mount) ?? -1));
  const forwarding = moduleSurfaces.has('sessions')
    ? sendCommand('sessions', { type: 'atlas-synced', project: event.project, mount: event.mount, revision: event.revision })
    : Promise.resolve();
  await Promise.allSettled([refreshAtlasMount(event.mount), forwarding]);
}
/** Focus checks are additive only after GrainAtlas has advertised v4 this session. */
export async function checkStandaloneSync(now = Date.now()) {
  const origin = currentSource();
  if (!atlasSync.v4 || checking || now - lastCheck < 30_000 || review.state !== 'ready' || !identity.signedIn) return;
  const projects = [...new Map(review.rows.flatMap(row => row.atlasProjectId && row.mountId ? [[row.atlasProjectId, row.mountId] as const] : [])).entries()].slice(0, 8);
  if (!projects.length) return;
  checking = true; lastCheck = now;
  // A status provides the baseline when we have already opened this mount.
  const status = atlasSync.status;
  if (status?.mount && status.revision !== null && !revisions.has(status.mount)) revisions.set(status.mount, status.revision);
  const changed = new Set<string>();
  try {
    await Promise.all(projects.map(async ([project, mount]) => {
      if (now < (failedUntil.get(project) ?? 0)) return;
      try {
        const reply = await identity.get<{ revision: number; mount_id: string }>(`/v1/atlas/projects/${encodeURIComponent(project)}`);
        if (origin !== currentSource()) return;
        if (reply.status !== 200 || !reply.body || !Number.isInteger(reply.body.revision) || reply.body.revision < 0 || reply.body.mount_id !== mount) throw new Error('unavailable');
        const previous = revisions.get(mount);
        if (previous === undefined || reply.body.revision > previous) {
          revisions.set(mount, reply.body.revision);
          // Without a baseline, re-read once so an earlier standalone sync is visible.
          changed.add(mount);
        }
      } catch { if (origin === currentSource()) failedUntil.set(project, now + 600_000); }
    }));
    if (origin === currentSource()) await Promise.allSettled([...changed].map(refreshAtlasMount));
  } finally { checking = false; }
}
