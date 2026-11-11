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

/** Keep native updater diagnostics readable without exposing a long transport error. */
export function friendlyUpdateError(raw: string): string {
  if (/pubkey|public key|base64|decode|not configured/i.test(raw)) return 'Updates are not configured for this build yet.';
  if (/404|release JSON|Could not fetch a valid release|not found|no assets/i.test(raw)) return 'No release has been published yet.';
  if (/error sending request|dns|connect|timed out|timeout|offline|network|failed to fetch|ENOTFOUND|URLError/i.test(raw)) {
    return "Can't reach the update server. Check your internet connection and try again.";
  }
  const detail = raw.trim();
  return `The update check failed: ${detail.length > 120 ? `${detail.slice(0, 119)}…` : detail}`;
}

/** Presentation only: state and actions remain owned by the shared updater. */
export function checkButtonView(status: UpdateStatus, version: string, options: { autoDownload?: boolean; standardsWarning?: boolean } = {}) {
  let text: string;
  let action: 'download' | 'install' | 'releases' | null = null;
  switch (status.kind) {
    case 'idle': text = 'Check for updates'; break;
    case 'checking': text = 'Checking for updates…'; break;
    case 'none': text = `Up to date (v${version})`; break;
    case 'available':
      text = `Update available: v${status.info.version}`;
      if (!options.autoDownload) action = 'download';
      break;
    case 'downloading': text = `Downloading v${status.info.version}…${status.pct === null ? '' : ` ${status.pct}%`}`; break;
    case 'ready': text = `v${status.info.version} is ready`; action = 'install'; break;
    case 'installing': text = 'Installing and restarting…'; break;
    case 'error': text = friendlyUpdateError(status.message); break;
    case 'unsupported':
      text = status.info ? `Update available: v${status.info.version}` : status.reason;
      if (status.info) action = 'releases';
      break;
  }
  return {
    text, action,
    badge: !!options.standardsWarning || status.kind === 'available' || status.kind === 'ready' || status.kind === 'unsupported' && !!status.info,
    busy: ['checking', 'downloading', 'installing'].includes(status.kind),
  };
}

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

