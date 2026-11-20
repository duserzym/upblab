import { identity } from './identity.svelte';
import { connectivity } from './connectivity.svelte';
import { oversight, WriteError, READ_ONLY_REASON } from './oversight.svelte';
import { isDesktop } from './platform';

export type WriteMethod = 'PATCH' | 'PUT';
export interface OutboxEntry {
  id: string; server: string; accountId: string; method: WriteMethod; path: string;
  body: unknown; objectKey: string; createdAt: string; idempotencyKey: string;
  attempts: number; lastError: string | null; stopped: boolean; nextAttempt: number;
  baseRevision?: string;
  lastStatus?: number;
  errorCode?: string;
}
export interface OutboxScope { server: string; accountId: string }
export interface OutboxStorage { read(key: string): Promise<OutboxEntry[]>; write(key: string, entries: OutboxEntry[]): Promise<void> }
export const outboxStorageKey = (s: OutboxScope) => `upbstudio.outbox:${JSON.stringify([s.server.replace(/\/+$/, ''), s.accountId])}`;
export const retryDelay = (attempt: number, random = Math.random()) => Math.min(300_000, 5000 * 2 ** Math.min(6, Math.max(0, attempt - 1))) * (0.8 + random * 0.2);
export function retryAfterMs(value?: string, now = Date.now()): number {
  if (!value) return 2000;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 2000;
}
export const durableOutboxStorage: OutboxStorage = {
  async read(key) {
    if (!isDesktop) return JSON.parse(localStorage.getItem(key) ?? '[]');
    const { load } = await import('@tauri-apps/plugin-store');
    const store = await load('outbox.json', { defaults: {}, autoSave: false });
    return await store.get<OutboxEntry[]>(key) ?? [];
  },
  async write(key, entries) {
    if (!isDesktop) { localStorage.setItem(key, JSON.stringify(entries)); return; }
    const { load } = await import('@tauri-apps/plugin-store');
    const store = await load('outbox.json', { defaults: {}, autoSave: false });
    await store.set(key, entries); await store.save();
  },
};
interface Dependencies {
  storage: OutboxStorage;
  send(entry: OutboxEntry): Promise<unknown>;
  reachable(): boolean;
  now(): number;
  random(): number;
  uuid(): string;
  assertWritable?(): void;
}
/** The durable request itself is the local edit. Views overlay it on their last GET. */
export class Outbox {
  entries = $state.raw<OutboxEntry[]>([]);
  error = $state('');
  ready = $state(false);
  private scope: OutboxScope | null = null;
  private key = '';
  private partitions = new Map<string, OutboxEntry[]>();
  private inFlight = new Set<string>();
  private saving: Promise<void> = Promise.resolve();
  private activation = 0;
  private suspended = false;
  private authWaiting = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<(entry: OutboxEntry) => void>();
  constructor(private deps: Dependencies) {}
  get attention() { return this.entries.filter(e => e.stopped); }
  get counts() { return { pending: this.entries.length - this.attention.length, attention: this.attention.length, total: this.entries.length }; }
  pending(objectKey: string) { return this.entries.filter(e => e.objectKey === objectKey); }
  subscribe(listener: (entry: OutboxEntry) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async activate(scope: OutboxScope | null) {
    this.suspended = false;
    const key = scope ? outboxStorageKey(scope) : '';
    this.authWaiting.delete(key);
    if (this.key === key && this.ready) {
      await this.change(key, rows => rows.map(e => e.lastStatus === 401 ? { ...e, nextAttempt: 0 } : e));
      void this.flush(); return;
    }
    const gen = ++this.activation;
    this.scope = scope; this.key = key; this.entries = []; this.ready = false; this.error = '';
    if (this.timer) clearTimeout(this.timer);
    if (!scope) { this.ready = true; return; }
    try {
      await this.saving;
      const stored = this.partitions.get(key) ?? await this.deps.storage.read(key);
      if (gen !== this.activation) return;
      // Fail closed on a mismatched file; never display or send another account's edits.
      if (!Array.isArray(stored) || stored.some(e => e.server !== scope.server || e.accountId !== scope.accountId)) throw new Error('The saved edits do not match this account and server.');
      this.partitions.set(key, stored);
      if (gen !== this.activation) return;
      this.entries = stored.map(e => e.lastStatus === 401 ? { ...e, stopped: false, nextAttempt: 0 } : e); this.partitions.set(key, this.entries); this.ready = true; void this.flush();
    } catch (error) { if (gen === this.activation) this.error = `Could not load saved edits: ${String(error)}`; }
  }
  private async change(key: string, operation: (entries: OutboxEntry[]) => OutboxEntry[]) {
    // Serialize read/modify/write too, so an enqueue cannot overwrite a completed send.
    const next = this.saving.catch(() => {}).then(async () => {
      const entries = operation(this.partitions.get(key) ?? []);
      await this.deps.storage.write(key, structuredClone(entries));
      this.partitions.set(key, entries);
      if (key === this.key) this.entries = entries;
    });
    this.saving = next;
    await next;
  }
  async enqueue(input: { method: WriteMethod; path: string; body: unknown; objectKey: string; baseRevision?: string }): Promise<OutboxEntry> {
    this.deps.assertWritable?.();
    if (!this.scope || !this.ready) throw new Error(this.error || 'Sign in and load saved edits before editing.');
    const entry: OutboxEntry = { ...input, body: structuredClone(input.body), ...this.scope,
      id: this.deps.uuid(), idempotencyKey: this.deps.uuid(), createdAt: new Date(this.deps.now()).toISOString(),
      attempts: 0, lastError: null, stopped: false, nextAttempt: 0 };
    await this.change(this.key, entries => [...entries, entry]);
    void this.flush(); return entry;
  }
  async retry(id: string) {
    this.deps.assertWritable?.(); this.error = '';
    await this.change(this.key, entries => entries.map(e => e.id === id ? { ...e, stopped: false, lastError: null, nextAttempt: 0 } : e));
    void this.flush();
  }
  async discard(id: string) {
    const entry = this.entries.find(e => e.id === id);
    if (entry && this.inFlight.has(`${this.key}:${entry.objectKey}`)) throw new Error('Wait for this edit to finish sending before discarding it.');
    await this.change(this.key, entries => entries.filter(e => e.id !== id)); void this.flush();
  }
  async flush() {
    if (!this.ready || !this.scope || this.authWaiting.has(this.key) || !this.deps.reachable()) return;
    const key = this.key;
    const first = new Map<string, OutboxEntry>();
    for (const entry of this.entries) if (!first.has(entry.objectKey)) first.set(entry.objectKey, entry);
    await Promise.all([...first.values()].map(async entry => {
      const lock = `${key}:${entry.objectKey}`;
      if (entry.stopped || entry.nextAttempt > this.deps.now() || this.inFlight.has(lock)) return;
      this.inFlight.add(lock);
      try {
        const sent = { ...entry, attempts: entry.attempts + 1 };
        await this.change(key, rows => rows.map(e => e.id === entry.id ? sent : e));
        if (key !== this.key || !this.deps.reachable()) return;
        try {
          await this.deps.send(sent);
          await this.change(key, rows => rows.filter(e => e.id !== entry.id));
          if (key === this.key) for (const listener of this.listeners) listener(sent);
        } catch (error) {
          const waiting = error instanceof WriteError && error.status === 409 && error.code === 'idempotency_in_progress';
          const unauthenticated = error instanceof WriteError && error.status === 401;
          if (unauthenticated) this.authWaiting.add(key);
          const stopped = !unauthenticated && error instanceof WriteError && error.status >= 400 && error.status < 500 && !waiting;
          const delay = waiting ? retryAfterMs(error.retryAfter, this.deps.now()) : retryDelay(sent.attempts, this.deps.random());
          await this.change(key, rows => rows.map(e => e.id === entry.id ? { ...sent, stopped, lastStatus: error instanceof WriteError ? error.status : undefined, errorCode: error instanceof WriteError ? error.code : undefined, lastError: error instanceof Error ? error.message : String(error), nextAttempt: this.deps.now() + delay } : e));
        }
      } catch (error) { if (key === this.key) this.error = `Could not save edit status: ${String(error)}`; }
      finally { this.inFlight.delete(lock); }
    }));
    if (key !== this.key) return;
    this.schedule();
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    if (!this.deps.reachable() || this.authWaiting.has(this.key) || this.error || this.suspended) return;
    const first = new Map<string, OutboxEntry>();
    for (const entry of this.entries) if (!first.has(entry.objectKey)) first.set(entry.objectKey, entry);
    const due = [...first.values()].filter(e => !e.stopped && !this.inFlight.has(`${this.key}:${e.objectKey}`));
    if (due.length) this.timer = setTimeout(() => void this.flush(), Math.max(0, Math.min(...due.map(e => e.nextAttempt)) - this.deps.now()));
  }
  stop() { this.suspended = true; if (this.timer) clearTimeout(this.timer); }
}
export const currentOutboxScope = (): OutboxScope | null => !oversight.viewAs && identity.signedIn && identity.account?.id && identity.target
  ? { server: identity.target.server.replace(/\/+$/, ''), accountId: identity.account.id } : null;
export const outbox = new Outbox({ assertWritable: () => oversight.assertWritable(), storage: durableOutboxStorage, now: Date.now, random: Math.random, uuid: () => crypto.randomUUID(),
  reachable: () => identity.signedIn && !oversight.viewAs && connectivity.state === 'online' && !connectivity.offlineCopy,
  send: entry => {
    const scope = currentOutboxScope();
    if (!scope || scope.server !== entry.server || scope.accountId !== entry.accountId) throw new Error('The account or server changed.');
    return identity.write(entry.path, entry.method, entry.body, { idempotencyKey: entry.idempotencyKey });
  },
});
/** Online forms retain this object (and its key) until successful or their input changes. */
export function onlineOnlyReason(): string {
  if (oversight.viewAs) return READ_ONLY_REASON;
  if (connectivity.offlineCopy) return `Needs the server: ${connectivity.offlineCopy}`;
  if (connectivity.state !== 'online') return `Needs the server: ${connectivity.detail || 'the server is not reachable.'}`;
  return '';
}
