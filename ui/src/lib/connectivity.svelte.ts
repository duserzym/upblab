import type { ApiReply } from './platform';
export type ConnectionState = 'online' | 'offline' | 'server-error' | 'unknown';
const backoff = [10_000, 30_000, 60_000, 120_000];

/** One shared status for shell reads, with a visible-window recovery probe. */
export class Connectivity {
  state = $state<ConnectionState>('unknown');
  offlineCopy = $state<string | null>(null);
  grainAtlasLocal = $state(false);
  asOf = $state<string | null>(null);
  detail = $state('');
  retryIn = $state(0);
  retrying = $state(false);
  private attempt = 0;
  private due = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private read: (() => Promise<ApiReply>) | undefined;
  private recovered: (() => void) | undefined;
  private visible: () => boolean = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  private generation = 0;
  private recoveredAt = -Infinity;

  report(reply: ApiReply) {
    if (!reply.cached || reply.offlineCopy) this.offlineCopy = reply.offlineCopy ?? null;
    if (reply.cached) {
      this.state = reply.cached.reason === 'server_error' ? 'server-error' : 'offline';
      if (!this.asOf || reply.cached.asOf < this.asOf) this.asOf = reply.cached.asOf;
      this.detail = reply.cached.detail ?? '';
      this.schedule();
    } else {
      const wasDown = this.state === 'offline' || this.state === 'server-error';
      this.state = 'online'; this.asOf = null; this.detail = '';
      this.attempt = 0; this.due = 0; this.retryIn = 0;
      if (wasDown && reply.status === 200 && Date.now() - this.recoveredAt >= 10_000) {
        this.recoveredAt = Date.now(); this.recovered?.();
      }
    }
  }
  unavailable(detail = '') {
    if (this.state !== 'server-error') { this.state = 'offline'; this.detail = detail; }
    this.schedule();
  }
  private schedule() {
    if (this.due) return;
    this.retryIn = backoff[Math.min(this.attempt, backoff.length - 1)] / 1000;
    this.due = Date.now() + this.retryIn * 1000;
  }
  start(read: () => Promise<ApiReply>, recovered: () => void, visible?: () => boolean) {
    this.stop(); this.read = read; this.recovered = recovered;
    if (visible) this.visible = visible;
    this.timer = setInterval(() => {
      if (this.state === 'online' || this.state === 'unknown') return;
      this.retryIn = Math.max(0, Math.ceil((this.due - Date.now()) / 1000));
      if (this.retryIn === 0 && this.visible()) void this.retryNow();
    }, 1000);
    return () => this.stop();
  }
  async retryNow() {
    if (!this.read || this.retrying || !this.visible()) return;
    const gen = this.generation;
    this.retrying = true;
    // Reports from identity.get are also observed here for standalone callers/tests.
    try { const reply = await this.read(); if (gen === this.generation) this.report(reply); }
    catch (err) { if (gen === this.generation) this.unavailable(String(err)); }
    finally {
      if (gen === this.generation) {
        this.retrying = false;
        if (this.state !== 'online') { this.attempt++; this.due = 0; this.schedule(); }
      }
    }
  }
  reset() {
    this.generation++; this.offlineCopy = null; this.grainAtlasLocal = false; this.state = 'unknown'; this.asOf = null; this.detail = '';
    this.recoveredAt = -Infinity; this.retrying = false; this.attempt = 0; this.due = 0; this.retryIn = 0;
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}
export const connectivity = new Connectivity();
export function savedDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}
