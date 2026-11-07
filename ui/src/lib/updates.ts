export const STABLE_ENDPOINT = 'https://github.com/duserzym/upblab/releases/latest/download/latest.json';
export const RELEASES_PAGE = 'https://github.com/duserzym/upblab/releases';
export type Channel = 'stable' | 'beta';
export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
  ready: boolean;
}
export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none'; checkedAt: number }
  | { kind: 'available'; info: UpdateInfo }
  | { kind: 'downloading'; info: UpdateInfo; pct: number | null }
  | { kind: 'ready'; info: UpdateInfo }
  | { kind: 'installing'; info: UpdateInfo }
  | { kind: 'error'; message: string }
  | { kind: 'unsupported'; reason: string; info?: UpdateInfo };

/** Semver precedence; build metadata does not affect ordering. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, ...pre] = v.replace(/^v/, '').split('+')[0].split('-');
    return { core: core.split('.').map(BigInt), pre: pre.join('-').split('.').filter(Boolean) };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) {
    const n = x.core[i] ?? 0n, m = y.core[i] ?? 0n;
    if (n !== m) return n > m ? 1 : -1;
  }
  if (!x.pre.length || !y.pre.length) return Number(!x.pre.length) - Number(!y.pre.length);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const n = x.pre[i], m = y.pre[i];
    if (n === undefined) return -1;
    if (m === undefined) return 1;
    if (n === m) continue;
    const nn = /^\d+$/.test(n), mn = /^\d+$/.test(m);
    if (nn && mn) return BigInt(n) > BigInt(m) ? 1 : -1;
    if (nn !== mn) return nn ? -1 : 1;
    return n > m ? 1 : -1;
  }
  return 0;
}

interface Release {
  draft?: boolean;
  published_at?: string | null;
  assets?: { name?: string; browser_download_url?: string }[];
}
/** GitHub lists newest first; published dates also handle an unordered list. */
export function pickEndpoint(channel: Channel, releases: unknown): string {
  if (channel === 'stable' || !Array.isArray(releases)) return STABLE_ENDPOINT;
  const newest = (releases as Release[]).filter((r) => r && !r.draft).sort((a, b) =>
    (Date.parse(b.published_at ?? '') || 0) - (Date.parse(a.published_at ?? '') || 0))[0];
  const url = newest?.assets?.find((a) => a.name === 'latest.json')?.browser_download_url;
  return url?.startsWith('https://') ? url : STABLE_ENDPOINT;
}

export type UpdateEvent =
  | { type: 'check'; manual?: boolean }
  | { type: 'checked'; info: UpdateInfo | null; checkedAt: number }
  | { type: 'download' }
  | { type: 'progress'; pct: number | null }
  | { type: 'downloaded'; info: UpdateInfo }
  | { type: 'install' }
  | { type: 'failed'; message: string };

export function transition(status: UpdateStatus, event: UpdateEvent): UpdateStatus {
  switch (event.type) {
    case 'check':
      return ['checking', 'downloading', 'installing', 'unsupported'].includes(status.kind)
        || status.kind === 'ready' && !event.manual ? status : { kind: 'checking' };
    case 'checked':
      return status.kind !== 'checking' ? status : event.info
        ? { kind: event.info.ready ? 'ready' : 'available', info: event.info }
        : { kind: 'none', checkedAt: event.checkedAt };
    case 'download':
      return status.kind === 'available' ? { kind: 'downloading', info: status.info, pct: 0 } : status;
    case 'progress':
      return status.kind === 'downloading' ? { ...status, pct: event.pct === null ? null : Math.max(0, Math.min(100, event.pct)) } : status;
    case 'downloaded':
      return status.kind === 'downloading' ? { kind: 'ready', info: event.info } : status;
    case 'install':
      return status.kind === 'ready' ? { kind: 'installing', info: status.info } : status;
    case 'failed':
      return ['checking', 'downloading', 'installing'].includes(status.kind) ? { kind: 'error', message: event.message } : status;
  }
}

