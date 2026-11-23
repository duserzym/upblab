import { untrack } from 'svelte';
import { identity } from './identity.svelte';
import { tims, TimsReadError, type ColumnProtocolOut, type ListPage } from './tims-api';

interface LabProtocols {
  rows: Record<string, ColumnProtocolOut>;
  page: ListPage<ColumnProtocolOut> | null;
  busy: boolean;
  loaded: boolean;
  error: string;
}
const empty = (): LabProtocols => ({ rows: {}, page: null, busy: false, loaded: false, error: '' });
const scope = () => JSON.stringify([identity.target?.server, identity.account?.id ?? identity.account?.username, identity.revision]);

/** Shared, bounded lab reads. Identity GET provides ETags and the desktop offline mirror. */
export class LabColumnProtocols {
  private source = $state('');
  private labs = $state.raw<Record<string, LabProtocols>>({});
  private requests = new Map<string, Promise<void>>();
  private tokens = new Map<string, object>();
  state(lab: string): LabProtocols { return this.source === scope() ? this.labs[lab] ?? empty() : empty(); }
  labProtocol(lab: string, scheme: unknown): ColumnProtocolOut | null {
    return typeof scheme === 'string' ? this.state(lab).rows[scheme] ?? null : null;
  }
  load(lab: string, reload = false, more = false): Promise<void> {
    if (this.source !== scope()) {
      this.source = scope(); this.labs = {}; this.requests.clear(); this.tokens.clear();
    }
    if (!lab) return Promise.resolve();
    if (!reload && this.requests.has(lab)) return this.requests.get(lab)!;
    const previous = this.state(lab);
    if (!reload && !more && previous.loaded) return Promise.resolve();
    if (more && !previous.page?.nextCursor) return Promise.resolve();
    const source = this.source, token = {};
    this.tokens.set(lab, token);
    const current = () => source === scope() && this.tokens.get(lab) === token;
    const publish = (state: LabProtocols) => { this.labs = { ...this.labs, [lab]: state }; };
    publish({ ...previous, busy: true, error: '' });
    const request = (async () => {
      try {
        // The API permits at most two rows per lab, one per scheme. Never read per capsule.
        const page = more ? await previous.page!.more() : await tims.columnProtocols({ lab, limit: '2' });
        if (!current() || !page) return;
        const rows = more ? { ...previous.rows } : {} as Record<string, ColumnProtocolOut>;
        for (const row of page.items) if (row.lab_id === lab) rows[row.scheme] = row;
        publish({ rows, page, loaded: true, busy: false, error: '' });
      } catch (error) {
        if (!current()) return;
        if (error instanceof TimsReadError && error.status === 404) publish({ ...empty(), loaded: true });
        else publish({ ...previous, busy: false, error: String(error) });
      } finally {
        if (current()) this.requests.delete(lab);
      }
    })();
    this.requests.set(lab, request);
    return request;
  }
  /** Publish the saved row at once, then GET so the existing mirror retains it for offline use. */
  async saved(row: ColumnProtocolOut) {
    if (this.source !== scope()) return;
    const source = this.source;
    const previous = this.state(row.lab_id);
    this.labs = { ...this.labs, [row.lab_id]: { ...previous, rows: { ...previous.rows, [row.scheme]: row } } };
    await this.load(row.lab_id, true);
    if (source !== scope()) return;
    // A connection lost after the write can return an older mirrored list. Keep the saved revision.
    const latest = this.state(row.lab_id), returned = latest.rows[row.scheme];
    if (!returned || returned.revision < row.revision)
      this.labs = { ...this.labs, [row.lab_id]: { ...latest, rows: { ...latest.rows, [row.scheme]: row } } };
  }
}
export const labProtocols = new LabColumnProtocols();
export const labProtocol = (lab: string, scheme: unknown) => labProtocols.labProtocol(lab, scheme);

/** Call once during component setup; repeated consumers share the same in-flight/read result. */
export function useLabProtocols(lab: () => string) {
  $effect(() => {
    const id = lab(); void identity.revision; void identity.target?.server; void identity.account?.id;
    untrack(() => { void labProtocols.load(id); });
  });
}
