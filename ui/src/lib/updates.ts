export const STABLE_ENDPOINT = 'https://github.com/duserzym/upblab/releases/latest/download/latest.json';
export const RELEASES_PAGE = 'https://github.com/duserzym/upblab/releases';
export const UPDATE_APP_NAME = 'UPb Lab';
const UPDATE_HOST = new URL(STABLE_ENDPOINT).host;
export const UPDATE_INSTALL_REASON = `${UPDATE_APP_NAME} cannot replace itself in this folder. Download the new version from GitHub.`;
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

/** Keep the raw diagnostic selectable, but short enough for the update views. */
export function updateErrorDetail(raw: string): string {
  const detail = raw.trim();
  return detail.length > 120 ? `${detail.slice(0, 119)}…` : detail;
}

/** Classify in the shared lab pathway's order, before general network errors. */
export function friendlyUpdateError(raw: string): string {
  if (/pubkey|public key|not configured/i.test(raw)) return 'Updates are not configured for this build yet.';
  if (/certificate|UnknownIssuer/i.test(raw)) return `Could not verify the secure connection to ${UPDATE_HOST}.`;
  if (/signature|minisign|verify|verification|verified/i.test(raw)) return "The update's signature did not match. Nothing was installed.";
  if (/\b404\b|release JSON|Could not fetch a valid release|not found|no assets/i.test(raw)) return `No public release of ${UPDATE_APP_NAME} has been published.`;
  if (/error sending request|dns|connect|timed out|timeout|offline|network|failed to fetch|ENOTFOUND|URLError/i.test(raw)) {
    return `No internet connection, or ${UPDATE_HOST} did not answer.`;
  }
  if (/not writable|not writeable|permission denied|access (?:is )?denied|read-only file system/i.test(raw)) return UPDATE_INSTALL_REASON;
  return `The update check failed: ${updateErrorDetail(raw)}`;
}

/** Presentation only: state and actions remain owned by the shared updater. */
export function checkButtonView(status: UpdateStatus, version: string, options: { autoDownload?: boolean; standardsWarning?: boolean } = {}) {
  let text: string;
  let action: 'download' | 'install' | 'releases' | null = null;
  switch (status.kind) {
    case 'idle': text = `Current version: v${version}`; break;
    case 'checking': text = 'Checking for updates…'; break;
    case 'none': text = `Up to date (v${version})`; break;
    case 'available':
      text = `Update available: v${status.info.version}`;
      if (!options.autoDownload) action = 'download';
      break;
    case 'downloading': text = `Downloading v${status.info.version}…${status.pct === null ? '' : ` ${status.pct}%`}`; break;
    case 'ready': text = `v${status.info.version} is ready`; action = 'install'; break;
    case 'installing': text = `Installing v${status.info.version} and restarting…`; break;
    case 'error': text = friendlyUpdateError(status.message); break;
    case 'unsupported':
      text = status.reason;
      if (status.info) action = 'releases';
      break;
  }
  return {
    text, action,
    secondaryText: status.kind === 'available' ? `Current version: v${version}` : null,
    details: status.kind === 'error' ? updateErrorDetail(status.message) : null,
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

