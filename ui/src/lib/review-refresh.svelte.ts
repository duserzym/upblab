import { identity } from './identity.svelte';
import { review } from './review.svelte';
import { overview, type SessionOut } from './overview.svelte';
import { readAtlasProject } from './atlas-refresh';
import { mountElements } from './tims-requests';
import { reloadReviewViewer } from './incoming';
import { apiReplyMessage, revalidationError } from './server-error';

/** Current-scope reads only; identity GET supplies account/server-scoped ETag revalidation. */
export class ReviewRefresh {
  private feedback = $state({ context: '', state: 'idle' as 'idle' | 'loading' | 'success' | 'error', message: '' });
  private pending: { context: string; promise: Promise<void> } | null = null;
  get state() { return this.feedback.context === review.refreshContext ? this.feedback.state : 'idle'; }
  get message() { return this.feedback.context === review.refreshContext ? this.feedback.message : ''; }
  refresh() {
    const context = review.refreshContext;
    if (this.pending?.context === context) return this.pending.promise;
    if (!review.scope || review.state !== 'ready' || !identity.signedIn) return Promise.resolve();
    const current = () => context === review.refreshContext;
    this.feedback = { context, state: 'loading', message: 'Refreshing database…' };
    const promise = this.read(current).then(() => {
      if (current()) this.feedback = { context, state: 'success', message: 'Database refreshed.' };
    }).catch(error => {
      if (current()) this.feedback = { context, state: 'error', message: `Refresh incomplete: ${error instanceof Error ? error.message : String(error)}` };
    }).finally(() => { if (this.pending?.promise === promise) this.pending = null; });
    this.pending = { context, promise };
    return promise;
  }
  private async read(current: () => boolean) {
    // Capture mounts before results arrive too: an open SEM panel/region may still show one.
    const mounts = new Set(review.rows.flatMap(row => row.mountId ? [row.mountId] : []));
    if (review.scope?.kind === 'mount') mounts.add(review.scope.id);
    if (review.region?.mount) mounts.add(review.region.mount);
    const projectsByMount = new Map<string, Set<string>>();
    const rememberProjects = () => {
      for (const row of review.rows) if (row.mountId && row.atlasProjectId) {
        const projects = projectsByMount.get(row.mountId) ?? new Set<string>();
        projects.add(row.atlasProjectId); projectsByMount.set(row.mountId, projects);
      }
    };
    rememberProjects();
    const errors: unknown[] = [];
    const settle = async (jobs: Promise<unknown>[]) => {
      const results = await Promise.allSettled(jobs);
      for (const result of results) if (result.status === 'rejected') errors.push(result.reason);
    };
    const scope = review.scope;
    await settle([
      review.refresh({ lists: false, details: true }),
      ...(scope?.kind === 'session' ? [identity.get<SessionOut>(`/v1/sessions/${encodeURIComponent(scope.id)}`).then(reply => {
        if (!current()) return;
        if (revalidationError(reply)) throw new Error(revalidationError(reply));
        if (reply.status !== 200 || reply.body?.id !== scope.id) throw new Error(apiReplyMessage(reply));
        const index = review.sessions.findIndex(row => row.id === scope.id);
        if (index >= 0) review.sessions[index] = reply.body;
        else review.sessions = [...review.sessions, reply.body];
      })] : []),
    ]);
    if (!current()) return;
    for (const row of review.rows) if (row.mountId) mounts.add(row.mountId);
    rememberProjects();
    await settle([...mounts].map(async mount => {
      const projects = projectsByMount.get(mount) ?? new Set<string>();
      const known = review.mounts.find(row => row.id === mount)?.atlas?.project_id;
      if (known) projects.add(known);
      await settle([
        mountElements(mount, true),
        overview.refreshMount(mount, { strict: true }).then(row => {
          if (!current() || !row) return;
          const atlas = row.atlas && row.atlas !== 'error' ? row.atlas : null;
          if (atlas) projects.add(atlas.projectId);
          const summary = { ...row.mount, atlas: atlas ? { project_id: atlas.projectId, ...(typeof atlas.version === 'number' ? { version: atlas.version } : {}) } : null };
          const index = review.mounts.findIndex(item => item.id === mount);
          if (index >= 0) review.mounts[index] = { ...review.mounts[index], ...summary };
          else review.mounts = [...review.mounts, summary];
        }),
      ]);
      if (!current()) return;
      await settle([...projects].map(async project => {
        const reply = await readAtlasProject(project);
        if (!current()) return;
        const body = reply.body;
        if (revalidationError(reply)) throw new Error(revalidationError(reply));
        if (reply.status !== 200 || body?.mount_id !== mount || !Number.isInteger(body.revision) || body.revision < 0
          || (body.atlas_version !== null && (!Number.isInteger(body.atlas_version) || body.atlas_version < 0)))
          throw new Error(`Atlas project unavailable: ${apiReplyMessage(reply)}`);
      }));
    }));
    if (!current()) return;
    if (errors.length) throw new Error([...new Set(errors.map(error => error instanceof Error ? error.message : String(error)))].join('; '));
    if (mounts.size) await reloadReviewViewer();
  }
}
export const reviewRefresh = new ReviewRefresh();
