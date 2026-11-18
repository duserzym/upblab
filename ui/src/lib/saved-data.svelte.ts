import { identity } from './identity.svelte';
import { isDesktop, savedReads, logInfo, type Prefetched } from './platform';
import { prefetchPaths } from './read-prefetch';
import { settings } from './settings.svelte';
import type { SessionOut, MountOut } from './overview.svelte';

/** A bounded idle job per account, cancellable when its source changes. */
export class SavedData {
  private last = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private idle: number | undefined;
  private pending: Promise<Prefetched> | null = null;
  private key() { return JSON.stringify([identity.target, identity.account?.id ?? identity.account?.username]); }
  cancel() {
    if (this.timer) clearTimeout(this.timer);
    if (this.idle !== undefined && typeof cancelIdleCallback !== 'undefined') cancelIdleCallback(this.idle);
    this.timer = undefined; this.idle = undefined;
  }
  reset() { this.cancel(); this.last.clear(); }
  schedule(sessions: SessionOut[], mounts: MountOut[]) {
    this.cancel();
    if (!isDesktop || !identity.signedIn) return;
    const key = this.key();
    if (Date.now() - (this.last.get(key) ?? -Infinity) < 600_000) return;
    this.timer = setTimeout(() => {
      const run = () => {
        if (this.key() !== key || !identity.signedIn) return;
        void this.save(sessions, mounts).catch(err => logInfo(`[saved reads] ${String(err)}`));
      };
      if (typeof requestIdleCallback !== 'undefined') this.idle = requestIdleCallback(run, { timeout: 10_000 });
      else run();
    }, 3000);
  }
  save(sessions: SessionOut[], mounts: MountOut[]): Promise<Prefetched> {
    if (this.pending) return this.pending;
    const target = identity.target;
    if (!target || !identity.signedIn) return Promise.reject(new Error('Sign in to save server data.'));
    const key = this.key(), started = performance.now();
    const paths = prefetchPaths(sessions, mounts, settings.reviewScope);
    this.last.set(key, Date.now());
    const pending = savedReads.prefetch(target, paths).then(async counts => {
      await logInfo(`[saved reads] ${paths.length} planned reads; ${counts.fetched} fetched, ${counts.unchanged} unchanged, ${counts.failed} failed in ${Math.round(performance.now() - started)} ms`);
      return counts;
    }).finally(() => { if (this.pending === pending) this.pending = null; });
    this.pending = pending;
    return pending;
  }
}
export const savedData = new SavedData();
