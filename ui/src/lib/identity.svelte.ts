// One identity (plan decision 5): the shell signs in to laicpmsdb once and
// gives the bearer token to the module tabs through @lab/bridge `token()`.
//
//   desktop  the token lives in the OS keychain and in Rust (src-tauri/src/auth.rs);
//            this page only learns the account. Password sign-in posts to
//            /v1/auth/login; ORCID and Google open the system browser at
//            /v1/auth/<provider>/start?next=laicpmsdb://auth/callback, and the
//            OS hands the callback back to the shell, which exchanges the
//            one-time code at /v1/auth/exchange.
//   web      (/desk/, same origin as laicpmsdb) the token is kept in this
//            tab's sessionStorage and handed to module iframes by the frame host.
//
// Module tabs reload when the account changes (`revision`), so they pick up
// the new token, or their own sign-in screen after a sign-out.

import { SHELL_EVENTS } from '@lab/bridge';
import {
  desktopAuth,
  isDesktop,
  logInfo,
  logWarn,
  openExternal,
  type Account,
  type ApiReply,
  type AuthState,
  type AuthTarget,
} from './platform';

/** Where laicpmsdb sends the browser back to after ORCID or Google. */
export const CALLBACK_URL = 'laicpmsdb://auth/callback';

/** A module's `notify()` of one of these signs the shell out. */
export const SIGN_OUT_EVENTS: readonly string[] = [SHELL_EVENTS.signedOut, 'laicpmsdb.auth.signed-out'];

/** How long a browser sign-in may take before its callback is refused. */
const PENDING_MS = 10 * 60_000;

export type Provider = 'orcid' | 'google';

export interface Providers {
  password_registration: boolean;
  orcid: boolean;
  google: boolean;
  google_domains: string[];
}

interface Backend {
  restore(t: AuthTarget): Promise<AuthState>;
  login(t: AuthTarget, username: string, password: string): Promise<AuthState>;
  exchange(t: AuthTarget, code: string): Promise<AuthState>;
  logout(t: AuthTarget): Promise<AuthState>;
  handoff(t: AuthTarget): Promise<string>;
  get<T>(t: AuthTarget, path: string): Promise<ApiReply<T>>;
  /** Web only: the token for module iframes. */
  token(t: AuthTarget): string | null;
}

const SIGNED_OUT: AuthState = { signedIn: false, account: null, offline: false };

function endpoint(t: AuthTarget, path: string): string {
  return t.server.replace(/\/+$/, '') + path;
}

const storageKey = (t: AuthTarget) => `upbstudio.token:${t.key}`;

function readToken(t: AuthTarget): string | null {
  try {
    return sessionStorage.getItem(storageKey(t));
  } catch {
    return null;
  }
}

function writeToken(t: AuthTarget, token: string | null) {
  try {
    if (token) sessionStorage.setItem(storageKey(t), token);
    else sessionStorage.removeItem(storageKey(t));
  } catch {
    /* storage blocked: the sign-in lasts for this page only */
  }
}

async function json(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function detail(body: unknown, status: number): string {
  const d = (body as { detail?: unknown } | null)?.detail;
  return typeof d === 'string' ? d : `HTTP ${status}`;
}

const memory = new Map<string, string>();

/** Web delivery: fetch from the shell page, same origin as laicpmsdb at /desk/. */
const webBackend: Backend = {
  async restore(t) {
    const token = readToken(t) ?? memory.get(t.key) ?? null;
    if (!token) return SIGNED_OUT;
    try {
      const res = await fetch(endpoint(t, '/v1/accounts/me'), { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        writeToken(t, null);
        return { ...SIGNED_OUT, error: 'Your sign-in expired; please sign in again' };
      }
      if (!res.ok) return { signedIn: true, account: null, offline: true, error: `HTTP ${res.status}` };
      return { signedIn: true, account: (await res.json()) as Account, offline: false };
    } catch (err) {
      return { signedIn: true, account: null, offline: true, error: String(err) };
    }
  },
  async login(t, username, password) {
    return adopt(t, await fetch(endpoint(t, '/v1/auth/login'), post({ username, password })));
  },
  async exchange(t, code) {
    return adopt(t, await fetch(endpoint(t, '/v1/auth/exchange'), post({ code })));
  },
  async logout(t) {
    const token = readToken(t);
    writeToken(t, null);
    memory.delete(t.key);
    if (token) {
      await fetch(endpoint(t, '/v1/auth/logout'), { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
    return SIGNED_OUT;
  },
  async handoff(t) {
    const token = readToken(t);
    if (!token) throw new Error('not signed in');
    const req = post({});
    req.headers.Authorization = `Bearer ${token}`;
    const res = await fetch(endpoint(t, '/v1/auth/handoff'), req);
    const body = (await json(res)) as { code?: string } | null;
    if (!res.ok || !body?.code) throw new Error(`handoff refused: ${detail(body, res.status)}`);
    return body.code;
  },
  async get<T>(t: AuthTarget, path: string) {
    const token = readToken(t);
    const res = await fetch(endpoint(t, path), {
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    return { status: res.status, body: (await json(res)) as T };
  },
  token: (t) => readToken(t) ?? memory.get(t.key) ?? null,
};

function post(body: unknown): RequestInit & { headers: Record<string, string> } {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function adopt(t: AuthTarget, res: Response): Promise<AuthState> {
  const body = (await json(res)) as { token?: string; account?: Account } | null;
  if (!res.ok || !body?.token) throw new Error(detail(body, res.status));
  writeToken(t, body.token);
  memory.set(t.key, body.token);
  return { signedIn: true, account: body.account ?? null, offline: false };
}

const desktopBackend: Backend = { ...desktopAuth, token: () => null };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

class Identity {
  state = $state<AuthState>(SIGNED_OUT);
  /** The server the shell currently signs in to; null until known. */
  target = $state<AuthTarget | null>(null);
  checking = $state(false);
  /** The sign-in / account dialog is open. */
  dialog = $state(false);
  /** Last sign-in problem, for the dialog. */
  error = $state('');
  /** A browser sign-in the shell started, waiting for its callback. */
  pending = $state<{ provider: Provider; at: number } | null>(null);
  /** Bumped whenever the account changes; module tabs reload on it. */
  revision = $state(0);
  private backend: Backend = isDesktop ? desktopBackend : webBackend;
  private restoring: string | null = null;

  get signedIn(): boolean {
    return this.state.signedIn;
  }

  get account(): Account | null {
    return this.state.account;
  }

  /** What the tab bar shows. */
  get label(): string {
    const a = this.state.account;
    if (a) return a.display_name || a.username;
    return this.state.signedIn ? 'Signed in' : '';
  }

  private changed(next: AuthState) {
    const before = this.state;
    this.state = next;
    const who = (s: AuthState) => (s.signedIn ? (s.account?.username ?? '?') : '');
    if (before.signedIn !== next.signedIn || (next.account && who(before) !== who(next))) this.revision += 1;
  }

  /** Read the stored sign-in for `target` (called when the server changes). */
  async restore(target: AuthTarget) {
    const id = `${target.key} ${target.server}`;
    if (this.restoring === id) return;
    this.restoring = id;
    const switched = this.target?.key !== target.key || this.target?.server !== target.server;
    this.target = target;
    this.checking = true;
    try {
      const next = await this.backend.restore(target);
      if (this.restoring !== id) return; // superseded
      if (switched) this.state = SIGNED_OUT;
      this.changed(next);
      if (next.error && !next.signedIn) this.error = next.error;
    } catch (err) {
      await logWarn(`[identity] restore failed: ${message(err)}`);
    } finally {
      if (this.restoring === id) this.restoring = null;
      this.checking = false;
    }
  }

  /** Password sign-in. `target` defaults to the current server (the wizard passes the new local one). */
  async login(username: string, password: string, target: AuthTarget | null = this.target): Promise<boolean> {
    if (!target) {
      this.error = 'No laicpmsdb server is configured yet.';
      return false;
    }
    this.error = '';
    try {
      const next = await this.backend.login(target, username.trim(), password);
      this.target = target;
      this.changed(next);
      await logInfo(`[identity] signed in to ${target.server} as ${next.account?.username ?? username.trim()}`);
      return true;
    } catch (err) {
      this.error = message(err);
      return false;
    }
  }

  /** Which sign-in methods the server offers (GET /v1/auth/providers, no auth). */
  async providers(): Promise<Providers | null> {
    if (!this.target) return null;
    try {
      const r = await this.backend.get<Providers>(this.target, '/v1/auth/providers');
      return r.status === 200 ? r.body : null;
    } catch {
      return null;
    }
  }

  /** ORCID or Google: the system browser, back through laicpmsdb://auth/callback. */
  async beginProvider(provider: Provider) {
    if (!this.target) return;
    this.error = '';
    const url = `${endpoint(this.target, `/v1/auth/${provider}/start`)}?next=${encodeURIComponent(CALLBACK_URL)}`;
    this.pending = { provider, at: Date.now() };
    await openExternal(url);
  }

  /**
   * The OS handed us laicpmsdb://auth/callback?code=…. Only a sign-in this
   * shell started is completed, so a link from elsewhere cannot sign the
   * user in to someone else's account.
   */
  async completeProvider(code: string, from: string): Promise<{ ok: boolean; outcome: string }> {
    const pending = this.pending;
    if (from !== 'os' && from !== 'you') return { ok: false, outcome: `sign-in callbacks are only accepted from the OS, not ${from}` };
    if (!pending || Date.now() - pending.at > PENDING_MS) return { ok: false, outcome: 'no browser sign-in was started here' };
    if (!this.target) return { ok: false, outcome: 'no server configured' };
    this.pending = null;
    try {
      const next = await this.backend.exchange(this.target, code);
      this.changed(next);
      this.error = '';
      this.dialog = false;
      return { ok: true, outcome: `signed in with ${pending.provider === 'orcid' ? 'ORCID' : 'Google'} as ${next.account?.username ?? '?'}` };
    } catch (err) {
      this.error = message(err);
      this.dialog = true;
      return { ok: false, outcome: `sign-in failed: ${this.error}` };
    }
  }

  async logout(reason = 'you') {
    if (!this.target) return;
    try {
      this.changed(await this.backend.logout(this.target));
      await logInfo(`[identity] signed out of ${this.target.server} (${reason})`);
    } catch (err) {
      await logWarn(`[identity] sign-out failed: ${message(err)}`);
    }
  }

  /** A one-time code for UPbRPy Studio (POST /v1/auth/handoff); null when signed out. */
  async handoff(): Promise<string | null> {
    if (!this.target || !this.state.signedIn) return null;
    return this.backend.handoff(this.target);
  }

  /** GET a laicpmsdb read endpoint as the signed-in account. */
  async get<T>(path: string): Promise<ApiReply<T>> {
    if (!this.target) throw new Error('No laicpmsdb server is configured yet.');
    return this.backend.get<T>(this.target, path);
  }

  /** Web delivery: what the frame host gives module iframes for `token()`. */
  frameToken(): string | null {
    return this.target && this.state.signedIn ? this.backend.token(this.target) : null;
  }
}

export const identity = new Identity();
