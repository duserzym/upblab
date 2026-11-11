import { isDesktop } from './platform';
import { settings } from './settings.svelte';
import { shellVersion } from './versions';
import { checkButtonView, pickEndpoint, STABLE_ENDPOINT, transition, type UpdateEvent, type UpdateInfo, type UpdateStatus } from './updates';

const WEB_REASON = 'Updates come with the desktop app; the web page is always the version its server serves.';
const INSTALL_REASON = 'Install UPb Lab to receive in-app updates on this computer.';
const previewName = !isDesktop && typeof location !== 'undefined'
  ? new URLSearchParams(location.search).get('update-preview') : null;
export const updatePreview = ['idle', 'checking', 'none', 'available', 'downloading', 'ready', 'error', 'unsupported'].includes(previewName ?? '');
const fake: UpdateInfo = { version: '0.2.0', currentVersion: '0.1.0', notes: 'Review tab, faster module switching', date: null, ready: false };
function previewStatus(): UpdateStatus {
  switch (previewName) {
    case 'idle': return { kind: 'idle' };
    case 'checking': return { kind: 'checking' };
    case 'none': return { kind: 'none', checkedAt: Date.now() };
    case 'available': return { kind: 'available', info: fake };
    case 'downloading': return { kind: 'downloading', info: fake, pct: 43 };
    case 'ready': return { kind: 'ready', info: { ...fake, ready: true } };
    case 'error': return { kind: 'error', message: 'Updates are not configured for this build yet' };
    default: return { kind: 'unsupported', reason: INSTALL_REASON, info: fake };
  }
}

export const updater = $state({
  status: (updatePreview ? previewStatus() : isDesktop ? { kind: 'idle' }
    : { kind: 'unsupported', reason: WEB_REASON }) as UpdateStatus,
  version: __APP_VERSION__,
  supported: false,
  justChecked: false,
  lastResult: '',
  standards: { message: 'Standards have not been checked.', warning: false, changed: [] } as StandardsStatus,
  standardsChecking: false,
});
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
function showChecked() {
  clearTimeout(feedbackTimer);
  updater.justChecked = true;
  feedbackTimer = setTimeout(() => { updater.justChecked = false; }, 5000);
}
if (previewName === 'none') showChecked();
function send(event: UpdateEvent) { updater.status = transition(updater.status, event); }
function fail(error: unknown) {
  const message = String(error);
  send({ type: 'failed', message });
  updater.lastResult = checkButtonView(updater.status, updater.version).text;
}
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return (await import('@tauri-apps/api/core')).invoke<T>(command, args);
}
type StandardsStatus = { message: string; warning: boolean; changed: string[] };

export async function checkStandards(): Promise<void> {
  if (!isDesktop || updatePreview || updater.standardsChecking) return;
  updater.standardsChecking = true;
  try {
    const result = await invoke<StandardsStatus | null>('standards_check');
    if (!result || !Array.isArray(result.changed)) throw new Error('Missing standards status');
    updater.standards = result;
  } catch {
    updater.standards = { ...updater.standards, message: 'Standards check unavailable in this build.' };
  } finally {
    updater.standardsChecking = false;
  }
}

async function endpoint() {
  if (settings.updateChannel === 'stable') return STABLE_ENDPOINT;
  try {
    const res = await fetch('https://api.github.com/repos/duserzym/upblab/releases?per_page=10', {
      headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? pickEndpoint('beta', await res.json()) : STABLE_ENDPOINT;
  } catch { return STABLE_ENDPOINT; }
}

/** A manual check always reaches the server, including when an update is ready. */
export async function check(manual = false): Promise<void> {
  if (!updatePreview && !isDesktop) return;
  void checkStandards();
  if (['checking', 'downloading', 'installing'].includes(updater.status.kind) || updater.status.kind === 'ready' && !manual) return;
  // Unsupported installed formats can still check and link to the download page.
  if (updater.status.kind === 'unsupported') updater.status = { kind: 'idle' };
  send({ type: 'check', manual });
  updater.justChecked = false;
  try {
    await settings.update({ updateLastCheck: Date.now() });
    if (updatePreview) {
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
      updater.status = previewName === 'idle' ? { kind: 'none', checkedAt: Date.now() } : previewStatus();
      updater.lastResult = checkButtonView(updater.status, updater.version).text;
      await settings.update({ updateLastCheck: Date.now() });
      if (updater.status.kind === 'none' && manual) showChecked();
      return;
    }
    updater.supported = await invoke<boolean>('update_supported');
    const info = await invoke<UpdateInfo | null>('update_check', { endpoint: await endpoint() });
    const checkedAt = Date.now();
    await settings.update({ updateLastCheck: checkedAt });
    updater.lastResult = info ? `Version ${info.version} ${info.ready ? 'is ready to install' : 'is available'}` : "You're up to date";
    send({ type: 'checked', info, checkedAt });
    if (!updater.supported && !updatePreview) {
      updater.status = { kind: 'unsupported', reason: INSTALL_REASON, info: info ?? undefined };
      return;
    }
    if (!info && manual) showChecked();
    if (info && !info.ready && settings.updateAuto) await download();
  } catch (error) { fail(error); }
}

export async function download(): Promise<void> {
  if (updater.status.kind !== 'available' || !updatePreview && !updater.supported) return;
  send({ type: 'download' });
  let off: (() => void) | undefined;
  try {
    if (updatePreview) {
      send({ type: 'downloaded', info: { ...fake, ready: true } });
      return;
    }
    const { listen } = await import('@tauri-apps/api/event');
    off = await listen<{ downloaded: number; total: number | null }>('update-progress', ({ payload }) => {
      send({ type: 'progress', pct: payload.total ? Math.round(payload.downloaded / payload.total * 100) : null });
    });
    const info = await invoke<UpdateInfo>('update_download');
    send({ type: 'downloaded', info });
    updater.lastResult = `Version ${info.version} is ready to install`;
  } catch (error) { fail(error); }
  finally { off?.(); }
}

export async function install(): Promise<void> {
  if (updater.status.kind !== 'ready' || !updatePreview && !updater.supported) return;
  send({ type: 'install' });
  if (updatePreview) return;
  try { await invoke('update_install'); } catch (error) { fail(error); }
}

/** Mount once; cleanup also handles unmounting while native support is being queried. */
export function startScheduler(): () => void {
  let stopped = false;
  let first: ReturnType<typeof setTimeout> | undefined;
  let every: ReturnType<typeof setInterval> | undefined;
  if (!updatePreview && isDesktop) {
    function scheduledCheck() {
      if (updater.supported) void check();
      else void checkStandards();
    }
    first = setTimeout(scheduledCheck, 8000);
    every = setInterval(scheduledCheck, 6 * 3600_000);
    void (async () => {
      try {
        updater.version = await shellVersion();
        updater.supported = await invoke<boolean>('update_supported');
        if (stopped) return;
        if (!updater.supported) {
          updater.status = { kind: 'unsupported', reason: INSTALL_REASON };
          return;
        }
        const pending = await invoke<UpdateInfo | null>('update_status');
        if (stopped) return;
        if (pending) updater.status = { kind: pending.ready ? 'ready' : 'available', info: pending };
      } catch (error) {
        if (!stopped) { updater.status = { kind: 'checking' }; fail(error); }
      }
    })();
  }
  return () => { stopped = true; clearTimeout(first); clearInterval(every); };
}
