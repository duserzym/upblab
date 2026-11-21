import type { ApiReply } from './platform';
import { normalise, type ResultRow, type ReviewSpot } from './review-data';
import { apiReplyMessage } from './server-error';

/** Per account/server cache; every opening revalidates via identity.get's ETag cache. */
export class RegionResults {
  private cache = new Map<string, ReviewSpot[]>();
  private pending = new Map<string, Promise<ReviewSpot[]>>();
  private generation = 0;
  clear() { this.generation++; this.cache.clear(); this.pending.clear(); }
  peek(source: string, mount: string) { return this.cache.get(JSON.stringify([source, mount])) ?? []; }
  load(source: string, mount: string, get: (path: string) => Promise<ApiReply<{ spots: ResultRow[] }>>) {
    const key = JSON.stringify([source, mount]), gen = this.generation;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const pending = get(`/v1/mounts/${encodeURIComponent(mount)}/results`).then(reply => {
      if (reply.status !== 200 || !Array.isArray(reply.body?.spots)) throw new Error(apiReplyMessage(reply));
      const rows = reply.body.spots.map(row => normalise({ ...row, mount_id: row.mount_id ?? mount }));
      if (gen === this.generation) this.cache.set(key, rows);
      return rows;
    }).finally(() => { if (this.pending.get(key) === pending) this.pending.delete(key); });
    this.pending.set(key, pending);
    return pending;
  }
}
