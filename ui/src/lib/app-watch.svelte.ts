import { identity } from './identity.svelte';
import { observe, refreshAtlasMount, readAtlasProject } from './atlas-refresh';
import { overview, type RunOut } from './overview.svelte';
import { review } from './review.svelte';

const LIFETIME = 2 * 60 * 60_000;
interface Watch {
  kind: 'atlas' | 'session'; id: string; mount?: string;
  until: number; failedUntil: number; busy: boolean; runs?: Set<string>;
}
class AppWatch {
  private watches = new Map<string, Watch>();
  private source = '';
  private timer: ReturnType<typeof setInterval> | undefined;
  private currentSource() { return `${identity.target?.server ?? ''}:${identity.revision}`; }
  syncSource() {
    const next = this.currentSource();
    if (next !== this.source) { this.clear(); this.source = next; }
  }
  get size() { return this.watches.size; }
  atlas(project: string, mount: string | null) { this.add('atlas', project, mount ?? undefined); }
  session(id: string) { this.add('session', id); }
  private add(kind: Watch['kind'], id: string, mount?: string) {
    this.syncSource();
    const key = `${kind}:${id}`, old = this.watches.get(key);
    if (old) { old.until = Date.now() + LIFETIME; if (mount) old.mount = mount; }
    else this.watches.set(key, { kind, id, mount, until: Date.now() + LIFETIME, failedUntil: 0, busy: false,
      // Inventory may have only preferred/latest; the first read establishes the full baseline.
    });
    if (!this.timer) this.timer = setInterval(() => { void this.check(); }, 20_000);
    void this.check();
  }
  async check(now = Date.now()) {
    this.syncSource();
    for (const [key, watch] of this.watches) if (now >= watch.until) this.watches.delete(key);
    if (!this.watches.size) { clearInterval(this.timer); this.timer = undefined; return; }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (!identity.signedIn) return;
    const source = this.source;
    await Promise.all([...this.watches.entries()].map(async ([key, watch]) => {
      if (watch.busy || now < watch.failedUntil) return;
      watch.busy = true;
      const current = () => source === this.currentSource() && this.watches.get(key) === watch;
      try {
        if (watch.kind === 'atlas') {
          const reply = await readAtlasProject(watch.id);
          if (!current()) return;
          const b = reply.body;
          if (reply.status !== 200 || !b || typeof b.mount_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(b.mount_id)
            || (watch.mount !== undefined && b.mount_id !== watch.mount) || !Number.isInteger(b.revision) || b.revision < 0
            || (b.atlas_version !== null && (!Number.isInteger(b.atlas_version) || b.atlas_version < 0))) throw new Error('unavailable');
          watch.mount = b.mount_id;
          const change = observe(watch.mount, { revision: b.revision, atlasVersion: b.atlas_version });
          if (change) await refreshAtlasMount(watch.mount, change === 'content');
        } else {
          const reply = await identity.get<RunOut[]>(`/v1/sessions/${encodeURIComponent(watch.id)}/reductions`);
          if (!current()) return;
          if (reply.status !== 200 || !Array.isArray(reply.body) || reply.body.some(r => typeof r.id !== 'string')) throw new Error('unavailable');
          const ids = new Set(reply.body.map(r => r.id));
          const changed = watch.runs ? [...ids].some(id => !watch.runs!.has(id)) : true;
          watch.runs = ids;
          if (changed) await Promise.allSettled([
            overview.refreshSession(watch.id),
            (review.scope?.kind === 'session' && review.scope.id === watch.id
              || review.scope?.kind === 'mount' && review.rows.some(r => r.sessionId === watch.id))
              ? review.load({ quiet: true }) : Promise.resolve(),
          ]);
        }
      } catch { if (current()) watch.failedUntil = Date.now() + 600_000; }
      finally { watch.busy = false; }
    }));
  }
  clear() { this.watches.clear(); clearInterval(this.timer); this.timer = undefined; }
}
export const appWatch = new AppWatch();
