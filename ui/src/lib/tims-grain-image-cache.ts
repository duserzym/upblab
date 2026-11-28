import type { GrainAtlas } from './tims-grain-image';
import type { MountGeometry } from './tims-geometry';

export interface AtlasListing { current: { base_url: string; project_id: string; version: number } | null; access: string | null }
export interface PublishedGrainAtlas { grant: object; atlas: GrainAtlas; listing: AtlasListing; url(path: string): string }
const TOKEN_MS = 12 * 60 * 60 * 1000;

/** Metadata only. Tile bodies belong to the browser's versioned immutable image cache. */
export class GrainImageCache {
  private scope = '';
  private generation = 0;
  private listings = new Map<string, { until: number; promise: Promise<AtlasListing> }>();
  private manifests = new Map<string, { promise: Promise<GrainAtlas>; until: number }>();
  private mountManifests = new Map<string, Set<string>>();
  private mountGenerations = new Map<string, number>();
  private geometryPending = new Map<string, { promise: Promise<MountGeometry>; revalidate: boolean }>();
  private geometry = new Map<string, Promise<MountGeometry>>();
  constructor(private json: (url: string) => Promise<GrainAtlas> = atlasJson, private now = Date.now) {}
  clear() { this.generation++; this.scope = ''; this.listings.clear(); this.manifests.clear(); this.geometry.clear(); this.geometryPending.clear(); this.mountManifests.clear(); this.mountGenerations.clear(); }
  invalidateMount(mount: string) {
    this.geometry.delete(mount);
    this.geometryPending.delete(mount);
    this.listings.delete(mount);
    this.mountGenerations.set(mount, (this.mountGenerations.get(mount) ?? 0) + 1);
    for (const key of this.mountManifests.get(mount) ?? []) this.manifests.delete(key);
    this.mountManifests.delete(mount);
  }
  private enter(scope: string) { if (scope !== this.scope) { this.clear(); this.scope = scope; } }
  elements(scope: string, mount: string, read: () => Promise<MountGeometry>, revalidate = false): Promise<MountGeometry> {
    this.enter(scope);
    const generation = this.generation, mountGeneration = this.mountGenerations.get(mount) ?? 0;
    const existing = this.geometryPending.get(mount);
    if (existing) {
      if (!revalidate || existing.revalidate) return existing.promise;
      // A read already in flight may predate the external sync. Follow it with
      // one shared explicit revalidation, even when that earlier read failed.
      return existing.promise.catch(() => {}).then(() => {
        if (generation !== this.generation || mountGeneration !== (this.mountGenerations.get(mount) ?? 0))
          throw new Error('The account or server changed, or the mount was refreshed.');
        return this.elements(scope, mount, read, true);
      });
    }
    if (!revalidate && this.geometry.has(mount)) return this.geometry.get(mount)!;
    const pending = read().then(value => {
      if (generation === this.generation && mountGeneration === (this.mountGenerations.get(mount) ?? 0))
        this.geometry.set(mount, Promise.resolve(value));
      return value;
    }).finally(() => { if (this.geometryPending.get(mount) === record) this.geometryPending.delete(mount); });
    const record = { promise: pending, revalidate };
    this.geometryPending.set(mount, record);
    return pending;
  }
  async published(scope: string, server: string, mount: string, read: () => Promise<AtlasListing>, failed?: PublishedGrainAtlas): Promise<PublishedGrainAtlas> {
    this.enter(scope);
    const generation = this.generation, mountGeneration = this.mountGenerations.get(mount) ?? 0;
    const stale = () => generation !== this.generation || mountGeneration !== (this.mountGenerations.get(mount) ?? 0);
    let entry = this.listings.get(mount);
    // Image error events hide HTTP status (including 401/403). Renew once per shared
    // failed grant. Concurrent failures reuse that renewal instead of reading per grain.
    const failedCurrent = failed?.grant === entry;
    if (!entry || entry.until <= this.now() || failedCurrent) {
      entry = { until: this.now() + TOKEN_MS - 60_000, promise: read() };
      this.listings.set(mount, entry);
      const record = entry;
      void record.promise.catch(() => { record.until = this.now() + 30_000; });
    }
    const listing = await entry.promise;
    if (stale()) throw new Error('The account or server changed, or the mount was refreshed.');
    if (!listing.current || !listing.access) {
      entry.until = Math.min(entry.until, this.now() + 30_000);
      throw new Error(!listing.current ? 'No atlas is published for this mount.' : 'The atlas listing supplied no read access.');
    }
    const current = listing.current;
    if (!/^\/atlas\/projects\/[a-zA-Z0-9._-]+\/$/.test(current.base_url) || !Number.isSafeInteger(current.version) || current.version < 1) throw new Error('Invalid published atlas location or version.');
    const base = server.replace(/\/+$/, '') + current.base_url;
    const url = (path: string) => `${base}${path}?${new URLSearchParams({ version: String(current.version), access: listing.access! })}`;
    const key = `${server}/${current.project_id}/${current.version}`;
    const keys = this.mountManifests.get(mount) ?? new Set<string>(); keys.add(key); this.mountManifests.set(mount, keys);
    if ((this.manifests.get(key)?.until ?? Infinity) <= this.now()) this.manifests.delete(key);
    if (!this.manifests.has(key)) {
      const record = { promise: this.json(url('')), until: Infinity };
      this.manifests.set(key, record);
      // Keep transient failures briefly, so newly visible grains do not each retry
      // the same unavailable manifest. An access failure can retry with a new grant.
      void record.promise.catch(error => { record.until = error instanceof AtlasHttpError && [401, 403].includes(error.status) ? 0 : this.now() + 30_000; });
    }
    let atlas: GrainAtlas;
    try { atlas = await this.manifests.get(key)!.promise; }
    catch (error) {
      if (stale()) throw new Error('The account or server changed, or the mount was refreshed.');
      if (!failed && error instanceof AtlasHttpError && [401, 403].includes(error.status)) return this.published(scope, server, mount, read, { grant: entry, listing, atlas: { tile_size: 0, areas: [] }, url });
      throw error;
    }
    if (stale()) throw new Error('The account or server changed, or the mount was refreshed.');
    return { grant: entry, atlas, listing, url };
  }
}

export class AtlasHttpError extends Error { constructor(public status: number, message: string) { super(message); } }
/** Metadata has the same 4 s connect / 30 s without bytes policy as identity GET.
 * Images use native SVG image loading; no fetch, canvas or crossOrigin for tiles.
 */
async function atlasJson(url: string): Promise<GrainAtlas> {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), 4000);
  const progress = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), 30_000); };
  try {
    const reply = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', priority: 'low' } as RequestInit);
    progress();
    const reader = reply.body?.getReader(), decoder = new TextDecoder();
    let body = '';
    if (reader) {
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; progress(); body += decoder.decode(chunk.value, { stream: true }); } body += decoder.decode(); }
      finally { reader.releaseLock(); }
    }
    if (!reply.ok) throw new AtlasHttpError(reply.status, `Atlas returned ${reply.status}: ${body.replace(/[\u0000-\u001f]/g, ' ').slice(0, 160)}`);
    try {
      const atlas = JSON.parse(body) as GrainAtlas;
      if (!Array.isArray(atlas.areas) || !(atlas.tile_size > 0)) throw new Error();
      return atlas;
    } catch { throw new Error(`Atlas returned ${reply.status}: invalid atlas.json.`); }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Atlas connection or data transfer stalled.');
    // Do not show the signed URL in browser network errors.
    if (error instanceof TypeError) throw new Error('The published atlas could not be reached.');
    throw error;
  } finally { clearTimeout(timer); }
}

/** A slot belongs to an actual SVG image until load/error, not to a separate preload. */
export class TileQueue {
  private active = 0;
  private waiting: { start: (release: () => void) => void; cancelled: boolean }[] = [];
  constructor(private limit = 6) {}
  add(start: (release: () => void) => void) {
    const job = { start, cancelled: false };
    this.waiting.push(job); this.drain();
    return () => { job.cancelled = true; };
  }
  private drain() {
    while (this.active < this.limit && this.waiting.length) {
      const job = this.waiting.shift()!;
      if (job.cancelled) continue;
      this.active++;
      let done = false;
      job.start(() => { if (done) return; done = true; this.active--; this.drain(); });
    }
  }
}
export const grainImages = new GrainImageCache();
export const grainTiles = new TileQueue();
