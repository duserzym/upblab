import { listPath, type ListPath } from './api-list';
import { identity } from './identity.svelte';
import { oversight } from './oversight.svelte';
import { apiReplyMessage } from './server-error';
import { logInfo } from './platform';
export interface OwnedRecord { id: string; owner?: string | null; owner_name?: string | null }
export interface Sample extends OwnedRecord { name: string; material?: string; project?: string | null }
export interface Project extends OwnedRecord { code: string; title?: string; description?: string }
export interface Person { id: string; username: string; display_name?: string }
export interface Team { id: string; name: string }
export interface Lab { id: string; handle: string; name?: string }
export const ownerName = (row: { owner_name?: string | null; owner?: string | null; creator?: { name: string } | null }) => row.owner_name || row.owner || row.creator?.name || '';

/** One on-demand page at a time, never an implicit walk of the directory. */
export class RecordList<T extends { id: string }> {
  rows = $state<T[]>([]);
  cursor = $state<string | null>(null);
  loading = $state(false);
  error = $state('');
  private generation = 0;
  private source = '';
  private checkedAt: number | null = null;
  constructor(readonly path: ListPath, readonly filtered = false, readonly params: Record<string, string> = {}) {}
  private key() { return JSON.stringify([identity.target, identity.revision, oversight.viewAs?.username, this.filtered ? oversight.filters : null]); }
  clear() { this.generation++; this.rows = []; this.cursor = null; this.error = ''; this.loading = false; this.source = ''; this.checkedAt = null; }
  async load(more = false, { force = false } = {}) {
    const source = this.key();
    if (source !== this.source) { this.clear(); this.source = source; more = false; }
    if (!identity.signedIn || !identity.target || this.loading || (more && !this.cursor)) return;
    if (!more && !force && this.checkedAt !== null && Date.now() - this.checkedAt < 60_000) return;
    const gen = ++this.generation;
    this.loading = true; this.error = '';
    const started = performance.now();
    try {
      const reply = await identity.get<T[]>(listPath(this.path, more ? this.cursor : null, { ...this.params, ...(this.filtered ? oversight.filters : {}) }));
      if (source !== this.key() || gen !== this.generation) return;
      if (reply.status !== 200 || !Array.isArray(reply.body)) throw new Error(apiReplyMessage(reply));
      const known = new Set(more ? this.rows.map(row => row.id) : []);
      this.rows = [...(more ? this.rows : []), ...reply.body.filter(row => !known.has(row.id))];
      this.cursor = reply.nextCursor ?? null;
    } catch (error) {
      if (source === this.key() && gen === this.generation) this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (source === this.key() && gen === this.generation) {
        this.loading = false;
        // Failed directories must not be retried on every tab switch either.
        this.checkedAt = Date.now();
      }
      void logInfo(`[records] ${this.path}: 1 read in ${Math.round(performance.now() - started)} ms`);
    }
  }
}
export const samples = new RecordList<Sample>('/v1/samples', true);
export const projects = new RecordList<Project>('/v1/projects', true);
export const people = new RecordList<Person>('/v1/accounts');
export const viewAccounts = new RecordList<Person>('/v1/accounts', false, { view_as: 'true' });
export const teams = new RecordList<Team>('/v1/groups');
export const labs = new RecordList<Lab>('/v1/labs');
export const projectOptions = new RecordList<Project>('/v1/projects');
export function clearRecords() { for (const list of [samples, projects, people, viewAccounts, teams, labs, projectOptions]) list.clear(); }
