import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./app-watch.svelte', () => ({ appWatch: { session: vi.fn() } }));
vi.mock('./review.svelte', () => ({ review: { rows: [], open: vi.fn(async () => {}) } }));
vi.mock('./incoming', () => ({ sendCommand: vi.fn(async () => true) }));
vi.mock('./apps.svelte', () => ({ editInAtlas: vi.fn(async () => {}) }));
vi.mock('./platform', () => ({
  isDesktop: true,
  logWarn: vi.fn(async () => {}),
  logInfo: vi.fn(async () => {}),
  openExternal: vi.fn(async () => {}),
  launchStudio: vi.fn(async () => 'open -n -b org.upbrpy.studio --args --open <url>'),
  studioStatus: vi.fn(async () => ({ found: true, kind: 'installed', path: '/Applications/UPbRPy Studio.app' })),
  desktopAuth: {
    exchange: vi.fn(async () => ({ signedIn: true, account: { username: 'analyst' }, offline: false })),
    handoff: vi.fn(async () => 'ONE-TIME'),
  },
  LOCAL_STATUS_EVENT: 'local-service://status',
  localServiceApi: {},
}));

// The shell reads location.href to place the bundled grainatlas build.
vi.stubGlobal('location', new URL('tauri://localhost/index.html'));

const platform = await import('./platform');
const { shell } = await import('./shell.svelte');
const { settings, DEFAULTS } = await import('./settings.svelte');
const { localService } = await import('./localService.svelte');
const { identity } = await import('./identity.svelte');
const { redact, withHandoff } = await import('./shell.svelte');

const A = '2f1c9a4e-6b1d-4c3e-9f7a-0d8e5b6c7a91';

describe('shell.handleLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settings.serverUrl = 'http://localhost:8000';
    settings.mode = 'server';
    localService.status = null;
    settings.studioPath = '';
    shell.view = 'home';
  });

  it('refuses and logs unknown schemes', async () => {
    expect(await shell.handleLink('javascript:alert(1)', 'grainatlas')).toBe(false);
    expect(platform.logWarn).toHaveBeenCalledWith(expect.stringMatching(/refused "javascript:alert\(1\)" from grainatlas/));
    expect(shell.links[0]).toMatchObject({ refused: true, from: 'grainatlas' });
    expect(shell.view).toBe('home');
  });

  it('loads an Images target without switching away from Review', () => {
    shell.show('review');
    shell.load('images', '/atlas/?project=p&spot=s');
    expect(shell.view).toBe('review');
    expect(shell.targets.images?.url).toContain('project=p&spot=s');
  });

  it('does not persist People as the last workspace tab', () => {
    settings.loaded = true;
    settings.lastTab = 'review';
    const update = vi.spyOn(settings, 'update');
    shell.show('people');
    expect(shell.view).toBe('people');
    expect(settings.lastTab).toBe('review');
    expect(update).not.toHaveBeenCalled();
    update.mockRestore();
    settings.loaded = false;
  });

  it('switches to Sessions with the hash route of an acquisition', async () => {
    expect(await shell.handleLink(`laicpmsdb://acquisition/${A}`, 'os')).toBe(true);
    expect(shell.view).toBe('sessions');
    expect(shell.targets.sessions?.url).toBe(`http://localhost:8000/app/?theme=light#/acquisitions/${A}`);
  });

  it('opens grainatlas links in the standalone app without switching tabs', async () => {
    const { editInAtlas } = await import('./apps.svelte');
    const before = shell.targets.images;
    expect(await shell.handleLink(`grainatlas://project/${A}/spot/${A}`, 'laicpmsdb')).toBe(true);
    expect(editInAtlas).toHaveBeenCalledExactlyOnceWith({ project: A, mount: null, spot: A }, 'laicpmsdb');
    expect(shell.view).toBe('home');
    expect(shell.targets.images).toBe(before);
    await shell.handleLink(`grainatlas://project/${A}`, 'os');
    expect(editInAtlas).toHaveBeenLastCalledWith({ project: A, mount: null, spot: undefined }, 'os');
  });

  it('gives every request a new sequence number so the same link navigates again', async () => {
    await shell.handleLink(`laicpmsdb://session/${A}`, 'os');
    const first = shell.targets.sessions!.seq;
    await shell.handleLink(`laicpmsdb://session/${A}`, 'os');
    expect(shell.targets.sessions!.seq).toBeGreaterThan(first);
  });

  it('sends https links to the system browser', async () => {
    await shell.handleLink('https://example.org/paper', 'laicpmsdb');
    expect(platform.openExternal).toHaveBeenCalledWith('https://example.org/paper');
    expect(shell.view).toBe('home');
  });

  it('keeps the active view when Studio launches while signed out', async () => {
    identity.state = { signedIn: false, account: null, offline: false };
    await shell.handleLink(`upbr://session/${A}`, 'laicpmsdb');
    expect(shell.view).toBe('home');
    expect(platform.desktopAuth.handoff).not.toHaveBeenCalled();
    expect(platform.launchStudio).toHaveBeenCalledWith({ path: '', checkout: '' }, `upbr://session/${A}?server=http%3A%2F%2Flocalhost%3A8000`);
    expect(shell.studio).toMatchObject({ state: 'launched', object: 'session', id: A, minted: false });
  });

  it('mints a handoff code for the shell\'s server when signed in', async () => {
    identity.target = { server: 'http://localhost:8000', key: 'http://localhost:8000' };
    identity.state = { signedIn: true, account: { username: 'analyst' }, offline: false };
    settings.studioCheckout = '/co/UPbRPy';
    await shell.handleLink(`upbr://run/${A}`, 'os');
    expect(platform.launchStudio).toHaveBeenCalledWith(
      { path: '', checkout: '/co/UPbRPy' },
      `upbr://run/${A}?server=http%3A%2F%2Flocalhost%3A8000&code=ONE-TIME`,
    );
    expect(shell.studio).toMatchObject({ state: 'launched', minted: true, shown: expect.stringContaining('code=…') });
    expect(shell.links[0].url).not.toContain('ONE-TIME');
    settings.studioCheckout = '';
  });

  it('shows install instructions and mints nothing when Studio is missing', async () => {
    identity.state = { signedIn: true, account: { username: 'analyst' }, offline: false };
    vi.mocked(platform.studioStatus).mockResolvedValueOnce({ found: false, path: null, error: 'UPbRPy Studio is not installed' });
    expect(await shell.handleLink(`upbr://session/${A}`, 'laicpmsdb')).toBe(true);
    expect(shell.studio).toMatchObject({ state: 'missing' });
    expect(platform.desktopAuth.handoff).not.toHaveBeenCalled();
    expect(platform.launchStudio).not.toHaveBeenCalled();
  });
});

describe('withHandoff', () => {
  const mint = vi.fn(async () => 'C0DE');
  beforeEach(() => mint.mockClear());

  it('keeps a link that already has a code', async () => {
    expect(await withHandoff(`upbr://session/${A}?server=http://h&code=X`, 'http://h', mint)).toEqual({ url: `upbr://session/${A}?server=http://h&code=X`, minted: false });
    expect(mint).not.toHaveBeenCalled();
  });

  it('never mints a code for another server', async () => {
    expect((await withHandoff(`upbr://session/${A}?server=https://other.example`, 'http://h', mint)).minted).toBe(false);
    expect(mint).not.toHaveBeenCalled();
  });

  it('adds server and code; a trailing slash is the same server', async () => {
    expect((await withHandoff(`upbr://session/${A}?server=http://h/`, 'http://h', mint)).url).toBe(`upbr://session/${A}?server=http%3A%2F%2Fh%2F&code=C0DE`);
  });

  it('launches without a code when minting fails', async () => {
    const r = await withHandoff(`upbr://session/${A}`, 'http://h', async () => {
      throw new Error('handoff refused: Not Found');
    });
    expect(r).toMatchObject({ minted: false, error: 'handoff refused: Not Found' });
    expect(r.url).toBe(`upbr://session/${A}?server=http%3A%2F%2Fh`);
  });
});

describe('This computer mode', () => {
  const ready = {
    phase: 'ready' as const,
    step: '',
    url: 'http://127.0.0.1:8001',
    postgres: { running: true, port: 55432, pid: 1, source: 'bundled 17.11.0', version: '17.11.0', path: null },
    service: { running: true, port: 8001, pid: 2, source: 'dev', version: null, path: '/co' },
    error: null,
    logTail: null,
    bundle: null,
    devDefault: '/co',
    logDir: '/logs',
    dataDir: '/pg',
  };

  beforeEach(() => {
    settings.serverUrl = 'https://lab.example.edu';
    settings.mode = 'local';
    localService.status = null;
  });

  it('routes the Sessions tab to the local instance once it is ready', async () => {
    expect(shell.local).toBe(true);
    expect(shell.homeUrl('sessions')).toBe('http://127.0.0.1:8000/app/?theme=light');
    localService.status = ready;
    expect(shell.homeUrl('sessions')).toBe('http://127.0.0.1:8001/app/?theme=light');
    expect(await shell.handleLink(`laicpmsdb://session/${A}`, 'grainatlas')).toBe(true);
    expect(shell.targets.sessions?.url).toBe(`http://127.0.0.1:8001/app/?theme=light#/sessions/${A}`);
  });

  it('uses the server URL in Lab server mode', () => {
    settings.mode = 'server';
    localService.status = ready;
    expect(shell.local).toBe(false);
    expect(shell.homeUrl('sessions')).toBe('https://lab.example.edu/app/?theme=light');
  });
});

describe('shell sign-in callback (laicpmsdb://auth/callback)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settings.mode = 'server';
    settings.serverUrl = 'http://localhost:8000';
    identity.target = { server: 'http://localhost:8000', key: 'http://localhost:8000' };
    identity.state = { signedIn: false, account: null, offline: false };
    identity.pending = null;
  });

  it('refuses a callback nobody asked for (login CSRF)', async () => {
    expect(await shell.handleLink('laicpmsdb://auth/callback?code=evil', 'os')).toBe(false);
    expect(platform.desktopAuth.exchange).not.toHaveBeenCalled();
    expect(shell.links[0]).toMatchObject({ refused: true, url: 'laicpmsdb://auth/callback?code=…' });
  });

  it('refuses callbacks posted by a module', async () => {
    identity.pending = { provider: 'orcid', at: Date.now() };
    expect(await shell.handleLink('laicpmsdb://auth/callback?code=x', 'grainatlas')).toBe(false);
    expect(platform.desktopAuth.exchange).not.toHaveBeenCalled();
  });

  it('exchanges the code of a sign-in the shell started, once', async () => {
    identity.pending = { provider: 'orcid', at: Date.now() };
    const before = identity.revision;
    expect(await shell.handleLink('laicpmsdb://auth/callback#/auth/callback?code=abc', 'os')).toBe(true);
    expect(platform.desktopAuth.exchange).toHaveBeenCalledWith(identity.target, 'abc');
    expect(identity.signedIn).toBe(true);
    expect(identity.revision).toBe(before + 1);
    expect(await shell.handleLink('laicpmsdb://auth/callback?code=again', 'os')).toBe(false);
  });

  it('shows a failed browser sign-in and ends the wait', async () => {
    identity.pending = { provider: 'orcid', at: Date.now() };
    expect(await shell.handleLink('laicpmsdb://auth/callback?error=orcid_access_denied', 'os')).toBe(false);
    expect(identity.pending).toBeNull();
    expect(identity.dialog).toBe(true);
    expect(identity.error).toMatch(/cancelled/);
    expect(platform.desktopAuth.exchange).not.toHaveBeenCalled();
    identity.dialog = false;
  });

  it('redacts one-time codes', () => {
    expect(redact('upbr://session/x?server=http://h&code=s3cret')).toBe('upbr://session/x?server=http://h&code=…');
    expect(redact('laicpmsdb://auth/callback#/auth/callback?code=s3cret')).toBe('laicpmsdb://auth/callback#/auth/callback?code=…');
  });
});

describe('theme (System by default, passed to module tabs at load and live)', () => {
  it('defaults to System and resolves it from the OS', () => {
    expect(DEFAULTS.theme).toBe('system');
    settings.theme = 'system';
    settings.systemDark = true;
    expect(settings.effectiveTheme).toBe('dark');
    settings.systemDark = false;
    expect(settings.effectiveTheme).toBe('light');
    settings.theme = 'dark';
    settings.mode = 'server';
    settings.serverUrl = 'http://localhost:8000';
    expect(shell.homeUrl('sessions')).toBe('http://localhost:8000/app/?theme=dark');
    expect(shell.homeUrl('images')).toBe('tauri://localhost/modules/grainatlas/index.html?theme=dark');
    settings.theme = 'light';
  });
});

describe('tab switching', () => {
  it('switches at once, with no leave guard', async () => {
    shell.view = 'review';
    const switching = shell.show('home');
    expect(shell.view).toBe('home');
    expect(await switching).toBe(true);
  });
});


describe('in-context Studio and submission routing', () => {
  beforeEach(() => { vi.clearAllMocks(); settings.loaded = false; shell.view = 'review'; });
  it('keeps Review for missing Studio and failed launches, but sends other callers to Reduce', async () => {
    vi.mocked(platform.studioStatus).mockResolvedValueOnce({ found: false, path: null, error: 'Missing' });
    await shell.handleLink('upbr://session/s?via=upblab', 'review');
    expect(shell.view).toBe('review');
    expect(shell.studio).toMatchObject({ state: 'missing', from: 'review' });
    vi.mocked(platform.launchStudio).mockRejectedValueOnce(new Error('Failed'));
    await shell.handleLink('upbr://session/s?via=upblab', 'review');
    expect(shell.view).toBe('review');
    expect(shell.studio?.state).toBe('failed');
    vi.mocked(platform.studioStatus).mockResolvedValueOnce({ found: false, path: null });
    await shell.handleLink('upbr://session/s', 'home');
    expect(shell.view).toBe('reduce');
  });
  it('looks up a submitted run and records the link', async () => {
    const get = vi.spyOn(identity, 'get').mockResolvedValueOnce({ status: 200, body: { session_id: 's' } });
    const { review } = await import('./review.svelte');
    expect(await shell.handleLink('laicpmsdb://run/r', 'os')).toBe(true);
    expect(get).toHaveBeenCalledWith('/v1/runs/r');
    expect(review.open).toHaveBeenCalledWith({ kind: 'session', id: 's', run: 'r' });
    expect(shell.links[0]).toMatchObject({ url: 'laicpmsdb://run/r', outcome: 'Review run r' });
    get.mockRestore();
  });
  it('records the successful session opener and watches it', async () => {
    const { appWatch } = await import('./app-watch.svelte');
    const update = vi.spyOn(settings, 'update').mockResolvedValueOnce();
    await shell.handleLink('upbr://session/s?acquisition=a&via=upblab', 'review');
    expect(shell.view).toBe('review');
    expect(update).toHaveBeenCalledWith({ studioOpened: expect.objectContaining({ s: expect.stringMatching(/^\d{4}-/) }) });
    expect(appWatch.session).toHaveBeenCalledWith('s');
    update.mockRestore();
  });
});

it('shows web Studio guidance inline for Review and in Reduce for Home', async () => {
  vi.resetModules();
  vi.doMock('./platform', () => ({ ...platform, isDesktop: false }));
  const { shell: webShell } = await import('./shell.svelte');
  webShell.view = 'review';
  await webShell.handleLink('upbr://session/web-session?acquisition=a&via=upblab', 'review');
  expect(webShell.view).toBe('review');
  expect(webShell.studio).toMatchObject({ state: 'web', from: 'review', href: expect.stringContaining('acquisition=a&via=upblab') });
  await webShell.handleLink('upbr://session/web-session?via=upblab', 'home');
  expect(webShell.view).toBe('reduce');
});
