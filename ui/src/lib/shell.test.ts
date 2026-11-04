import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./platform', () => ({
  isDesktop: true,
  logWarn: vi.fn(async () => {}),
  logInfo: vi.fn(async () => {}),
  openExternal: vi.fn(async () => {}),
  launchStudio: vi.fn(async () => {}),
  desktopAuth: {
    exchange: vi.fn(async () => ({ signedIn: true, account: { username: 'analyst' }, offline: false })),
  },
  LOCAL_STATUS_EVENT: 'local-service://status',
  localServiceApi: {},
}));

// The shell reads location.href to place the bundled grainatlas build.
vi.stubGlobal('location', new URL('tauri://localhost/index.html'));

const platform = await import('./platform');
const { shell } = await import('./shell.svelte');
const { settings } = await import('./settings.svelte');
const { localService } = await import('./localService.svelte');
const { identity } = await import('./identity.svelte');
const { redact } = await import('./shell.svelte');

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

  it('switches to Sessions with the hash route of an acquisition', async () => {
    expect(await shell.handleLink(`laicpmsdb://acquisition/${A}`, 'os')).toBe(true);
    expect(shell.view).toBe('sessions');
    expect(shell.targets.sessions?.url).toBe(`http://localhost:8000/app/#/acquisitions/${A}`);
  });

  it('switches to Images with the bundled build', async () => {
    await shell.handleLink(`grainatlas://project/${A}/spot/${A}`, 'laicpmsdb');
    expect(shell.view).toBe('images');
    expect(shell.targets.images?.url).toBe(
      `tauri://localhost/modules/grainatlas/index.html?project=${A}&spot=${A}`,
    );
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

  it('opens Reduce for upbr links and launches Studio when configured', async () => {
    await shell.handleLink(`upbr://session/${A}`, 'laicpmsdb');
    expect(shell.view).toBe('reduce');
    expect(platform.launchStudio).not.toHaveBeenCalled();
    settings.studioPath = '/Applications/UPbRPy Studio.app';
    await shell.handleLink(`upbr://session/${A}`, 'laicpmsdb');
    expect(platform.launchStudio).toHaveBeenCalledWith('/Applications/UPbRPy Studio.app', `upbr://session/${A}`);
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
    expect(shell.homeUrl('sessions')).toBe('http://127.0.0.1:8000/app/');
    localService.status = ready;
    expect(shell.homeUrl('sessions')).toBe('http://127.0.0.1:8001/app/');
    expect(await shell.handleLink(`laicpmsdb://session/${A}`, 'grainatlas')).toBe(true);
    expect(shell.targets.sessions?.url).toBe(`http://127.0.0.1:8001/app/#/sessions/${A}`);
  });

  it('uses the server URL in Lab server mode', () => {
    settings.mode = 'server';
    localService.status = ready;
    expect(shell.local).toBe(false);
    expect(shell.homeUrl('sessions')).toBe('https://lab.example.edu/app/');
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

  it('redacts one-time codes', () => {
    expect(redact('upbr://session/x?server=http://h&code=s3cret')).toBe('upbr://session/x?server=http://h&code=…');
    expect(redact('laicpmsdb://auth/callback#/auth/callback?code=s3cret')).toBe('laicpmsdb://auth/callback#/auth/callback?code=…');
  });
});
