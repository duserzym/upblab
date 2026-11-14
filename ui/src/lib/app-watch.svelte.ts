import { identity } from './identity.svelte';
import { refreshAtlasProject } from './atlas-refresh';
import { overview, type RunOut } from './overview.svelte';
import { review } from './review.svelte';
import { logWarn, takeInbox, type InboxNotice } from './platform';

export const POLL_MS = 60_000;
/** Standalone grainatlas and Studio leave notice files; reading them costs no request. */
export const INBOX_MS = 5_000;
const sameServer = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
const LIFETIME = 2 * 60 * 60_000;
interface Watch {
  kind: 'atlas' | 'session'; id: string; mount?: string;
  until: number; failedUntil: number; busy: boolean; runs?: Set<string>;
}
class AppWatch {
  private watches = new Map<string, Watch>();
  private source = '';
  private timer: ReturnType<typeof setInterval> | undefined;
  private inboxTimer: ReturnType<typeof setInterval> | undefined;
  private reading = false;
  private started = false;
  private currentSource() { return `${identity.target?.server ?? ''}:${identity.revision}`; }
  syncSource() {
    const next = this.currentSource();
    if (next !== this.source) { this.watches.clear(); this.source = next; }
  }
  get size() { return this.watches.size; }
  start() { this.started = true; this.visibilityChanged(); }
  visibilityChanged() {
    clearInterval(this.timer); this.timer = undefined;
    clearInterval(this.inboxTimer); this.inboxTimer = undefined;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (this.started) {
      this.timer = setInterval(() => { void this.check(); }, POLL_MS);
      this.inboxTimer = setInterval(() => { void this.readInbox(); }, INBOX_MS);
    }
    void this.readInbox();
    void this.check();
  }
  /** Take notice files; each only names what to re-read from the server now. */
  async readInbox() {
    if (this.reading) return;
    this.reading = true;
    try {
      const notices = await takeInbox();
      if (notices.length) this.notice(notices);
    } catch (err) { void logWarn(`[inbox] could not read notices: ${String(err)}`); }
    finally { this.reading = false; }
  }
  notice(notices: InboxNotice[]) {
    this.syncSource();
    const server = identity.target?.server;
    let any = false;
    for (const n of notices) {
      if (!server || !sameServer(n.server, server)) continue;
      const watch = n.type === 'lab.atlas.synced' ? this.entry('atlas', n.project, n.mount) : this.entry('session', n.session);
      watch.until = Math.max(watch.until, Date.now() + LIFETIME);
      watch.failedUntil = 0;
      any = true;
    }
    if (any) void this.check();
  }
  atlas(project: string, mount: string | null) { this.add('atlas', project, mount ?? undefined); }
  session(id: string) { this.add('session', id); }
  private entry(kind: Watch['kind'], id: string, mount?: string) {
    const key = `${kind}:${id}`;
    let watch = this.watches.get(key);
    if (!watch) {
      watch = { kind, id, mount, until: 0, failedUntil: 0, busy: false };
      this.watches.set(key, watch);
    }
    if (mount) watch.mount = mount;
    return watch;
  }
  private add(kind: Watch['kind'], id: string, mount?: string) {
    this.syncSource();
    this.entry(kind, id, mount).until = Date.now() + LIFETIME;
    if (!this.started) this.start(); else void this.check();
  }
  private scopeKeys() {
    const keys = new Set<string>();
    const scope = review.scope;
    if (!scope) return keys;
    if (scope.kind === 'session') {
      this.entry('session', scope.id); keys.add(`session:${scope.id}`);
    }
    const projects = new Map(review.rows.flatMap(row => row.atlasProjectId && row.mountId
      && (scope.kind === 'session' || row.mountId === scope.id) ? [[row.atlasProjectId, row.mountId] as const] : []));
    if (scope.kind === 'mount') {
      const atlas = overview.mounts.find(row => row.mount.id === scope.id)?.atlas;
      if (atlas && atlas !== 'error') projects.set(atlas.projectId, scope.id);
    }
    for (const [project, mount] of [...projects].slice(0, scope.kind === 'mount' ? 1 : 8)) {
      this.entry('atlas', project, mount); keys.add(`atlas:${project}`);
    }
    return keys;
  }
  async check(now = Date.now()) {
    this.syncSource();
    const scopeKeys = this.scopeKeys();
    for (const [key, watch] of this.watches) if (now >= watch.until && !scopeKeys.has(key)) this.watches.delete(key);
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (!identity.signedIn) return;
    const source = this.source;
    await Promise.all([...this.watches.entries()].map(async ([key, watch]) => {
      if (watch.busy || now < watch.failedUntil) return;
      watch.busy = true;
      const current = () => source === this.currentSource() && this.watches.get(key) === watch;
      try {
        if (watch.kind === 'atlas') {
          await refreshAtlasProject(watch.id, watch.mount);
        } else {
          const reply = await identity.get<RunOut[]>(`/v1/sessions/${encodeURIComponent(watch.id)}/reductions`);
          if (!current()) return;
          if (reply.status !== 200 || !Array.isArray(reply.body) || reply.body.some(r => typeof r.id !== 'string')) throw new Error('Session unavailable');
          const ids = new Set(reply.body.map(r => r.id));
          const changed = !watch.runs || ids.size !== watch.runs.size || [...ids].some(id => !watch.runs!.has(id));
          if (changed) await Promise.all([
            overview.refreshSession(watch.id, { strict: true }),
            (review.scope?.kind === 'session' && review.scope.id === watch.id
              || review.scope?.kind === 'mount' && review.rows.some(r => r.sessionId === watch.id))
              ? review.load({ quiet: true, strict: true }) : Promise.resolve(),
          ]);
          if (current()) watch.runs = ids;
        }
      } catch { if (current()) watch.failedUntil = now + 600_000; }
      finally { watch.busy = false; }
    }));
  }
  clear() {
    this.watches.clear(); clearInterval(this.timer); clearInterval(this.inboxTimer);
    this.timer = undefined; this.inboxTimer = undefined; this.started = false;
  }
}
export const appWatch = new AppWatch();
