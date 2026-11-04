// Open anything (ux-conventions rule 4) at the shell level: folders and files
// dropped on the window, opened through the OS, or picked with Home's Open
// buttons go to the tab that reads them, decided by content (lib/drop.ts),
// and the files are handed to that module through @lab/bridge `open-files`
// (protocol v2). The user is never asked what they dropped.
//
//   desktop  the host lists the paths and keeps the offer; the module takes
//            the manifest and reads the bytes (src-tauri/src/files.rs)
//   web      the page has the File objects; the module asks for them over
//            postMessage and gets them by structured clone (lib/incoming.ts)

import type { OpenFilesTransfer } from '@lab/bridge';
import { classify, expandOpened, formatBytes, type Routed, type WebSet } from './drop';
import type { ModuleTab } from './links';
import { desktopFiles, isDesktop, logInfo, logWarn } from './platform';
import { shell } from './shell.svelte';

export const MODULE_OF: Record<ModuleTab, string> = { images: 'grainatlas', sessions: 'laicpmsdb' };
const TAB_OF: Record<string, ModuleTab> = { grainatlas: 'images', laicpmsdb: 'sessions' };

/** How long a module has to take its files before Home says it does not read open-files yet. */
export const TAKE_TIMEOUT_MS = 10_000;

export interface OpenStatus {
  what: string;
  outcome: string;
  state: 'busy' | 'offered' | 'taken' | 'refused' | 'failed';
}

function describe(r: Extract<Routed, { target: ModuleTab }>): string {
  const kinds: Record<string, string> = {
    package: 'TM4000 package',
    area: 'area folder',
    images: 'images',
    project: 'grainatlas project',
    export: 'Qtegra export',
    zip: 'zip',
    csv: 'CSV files',
  };
  const n = r.picks.length;
  return `${kinds[r.kind] ?? r.kind} ${r.name}, ${n} file${n === 1 ? '' : 's'} (${formatBytes(r.bytes)})`;
}

class Opener {
  /** Files are being dragged over the window (desktop: any webview; web: the shell page). */
  dragging = $state(false);
  /** The latest open, for Home. */
  status = $state<OpenStatus | null>(null);
  /** Web delivery: files waiting for a module iframe. */
  private web: Partial<Record<ModuleTab, OpenFilesTransfer>> = {};
  private waiting = new Map<string, { module: string; what: string; from: string; timer: ReturnType<typeof setTimeout> }>();
  private seq = 0;
  /** Web delivery: nudge a module iframe (set by lib/incoming.ts). */
  pushFrame: ((tab: ModuleTab) => void) | null = null;

  private refuse(what: string, from: string, reason: string) {
    this.status = { what, outcome: reason, state: 'refused' };
    shell.note(what, from, reason, true);
    void logWarn(`[open] ${what} from ${from}: ${reason}`);
  }

  private fail(what: string, from: string, err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    this.status = { what, outcome: msg, state: 'failed' };
    shell.note(what, from, `could not open: ${msg}`, true);
    void logWarn(`[open] ${what} from ${from}: ${msg}`);
  }

  /** Show the tab; Sessions opens its ingest route (desktop with the path, `laicpmsdb://ingest?path=`). */
  private route(r: Extract<Routed, { target: ModuleTab }>, from: string) {
    if (r.target === 'images') shell.show('images');
    else if (isDesktop && r.path) void shell.handleLink(`laicpmsdb://ingest?path=${encodeURIComponent(r.path)}`, from);
    else shell.go('sessions', '/app/ingest');
  }

  private offered(id: string, r: Extract<Routed, { target: ModuleTab }>, what: string, from: string) {
    const module = MODULE_OF[r.target];
    const outcome = `${r.target === 'images' ? 'Images' : 'Sessions'}: ${describe(r)} handed to ${module}`;
    this.status = { what, outcome, state: 'offered' };
    shell.note(what, from, outcome);
    void logInfo(`[open] ${what} from ${from}: ${r.kind} ${JSON.stringify(r.name)}, ${r.picks.length} files -> ${module} (open-files ${id})`);
    const timer = setTimeout(() => {
      if (!this.waiting.delete(id)) return;
      const late = `${module} has not taken the files: it does not read open-files (@lab/bridge v2) yet; open them with its own Open button`;
      if (this.status?.what === what) this.status = { what, outcome: late, state: 'offered' };
      shell.note(what, from, late);
      void logWarn(`[open] open-files ${id}: ${late}`);
    }, TAKE_TIMEOUT_MS);
    this.waiting.set(id, { module, what, from, timer });
  }

  /** Desktop: paths from a drop, the OS or the Open dialog. */
  async openPaths(paths: string[], from: string): Promise<Routed> {
    const list = expandOpened(paths);
    const what = list.length <= 1 ? (list[0] ?? '') : `${list[0]} and ${list.length - 1} more`;
    if (!list.length) return { target: null, reason: 'nothing to open' };
    this.status = { what, outcome: 'reading…', state: 'busy' };
    try {
      const scan = await desktopFiles.scan(list);
      const r = classify(scan.roots, scan.entries);
      if (!r.target) {
        this.refuse(what, from, scan.missing.length ? `could not read ${scan.missing.join(', ')}` : r.reason);
        return r;
      }
      if (scan.truncated) void logWarn(`[open] ${what}: listing cut short at ${scan.entries.length} files`);
      const offer = await desktopFiles.offer({
        scan: scan.scan,
        module: r.target,
        files: r.picks,
        kind: r.kind,
        name: r.name,
        path: r.path ?? null,
        // Sessions loads its ingest page, which takes the files when it starts.
        nudge: r.target === 'images',
      });
      this.offered(offer.id, r, what, from);
      this.route(r, from);
      return r;
    } catch (err) {
      this.fail(what, from, err);
      return { target: null, reason: String(err) };
    }
  }

  /** Web delivery: files dropped on the shell page or chosen in Home. */
  openWebFiles(set: WebSet, from: string): Routed {
    const what = set.roots.length <= 1 ? (set.roots[0]?.name ?? '') : `${set.roots[0].name} and ${set.roots.length - 1} more`;
    const r = classify(set.roots, set.entries);
    if (!r.target) {
      this.refuse(what || 'drop', from, r.reason);
      return r;
    }
    this.seq += 1;
    const id = `w${Date.now().toString(36)}-${this.seq}`;
    this.web[r.target] = {
      id,
      kind: r.kind,
      name: r.name,
      files: r.picks.map((p) => ({ path: p.path, file: set.files[p.index] })),
    };
    this.offered(id, r, what, from);
    this.route(r, from);
    if (r.target === 'images') this.pushFrame?.(r.target);
    return r;
  }

  /** Web delivery: a module iframe asks for its files (frame host `openFiles`). */
  takeWeb(module: string, take: boolean): OpenFilesTransfer | null {
    const tab = TAB_OF[module];
    const t = tab ? this.web[tab] : undefined;
    if (!t) return null;
    if (take) {
      delete this.web[tab];
      this.taken(t.id, module, t.files.length, t.files.reduce((n, f) => n + f.file.size, 0));
    }
    return t;
  }

  /** A module took its files (desktop host event, or a web request). */
  taken(id: string, module: string, files: number, bytes: number) {
    const w = this.waiting.get(id);
    if (w) {
      clearTimeout(w.timer);
      this.waiting.delete(id);
    }
    const outcome = `${module} took ${files} file${files === 1 ? '' : 's'} (${formatBytes(bytes)})`;
    if (w && this.status?.what === w.what) this.status = { what: w.what, outcome, state: 'taken' };
    shell.note(w?.what ?? `open-files ${id}`, module, outcome);
    void logInfo(`[open] open-files ${id}: ${outcome}`);
  }

  /** Debug builds: the host's probe read the files inside a module webview that did not take them. */
  seen(module: string, event: Record<string, unknown>) {
    const files = Number(event.files) || 0;
    const outcome = `${module} webview received ${files} file${files === 1 ? '' : 's'} (${formatBytes(Number(event.bytes) || 0)}, first ${String(event.first ?? '')}) through open-files; ${module} itself does not read them yet`;
    shell.note(`open-files ${String(event.id ?? '')}`, module, outcome);
    void logInfo(`[open] ${outcome}`);
  }
}

export const opener = new Opener();
