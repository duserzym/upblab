import type { OversightState } from '@lab/bridge';

export const READ_ONLY_REASON = 'Viewing as another account is read-only. Exit View as to make changes.';
export type Filters = Record<'owner' | 'team' | 'project' | 'lab', string>;
const emptyFilters = (): Filters => ({ owner: '', team: '', project: '', lab: '' });

export class WriteError extends Error {
  constructor(public status: number, public body: unknown, message: string, public retryAfter?: string) { super(message); }
  get code(): string | undefined { return (this.body as { code?: string } | null)?.code; }
  get detail(): string | undefined { return (this.body as { detail?: string } | null)?.detail; }
}

/** Per-window scope. Consent is tied to one rejected operation and never retained. */
export class Oversight {
  viewAs = $state<OversightState['viewAs']>(null);
  onBehalf = $state(false);
  owner = $state('');
  filters = $state<Filters>(emptyFilters());
  pending = $state<{ owner: string; message: string } | null>(null);
  private answer: ((yes: boolean) => void) | null = null;
  private activeOwners: string[] = [];
  private listeners = new Set<() => void>();
  // postMessage cannot clone Svelte's nested state proxies.
  get state(): OversightState {
    return { viewAs: this.viewAs ? { username: this.viewAs.username, name: this.viewAs.name } : null, onBehalf: this.onBehalf };
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of this.listeners) listener(); }
  select(account: OversightState['viewAs']) {
    this.confirm(false);
    this.viewAs = account;
    this.changed();
  }
  reset() { this.select(null); this.filters = emptyFilters(); }
  readPath(path: string): string {
    const [base, query] = path.split('?');
    const params = new URLSearchParams(query);
    params.delete('as');
    if (this.viewAs) params.set('as', this.viewAs.username);
    return base + (params.size ? `?${params}` : '');
  }
  assertWritable(path = '') {
    if (this.viewAs || new URLSearchParams(path.split('?')[1]).has('as')) throw new Error(READ_ONLY_REASON);
  }
  confirm(yes: boolean) {
    const answer = this.answer;
    this.answer = null; this.pending = null;
    answer?.(yes);
  }
  async write<T>(operation: (onBehalf: boolean) => Promise<T>, current: () => boolean = () => true): Promise<T> {
    this.assertWritable();
    try { return await operation(false); }
    catch (error) {
      const body = error instanceof WriteError ? error.body as { code?: string; owner?: string } | null : null;
      if (!(error instanceof WriteError) || error.status !== 403 || body?.code !== 'oversight_confirm' || !current() || this.viewAs) throw error;
      // A second operation cannot borrow a pending operation's consent.
      if (this.answer) throw new Error('Finish the pending on-behalf confirmation first.');
      const yes = await new Promise<boolean>(resolve => {
        this.answer = resolve;
        this.pending = { owner: body.owner || 'the data owner', message: error.message };
      });
      if (!yes || !current()) throw error;
      this.assertWritable();
      const owner = body.owner || 'the data owner';
      this.activeOwners.push(owner);
      this.owner = owner;
      this.onBehalf = true; this.changed();
      try { return await operation(true); }
      finally {
        this.activeOwners.splice(this.activeOwners.indexOf(owner), 1);
        this.onBehalf = this.activeOwners.length > 0;
        this.owner = this.activeOwners.at(-1) ?? '';
        this.changed();
      }
    }
  }
}
export const oversight = new Oversight();
