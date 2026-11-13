// Shell state: the active tab, what each module tab should show, the module
// builds that are installed, and the routing of every incoming link.

import { moduleHome, moduleUrl, resolve, type ModuleBases, type ModuleTab, type Resolution, type TabId } from './links';
import { isDesktop, launchStudio, logInfo, logWarn, openExternal, studioStatus, type AuthTarget, type StudioConfig } from './platform';
import { identity } from './identity.svelte';
import { localService } from './localService.svelte';
import { settings } from './settings.svelte';
import { overlays } from './overlays.svelte';

export type View = TabId | 'settings' | 'account';

/** Placeholder while the local service starts (its usual port). */
const LOCAL_PENDING = 'http://127.0.0.1:8000';

/** Keychain entry of the local instance's token: its port may change between launches. */
export const LOCAL_KEY = 'this-computer';

/** One-time codes never go into the link list or the log. */
export function redact(url: string): string {
  return url.replace(/([?&#]code=)[^&#\s]+/g, '$1…');
}

export interface InstalledModule {
  name: string;
  version: string;
  source: string;
  sha256: string;
  entry: string;
}

export interface LinkRecord {
  at: Date;
  url: string;
  from: string;
  outcome: string;
  refused: boolean;
}

/** The last Studio hand-off, shown in the Reduce tab. */
export interface StudioRequest {
  seq: number;
  object: 'session' | 'run';
  id: string;
  /** The link as received, code redacted. */
  shown: string;
  /** Web delivery only: the link with its fresh code, for the user to click. */
  href?: string;
  state: 'launching' | 'launched' | 'missing' | 'failed' | 'web';
  /** The launch command line (code redacted). */
  command?: string;
  error?: string;
  /** Whether a one-time code was minted for it. */
  minted: boolean;
}

/** Strip a trailing slash so http://h:8000/ and http://h:8000 compare equal. */
function sameServer(a: string, b: string): boolean {
  const n = (s: string) => s.trim().replace(/\/+$/, '').toLowerCase();
  return n(a) === n(b);
}

/**
 * docs/WORKFLOW.md section 4: a upbr:// link without a code gets one minted
 * with the shell's sign-in (POST /v1/auth/handoff), and the shell's server.
 * Links for another server, or with a code already, pass unchanged.
 */
export async function withHandoff(
  link: string,
  server: string | null,
  mint: () => Promise<string | null>,
): Promise<{ url: string; minted: boolean; error?: string }> {
  const u = new URL(link);
  if (u.searchParams.get('code')) return { url: link, minted: false };
  const linkServer = u.searchParams.get('server');
  if (!server || (linkServer && !sameServer(linkServer, server))) return { url: link, minted: false };
  if (!linkServer) u.searchParams.set('server', server);
  let code: string | null = null;
  let error: string | undefined;
  try {
    code = await mint();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  if (code) u.searchParams.set('code', code);
  return { url: u.href, minted: !!code, error };
}

/** A navigation request for a module tab; `seq` changes on every request. */
export interface ModuleTarget {
  url: string;
  seq: number;
}

class Shell {
  view = $state<View>('home');
  modules = $state<InstalledModule[]>([]);
  links = $state<LinkRecord[]>([]);
  targets = $state<Record<ModuleTab, ModuleTarget | null>>({ images: null, sessions: null, people: null });
  studio = $state<StudioRequest | null>(null);
  /** Overlays in the shell (dialogs) must hide native module webviews, which always paint on top. */
  get overlay() { return overlays.active; }
  private seq = 0;

  get atlas(): InstalledModule | undefined {
    return this.modules.find((m) => m.name === 'grainatlas');
  }

  /** Desktop in "This computer" mode: laicpmsdb runs on this machine. */
  get local(): boolean {
    return isDesktop && settings.mode === 'local';
  }

  /** Where laicpmsdb is: the local instance (once healthy) or the configured server. */
  get serverUrl(): string {
    return this.local ? (localService.url ?? LOCAL_PENDING) : settings.serverUrl;
  }

  get bases(): ModuleBases {
    const atlasDir = isDesktop || import.meta.env.DEV ? new URL('./modules/grainatlas/', location.href).href : '/atlas/';
    return { server: this.serverUrl, atlas: atlasDir, theme: settings.effectiveTheme };
  }

  /** Which laicpmsdb to sign in to; null while the local instance is not up yet. */
  get identityTarget(): AuthTarget | null {
    if (this.local) return localService.url ? { server: localService.url, key: LOCAL_KEY } : null;
    return settings.serverUrl ? { server: settings.serverUrl, key: settings.serverUrl } : null;
  }

  get studioConfig(): StudioConfig {
    return { path: settings.studioPath, checkout: settings.studioCheckout };
  }

  homeUrl(tab: ModuleTab): string {
    return moduleHome(tab, this.bases);
  }

  show(view: View) {
    this.view = view;
    if (view !== 'settings' && view !== 'account' && view !== 'people' && settings.loaded && settings.lastTab !== view) void settings.update({ lastTab: view });
  }

  async loadModules() {
    try {
      const res = await fetch('./modules/manifest.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { modules?: InstalledModule[] };
      this.modules = Array.isArray(data.modules) ? data.modules : [];
    } catch {
      this.modules = [];
    }
  }

  private record(url: string, from: string, outcome: string, refused = false) {
    this.links = [{ at: new Date(), url: redact(url), from, outcome, refused }, ...this.links].slice(0, 50);
  }

  /** A line in Home's Links list for something that is not a link (opened files). */
  note(what: string, from: string, outcome: string, refused = false) {
    this.record(what, from, outcome, refused);
  }

  /** Set a module target without leaving the current view. */
  load(tab: ModuleTab, route: string) {
    this.seq += 1;
    this.targets[tab] = { url: moduleUrl(tab, route, this.bases), seq: this.seq };
  }

  /** Load a module route and show its tab. */
  go(tab: ModuleTab, route: string) {
    this.load(tab, route);
    this.show(tab);
  }

  /**
   * upbr://session/<id> and upbr://run/<id>: find Studio, mint a handoff code
   * when the link has none, and launch Studio with the link
   * (docs/WORKFLOW.md section 4). Without Studio the Reduce tab shows how to
   * install it, and the link.
   */
  async reduce(object: 'session' | 'run', id: string, link: string, from: string): Promise<boolean> {
    this.seq += 1;
    const seq = this.seq;
    const base = { seq, object, id, shown: redact(link), minted: false };
    this.studio = { ...base, state: 'launching' };
    this.show('reduce');
    const what = `${object} ${id}`;
    if (!isDesktop) {
      // The browser hands upbr:// to the OS, which opens Studio (its own installer registers the scheme).
      const h = await withHandoff(link, this.identityTarget?.server ?? null, () => identity.handoff());
      this.studio = { ...base, state: 'web', href: h.url, minted: h.minted, error: h.error };
      this.record(link, from, `open it in UPbRPy Studio from the Reduce tab`);
      return true;
    }
    const status = await studioStatus(this.studioConfig).catch((err) => ({ found: false, path: null, error: String(err) }));
    if (!status.found) {
      this.studio = { ...base, state: 'missing', error: status.error };
      this.record(link, from, 'UPbRPy Studio not found; see the Reduce tab', true);
      await logWarn(`[studio] not found (${status.error ?? ''}); ${redact(link)} not launched`);
      return true;
    }
    const h = await withHandoff(link, this.identityTarget?.server ?? null, () => identity.handoff());
    if (h.error) await logWarn(`[studio] no handoff code for ${what}: ${h.error}`);
    try {
      const command = await launchStudio(this.studioConfig, h.url);
      if (this.studio?.seq === seq) this.studio = { ...base, shown: redact(h.url), state: 'launched', command, minted: h.minted, error: h.error };
      this.record(link, from, `UPbRPy Studio launched for ${what}${h.minted ? ' with a handoff code' : ''}`);
      await logInfo(`[studio] ${redact(h.url)} from ${from}: ${command}`);
      return true;
    } catch (err) {
      if (this.studio?.seq === seq) this.studio = { ...base, state: 'failed', error: String(err), minted: h.minted };
      this.record(link, from, `Studio launch failed: ${err}`, true);
      await logWarn(`[studio] could not launch for ${redact(link)}: ${err}`);
      return false;
    }
  }

  /** Route a URL from the OS, a module, or the user. Returns false when refused. */
  async handleLink(url: string, from: string): Promise<boolean> {
    const r: Resolution = resolve(url);
    switch (r.kind) {
      case 'refused':
        this.record(url, from, r.reason, true);
        await logWarn(`[links] refused ${JSON.stringify(redact(url))} from ${from}: ${r.reason}`);
        return false;
      case 'auth': {
        const done = await identity.completeProvider(r.code, from);
        this.record(url, from, done.outcome, !done.ok);
        await (done.ok ? logInfo : logWarn)(`[links] ${redact(url)} from ${from}: ${done.outcome}`);
        return done.ok;
      }
      case 'auth-error': {
        const done = identity.failProvider(r.error, from);
        this.record(url, from, done.outcome, true);
        await logWarn(`[links] ${redact(url)} from ${from}: ${done.outcome}`);
        return false;
      }
      case 'external':
        this.record(url, from, 'opened in the system browser');
        await openExternal(r.url);
        return true;
      case 'tab': {
        this.go(r.tab, r.route);
        this.record(url, from, `${r.tab === 'sessions' ? 'Sessions' : 'Images'} ${r.route}`);
        await logInfo(`[links] ${url} -> ${r.tab} ${r.route}`);
        return true;
      }
      case 'studio':
        return this.reduce(r.object, r.id, r.url, from);
    }
  }
}

export const shell = new Shell();
