import type { AtlasSyncedEvent } from '@lab/bridge';
import { refreshDecision } from './atlas-sync.svelte';
import { identity } from './identity.svelte';
import { overview } from './overview.svelte';
import { review } from './review.svelte';
import { sendCommand, moduleSurfaces } from './incoming';

interface AtlasProject { revision: number; mount_id: string; atlas_version: number | null }
interface MountVersion { revision: number; atlasVersion: number | null }
const pendingProjects = new Map<string, ReturnType<typeof identity.get<AtlasProject>>>();
const pendingMounts = new Map<string, Promise<void>>();
const versions = new Map<string, MountVersion>();
const notices = new Map<string, number>();
let source = '';
function currentSource() {
  const next = `${identity.target?.server ?? ''}:${identity.revision}`;
  if (next !== source) { source = next; versions.clear(); notices.clear(); }
  return next;
}
/** Share requests from notices, focus and the fallback poller. */
export function readAtlasProject(project: string) {
  const key = `${currentSource()}:${project}`;
  const previous = pendingProjects.get(key);
  if (previous) return previous;
  const pending = identity.get<AtlasProject>(`/v1/atlas/projects/${encodeURIComponent(project)}`)
    .finally(() => { if (pendingProjects.get(key) === pending) pendingProjects.delete(key); });
  pendingProjects.set(key, pending);
  return pending;
}
/** Compare without recording a version until its refresh has succeeded. */
export function observe(mount: string, next: MountVersion): 'content' | 'pixels' | null {
  currentSource();
  const previous = versions.get(mount);
  if (previous && next.revision < previous.revision) return null;
  if (!previous || next.revision > previous.revision) return 'content';
  return next.atlasVersion !== null && next.atlasVersion !== previous.atlasVersion ? 'pixels' : null;
}
export async function refreshAtlasMount(mount: string, content = true) {
  const decision = refreshDecision(mount, review, overview.mounts);
  // Settle both so Home still updates when Review fails, then report the failure.
  const results = await Promise.allSettled([
    content && decision.review ? review.refresh() : Promise.resolve(),
    overview.refreshMount(mount, { strict: true }),
  ]);
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
async function applyVersion(mount: string, next: MountVersion, origin: string) {
  const key = `${origin}:${mount}`;
  const previous = pendingMounts.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(async () => {
    if (origin !== currentSource()) return;
    const change = observe(mount, next);
    if (change) await refreshAtlasMount(mount, change === 'content');
    if (origin === currentSource() && (!versions.has(mount) || next.revision >= versions.get(mount)!.revision))
      versions.set(mount, next);
  }).finally(() => { if (pendingMounts.get(key) === pending) pendingMounts.delete(key); });
  pendingMounts.set(key, pending);
  return pending;
}
/** Read authoritative state. Link query revisions are never used. No focus or navigation. */
export async function refreshAtlasProject(project: string, expectedMount?: string) {
  const origin = currentSource();
  const reply = await readAtlasProject(project);
  if (origin !== currentSource()) return;
  const b = reply.body;
  if (reply.status !== 200 || !b || typeof b.mount_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(b.mount_id)
    || (expectedMount !== undefined && b.mount_id !== expectedMount) || !Number.isInteger(b.revision) || b.revision < 0
    || (b.atlas_version !== null && (!Number.isInteger(b.atlas_version) || b.atlas_version < 0))) throw new Error('Atlas project unavailable');
  await applyVersion(b.mount_id, { revision: b.revision, atlasVersion: b.atlas_version }, origin);
}
export async function atlasSyncedNotice(event: AtlasSyncedEvent) {
  const origin = currentSource();
  const previous = versions.get(event.mount);
  if (previous && event.revision < previous.revision) return;
  const change = observe(event.mount, event);
  // An open Sessions surface hears about the sync even when our own refresh fails.
  try { await applyVersion(event.mount, event, origin); }
  finally {
    if (origin === currentSource()) {
      const firstNotice = event.revision > (notices.get(event.mount) ?? -1);
      notices.set(event.mount, event.revision);
      if (firstNotice && change !== 'pixels' && moduleSurfaces.has('sessions'))
        await sendCommand('sessions', { type: 'atlas-synced', project: event.project, mount: event.mount, revision: event.revision }).catch(() => false);
    }
  }
}
