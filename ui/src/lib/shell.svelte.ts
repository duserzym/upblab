// Shell state: the active tab, what each module tab should show, the module
// builds that are installed, and the routing of every incoming link.

import { moduleHome, moduleUrl, resolve, type ModuleBases, type ModuleTab, type Resolution, type TabId } from './links';
import { isDesktop, launchStudio, logInfo, logWarn, openExternal } from './platform';
import { localService } from './localService.svelte';
import { settings } from './settings.svelte';

export type View = TabId | 'settings';

/** Placeholder while the local service starts (its usual port). */
const LOCAL_PENDING = 'http://127.0.0.1:8000';

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

/** A navigation request for a module tab; `seq` changes on every request. */
export interface ModuleTarget {
  url: string;
  seq: number;
}

class Shell {
  view = $state<View>('home');
  modules = $state<InstalledModule[]>([]);
  links = $state<LinkRecord[]>([]);
  targets = $state<Record<ModuleTab, ModuleTarget | null>>({ images: null, sessions: null });
  studioRequest = $state<{ url: string; seq: number } | null>(null);
  /** Overlays in the shell (dialogs) must hide native module webviews, which always paint on top. */
  overlay = $state(false);
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
    return { server: this.serverUrl, atlas: atlasDir };
  }

  homeUrl(tab: ModuleTab): string {
    return moduleHome(tab, this.bases);
  }

  show(view: View) {
    this.view = view;
    if (view !== 'settings' && settings.loaded && settings.lastTab !== view) void settings.update({ lastTab: view });
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
    this.links = [{ at: new Date(), url, from, outcome, refused }, ...this.links].slice(0, 50);
  }

  /** Route a URL from the OS, a module, or the user. Returns false when refused. */
  async handleLink(url: string, from: string): Promise<boolean> {
    const r: Resolution = resolve(url);
    switch (r.kind) {
      case 'refused':
        this.record(url, from, r.reason, true);
        await logWarn(`[links] refused ${JSON.stringify(url)} from ${from}: ${r.reason}`);
        return false;
      case 'external':
        this.record(url, from, 'opened in the system browser');
        await openExternal(r.url);
        return true;
      case 'tab': {
        this.seq += 1;
        this.targets[r.tab] = { url: moduleUrl(r.tab, r.route, this.bases), seq: this.seq };
        this.show(r.tab);
        this.record(url, from, `${r.tab === 'sessions' ? 'Sessions' : 'Images'} ${r.route}`);
        await logInfo(`[links] ${url} -> ${r.tab} ${r.route}`);
        return true;
      }
      case 'studio': {
        this.seq += 1;
        this.studioRequest = { url: r.url, seq: this.seq };
        this.show('reduce');
        if (settings.studioPath && isDesktop) {
          try {
            await launchStudio(settings.studioPath, r.url);
            this.record(url, from, `UPbRPy Studio launched for session ${r.session}`);
          } catch (err) {
            this.record(url, from, `Studio launch failed: ${err}`, true);
            await logWarn(`[links] could not launch Studio for ${url}: ${err}`);
            return false;
          }
        } else {
          this.record(url, from, 'Studio not configured; see the Reduce tab');
        }
        return true;
      }
    }
  }
}

export const shell = new Shell();
