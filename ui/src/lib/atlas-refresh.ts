import type { AtlasSyncedEvent } from '@lab/bridge';
import { atlasSync, refreshDecision } from './atlas-sync.svelte';
import { identity } from './identity.svelte';
import { overview } from './overview.svelte';
import { review } from './review.svelte';
import { sendCommand, moduleSurfaces } from './incoming';

interface AtlasProject { revision: number; mount_id: string; atlas_version: number | null }
const pendingProjects = new Map<string, ReturnType<typeof identity.get<AtlasProject>>>();
/** Share focus and opener polling requests for the same identity and project. */
export function readAtlasProject(project: string) {
  const key = `${currentSource()}:${project}`;
  const previous = pendingProjects.get(key);
  if (previous) return previous;
  const pending = identity.get<AtlasProject>(`/v1/atlas/projects/${encodeURIComponent(project)}`)
    .finally(() => { if (pendingProjects.get(key) === pending) pendingProjects.delete(key); });
  pendingProjects.set(key, pending);
  return pending;
}
interface MountVersion { revision: number; atlasVersion: number | null }
const versions = new Map<string, MountVersion>();
const notices = new Map<string, number>();
const failedUntil = new Map<string, number>();
let source = '', lastCheck = -Infinity, checking = false;
function currentSource() {
  const next = `${identity.target?.server ?? ''}:${identity.revision}`;
  if (next !== source) {
    source = next; versions.clear(); notices.clear(); failedUntil.clear(); lastCheck = -Infinity;
  }
  return next;
}
/** Content revisions and pixel publications advance independently. Ignore stale revisions. */
export function observe(mount: string, next: MountVersion): 'content' | 'pixels' | null {
  currentSource();
  const previous = versions.get(mount);
  if (previous && next.revision < previous.revision) return null;
  versions.set(mount, next);
  if (!previous || next.revision > previous.revision) return 'content';
  return next.atlasVersion !== null && next.atlasVersion !== previous.atlasVersion ? 'pixels' : null;
}
export async function refreshAtlasMount(mount: string, content = true) {
  const decision = refreshDecision(mount, review, overview.mounts);
  await Promise.allSettled([
    content && decision.review ? review.refresh() : Promise.resolve(),
    // Also discover a newly registered mount that Home has not loaded yet.
    overview.refreshMount(mount),
  ]);
}
export async function atlasSyncedNotice(event: AtlasSyncedEvent) {
  const origin = currentSource();
  const previous = versions.get(event.mount);
  if (previous && event.revision < previous.revision) return;
  const change = observe(event.mount, event);
  const firstNotice = event.revision > (notices.get(event.mount) ?? -1);
  if (!change && !firstNotice) return;
  notices.set(event.mount, event.revision);
  // Focus polling may have seen this revision before its first module notice;
  // that notice must still reach an open Sessions surface.
  const forwarding = firstNotice && change !== 'pixels' && moduleSurfaces.has('sessions')
    ? sendCommand('sessions', { type: 'atlas-synced', project: event.project, mount: event.mount, revision: event.revision })
    : Promise.resolve();
  const refreshing = async () => {
    if (change === 'content') {
      if (origin !== currentSource()) return;
      if (refreshDecision(event.mount, review, overview.mounts).review)
        await Promise.allSettled([review.refresh()]);
      await overview.refreshMount(event.mount);
    } else if (change === 'pixels') await refreshAtlasMount(event.mount, false);
  };
  await Promise.allSettled([refreshing(), forwarding]);
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
  if (status?.mount && status.revision !== null && !versions.has(status.mount))
    versions.set(status.mount, { revision: status.revision, atlasVersion: status.atlasVersion });
  const changed = new Map<string, boolean>();
  try {
    await Promise.all(projects.map(async ([project, mount]) => {
      if (now < (failedUntil.get(project) ?? 0)) return;
      try {
        const reply = await readAtlasProject(project);
        if (origin !== currentSource()) return;
        if (reply.status !== 200 || !reply.body || !Number.isInteger(reply.body.revision) || reply.body.revision < 0 || reply.body.mount_id !== mount) throw new Error('unavailable');
        const atlasVersion = reply.body.atlas_version;
        if (atlasVersion !== null && (!Number.isInteger(atlasVersion) || atlasVersion < 0)) throw new Error('unavailable');
        // Without a baseline, re-read once so an earlier standalone sync is visible.
        const change = observe(mount, { revision: reply.body.revision, atlasVersion });
        if (change) changed.set(mount, changed.get(mount) === true || change === 'content');
      } catch { if (origin === currentSource()) failedUntil.set(project, now + 600_000); }
    }));
    if (origin === currentSource()) await Promise.allSettled([...changed].map(([mount, content]) => refreshAtlasMount(mount, content)));
  } finally { checking = false; }
}
