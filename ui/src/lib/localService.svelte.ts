// "This computer" mode (ADR-0003): the shell page's view of the laicpmsdb
// service and PostgreSQL that the desktop host runs on this machine.
// Status arrives as `local-service://status` events from Rust.

import { isDesktop, LOCAL_STATUS_EVENT, localServiceApi, type LocalStartConfig, type LocalStatus } from './platform';
import { DEFAULT_DATA_ROOT, settings } from './settings.svelte';

const SETTLED: LocalStatus['phase'][] = ['ready', 'failed', 'stopped'];

class LocalService {
  status = $state<LocalStatus | null>(null);
  private listening = false;
  private waiters: ((s: LocalStatus) => void)[] = [];

  async init() {
    if (!isDesktop || this.listening) return;
    this.listening = true;
    const { listen } = await import('@tauri-apps/api/event');
    await listen<LocalStatus>(LOCAL_STATUS_EVENT, (e) => {
      this.status = e.payload;
      if (SETTLED.includes(e.payload.phase)) {
        const waiting = this.waiters;
        this.waiters = [];
        for (const resolve of waiting) resolve(e.payload);
      }
    });
    try {
      this.status = await localServiceApi.status();
    } catch (err) {
      console.warn('[local-service] status unavailable', err);
    }
  }

  /** The URL the Sessions tab uses once the service is healthy. */
  get url(): string | null {
    return this.status?.phase === 'ready' ? this.status.url : null;
  }

  /** Development builds know the checkout pinned in modules.lock.json. */
  get devPath(): string {
    return settings.devServicePath || this.status?.devDefault || '';
  }

  /** Can "This computer" run here: a bundled service, or a checkout to run? */
  get available(): boolean {
    return isDesktop && !!(this.status?.bundle || this.devPath);
  }

  config(overrides: Partial<LocalStartConfig> = {}): LocalStartConfig {
    return {
      dataRoot: settings.dataRoot || DEFAULT_DATA_ROOT,
      devPath: this.status?.bundle ? null : this.devPath || null,
      pgBin: settings.pgBin || null,
      ...overrides,
    };
  }

  async start(overrides: Partial<LocalStartConfig> = {}) {
    if (!isDesktop) return;
    // Optimistic; the host re-emits the real status straight away.
    if (this.status && this.status.phase !== 'ready') this.status = { ...this.status, phase: 'starting', error: null, logTail: null };
    await localServiceApi.start(this.config(overrides));
  }

  /**
   * Start and resolve with the next settled status (ready, failed or
   * stopped). The host emits one even when it was already running.
   */
  startAndWait(overrides: Partial<LocalStartConfig> = {}): Promise<LocalStatus> {
    const settled = new Promise<LocalStatus>((resolve) => this.waiters.push(resolve));
    return this.start(overrides).then(() => settled);
  }

  async stop() {
    if (!isDesktop) return;
    this.status = await localServiceApi.stop();
  }

  async restart() {
    await this.stop();
    await this.start();
  }
}

export const localService = new LocalService();
