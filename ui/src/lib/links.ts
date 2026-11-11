// Link resolution (plan section 4.4). Every cross-module action is a URL; the
// shell maps it to a tab and a route. The OS hands the same URLs over when a
// user clicks one in an email or a notebook (deep-link plugin), and modules
// post them through @lab/bridge.
//
//   laicpmsdb://acquisition/<id>          -> Sessions, /app/acquisitions/<id>
//   laicpmsdb://session/<id>              -> Sessions, /app/sessions/<id>
//   laicpmsdb://sample/<id>               -> Sessions, /app/samples/<id>
//   laicpmsdb://mount/<id>                -> Sessions, /app/mounts/<id> (the mount page with its atlas)
//   laicpmsdb://ingest?path=<folder>      -> Sessions, /app/ingest?path=<folder> (desktop: the ingest dialog)
//   laicpmsdb://search?label=<label>      -> Sessions, /app/search?label=<label>
//   laicpmsdb://data-model[/<table>[/<column>]] -> Sessions, /app/data-model[/…] (laicpmsdb's Data Model tab)
//   laicpmsdb://method-code/<CODE>        -> Sessions, /app/method-codes/<CODE> (laicpmsdb's Method Codes tab)
//   grainatlas://project/<id>             -> Images,   /atlas/?project=<id>
//   grainatlas://project/<id>/spot/<id>   -> Images,   /atlas/?project=<id>&spot=<id>
//   upbr://session/<id>?server=&code=     -> launch UPbRPy Studio in database mode (docs/WORKFLOW.md 4)
//   upbr://run/<id>?server=               -> launch Studio on the project of that reduction run
//   laicpmsdb://auth/callback?code=…      -> finish the shell's ORCID or Google sign-in
//   https://… and http://…                -> system browser
//
// Anything else is refused; the caller logs the refusal.

export type TabId = 'home' | 'images' | 'sessions' | 'review' | 'reduce' | 'people';
export type ModuleTab = 'images' | 'sessions' | 'people';

export const SCHEMES = ['laicpmsdb', 'grainatlas', 'upbr'] as const;
export type Scheme = (typeof SCHEMES)[number];

export type Resolution =
  | { kind: 'tab'; tab: ModuleTab; route: string; url: string }
  | { kind: 'studio'; tab: 'reduce'; object: 'session' | 'run'; id: string; url: string }
  | { kind: 'auth'; code: string; url: string }
  | { kind: 'auth-error'; error: string; url: string }
  | { kind: 'external'; url: string }
  | { kind: 'refused'; url: string; reason: string };

/** Object ids are UUIDs in practice; accept any URL-safe slug, nothing that could change the route. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

function refuse(url: string, reason: string): Resolution {
  return { kind: 'refused', url, reason };
}

/** Split `scheme://a/b/c` into ['a','b','c'], tolerating the trailing slash Windows adds. */
function segments(u: URL): string[] {
  // Non-special schemes parse `laicpmsdb://acquisition/x` as host `acquisition`, path `/x`.
  const raw = [u.host, ...u.pathname.split('/')].filter(Boolean);
  return raw.map((s) => decodeURIComponent(s));
}

export function resolve(input: string): Resolution {
  const url = input.trim();
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return refuse(url, 'not a URL');
  }
  const scheme = u.protocol.replace(/:$/, '').toLowerCase();

  if (scheme === 'https' || scheme === 'http') {
    return { kind: 'external', url: u.href };
  }
  if (!(SCHEMES as readonly string[]).includes(scheme)) {
    return refuse(url, `unknown scheme "${scheme}:"`);
  }
  if (u.username || u.password || u.port) return refuse(url, 'credentials or port in link');

  let parts: string[];
  try {
    parts = segments(u);
  } catch {
    return refuse(url, 'malformed escape in link');
  }
  const bad = parts.find((p, i) => i % 2 === 1 && !ID.test(p));
  if (bad !== undefined) return refuse(url, `invalid id "${bad}"`);
  const [kind, id, sub, subId] = parts;

  switch (scheme as Scheme) {
    case 'laicpmsdb': {
      if (kind === 'auth' && id === 'callback' && parts.length === 2) {
        // laicpmsdb returns to `<next>#/auth/callback?code=…`; accept the code there or in the query.
        const hashQuery = u.hash.includes('?') ? u.hash.slice(u.hash.indexOf('?') + 1) : '';
        const params = (name: string) => u.searchParams.get(name) ?? new URLSearchParams(hashQuery).get(name);
        const code = params('code');
        const error = params('error');
        if (!code && error) {
          // laicpmsdb://auth/callback?error=<slug>: the browser sign-in failed.
          return /^[A-Za-z0-9._~-]{1,128}$/.test(error) ? { kind: 'auth-error', error, url } : refuse(url, 'sign-in callback with an invalid error');
        }
        if (!code || !/^[A-Za-z0-9._~-]{1,512}$/.test(code)) return refuse(url, 'sign-in callback without a valid code');
        return { kind: 'auth', code, url };
      }
      // Data model and method code pages: table and column names, and codes, have
      // their own strict shapes (laicpmsdb docs/data_model_and_method_codes.md).
      if (kind === 'data-model' && parts.length <= 3) {
        const names = parts.slice(1);
        if (names.some((p) => !/^[a-z_][a-z0-9_]{0,62}$/.test(p))) return refuse(url, 'invalid table or column name');
        return { kind: 'tab', tab: 'sessions', route: ['/app/data-model', ...names].join('/'), url };
      }
      if (kind === 'method-code' && parts.length === 2) {
        const code = id.toUpperCase();
        if (!/^[A-Z]{2}(-[A-Z0-9]{1,16}){0,3}$/.test(code)) return refuse(url, 'invalid method code');
        return { kind: 'tab', tab: 'sessions', route: `/app/method-codes/${code}`, url };
      }
      const routes: Record<string, string> = {
        acquisition: 'acquisitions',
        session: 'sessions',
        sample: 'samples',
        mount: 'mounts',
      };
      if (parts.length === 2 && kind in routes) {
        const panel = kind === 'session' && u.searchParams.get('panel') === 'sharing' ? '?panel=sharing' : '';
        return { kind: 'tab', tab: 'sessions', route: `/app/${routes[kind]}/${id}${panel}`, url };
      }
      // Query links: only the one known parameter is passed on, re-encoded.
      const queries: Record<string, string> = { ingest: 'path', search: 'label' };
      if (parts.length === 1 && kind in queries) {
        const name = queries[kind];
        const value = u.searchParams.get(name);
        if (!value || value.length > 2048 || /[\u0000-\u001f]/.test(value)) return refuse(url, `${kind} link without a valid ${name}`);
        return { kind: 'tab', tab: 'sessions', route: `/app/${kind}?${name}=${encodeURIComponent(value)}`, url };
      }
      return refuse(url, `unknown laicpmsdb link "${parts.join('/')}"`);
    }
    case 'grainatlas': {
      if (kind === 'project' && parts.length === 2) {
        return { kind: 'tab', tab: 'images', route: `/atlas/?project=${id}`, url };
      }
      if (kind === 'project' && parts.length === 4 && sub === 'spot') {
        return { kind: 'tab', tab: 'images', route: `/atlas/?project=${id}&spot=${subId}`, url };
      }
      return refuse(url, `unknown grainatlas link "${parts.join('/')}"`);
    }
    case 'upbr': {
      if ((kind === 'session' || kind === 'run') && parts.length === 2) {
        return { kind: 'studio', tab: 'reduce', object: kind, id, url };
      }
      return refuse(url, `unknown upbr link "${parts.join('/')}"`);
    }
  }
}

/** Where module builds live for the current delivery. */
export interface ModuleBases {
  /** laicpmsdb server origin (and optional prefix), e.g. `http://localhost:8000`. */
  server: string;
  /** Directory URL of the grainatlas build: `…/modules/grainatlas/` on desktop, `/atlas/` on the web. */
  atlas: string;
  /** The shell's theme, passed to the module as `?theme=` when it loads (ux-conventions rule 1). */
  theme?: 'light' | 'dark';
}

/** Add `?theme=` (or `&theme=`) before any `#` route. */
export function withTheme(url: string, theme: ModuleBases['theme']): string {
  if (!theme) return url;
  const [head, tail = ''] = url.split(/#(.*)/s);
  const query = head.indexOf('?');
  const path = query < 0 ? head : head.slice(0, query);
  const params = new URLSearchParams(query < 0 ? '' : head.slice(query + 1));
  params.set('theme', theme);
  return `${path}?${params}${url.includes('#') ? `#${tail}` : ''}`;
}

function joinBase(base: string, rest: string): string {
  return base.replace(/\/+$/, '') + '/' + rest.replace(/^\/+/, '');
}

/** Entry URL of a module tab with no particular route. */
export function moduleHome(tab: ModuleTab, bases: ModuleBases): string {
  if (tab === 'people') return moduleUrl(tab, '/app/people', bases);
  return withTheme(tab === 'sessions' ? joinBase(bases.server, '/app/') : joinBase(bases.atlas, 'index.html'), bases.theme);
}

/**
 * Turn a logical route from `resolve` into the concrete URL to load.
 * laicpmsdb's UI uses hash routing (its ADR-0004), so `/app/acquisitions/x`
 * becomes `<server>/app/#/acquisitions/x`. grainatlas reads its query string.
 */
export function moduleUrl(tab: ModuleTab, route: string, bases: ModuleBases): string {
  return withTheme(routeUrl(tab, route, bases), bases.theme);
}

function routeUrl(tab: ModuleTab, route: string, bases: ModuleBases): string {
  if (tab === 'sessions' || tab === 'people') {
    const rest = route.replace(/^\/app\/?/, '');
    return joinBase(bases.server, '/app/') + (rest ? `#/${rest}` : '');
  }
  // grainatlas opens a published project from `<server>/atlas/projects/<id>/`
  // when it is not in its recent list (docs/WORKFLOW.md section 6): pass the server.
  const query = route.replace(/^\/atlas\/?/, '');
  if (query.startsWith('?project=') && bases.server) {
    return joinBase(bases.atlas, 'index.html') + `?server=${encodeURIComponent(bases.server)}&` + query.slice(1);
  }
  return joinBase(bases.atlas, 'index.html') + query;
}

/** Normalise a user-entered server URL: scheme required, no trailing slash, no /app suffix. */
export function normaliseServerUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const path = u.pathname.replace(/\/+$/, '').replace(/\/app$/, '');
  return `${u.protocol}//${u.host}${path}`;
}

/** Navigation identity: theme changes are delivered live, without loading the URL again. */
export function withoutTheme(url: string): string {
  const [head, tail = ''] = url.split(/#(.*)/s);
  const query = head.indexOf('?');
  if (query < 0) return url;
  const params = new URLSearchParams(head.slice(query + 1));
  params.delete('theme');
  const search = params.toString();
  return `${head.slice(0, query)}${search ? `?${search}` : ''}${url.includes('#') ? `#${tail}` : ''}`;
}
