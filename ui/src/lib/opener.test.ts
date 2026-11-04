import { beforeEach, describe, expect, it, vi } from 'vitest';

const scans: Record<string, unknown> = {};
vi.mock('./platform', () => ({
  isDesktop: true,
  logWarn: vi.fn(async () => {}),
  logInfo: vi.fn(async () => {}),
  openExternal: vi.fn(async () => {}),
  launchStudio: vi.fn(),
  studioStatus: vi.fn(),
  desktopAuth: {},
  LOCAL_STATUS_EVENT: 'local-service://status',
  localServiceApi: {},
  desktopFiles: {
    scan: vi.fn(async (paths: string[]) => scans[paths.join('|')] ?? { scan: 's0', roots: [], entries: [], truncated: false, missing: paths }),
    offer: vi.fn(async (a: { files: unknown[] }) => ({ id: 'o1', files: a.files.length, bytes: 0, nudged: true })),
    takeOpened: vi.fn(async () => []),
  },
}));
vi.stubGlobal('location', new URL('tauri://localhost/index.html'));

const platform = await import('./platform');
const { opener, TAKE_TIMEOUT_MS } = await import('./opener.svelte');
const { shell } = await import('./shell.svelte');
const { settings } = await import('./settings.svelte');

const PKG = '/Users/lab/grainatlas/tests/fixtures/tm4000/Mount_XS_150X';
const QTEGRA = '/Users/lab/laicpmsdb/tests/fixtures/qtegra/Apatite_demo';
scans[PKG] = {
  scan: 's1',
  roots: [{ path: PKG, name: 'Mount_XS_150X', dir: true }],
  entries: [
    { root: 0, rel: '001_HJ-GC1/001_HJ-GC1_0000.jpg', size: 2000 },
    { root: 0, rel: '001_HJ-GC1/001_HJ-GC1_0000.txt', size: 100 },
    { root: 0, rel: 'Mount_XS_150X.zag', size: 50 },
  ],
  truncated: false,
  missing: [],
};
scans[QTEGRA] = {
  scan: 's2',
  roots: [{ path: QTEGRA, name: 'Apatite_demo', dir: true }],
  entries: [
    { root: 0, rel: 'Apatite_demo_1.csv', size: 100 },
    { root: 0, rel: 'Apatite_demo_10.csv', size: 100 },
  ],
  truncated: false,
  missing: [],
};

describe('opener (desktop)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settings.serverUrl = 'http://localhost:8000';
    settings.mode = 'server';
    shell.view = 'home';
    shell.targets = { images: null, sessions: null };
  });

  it('a TM4000 package goes to Images and is offered to grainatlas, never asking', async () => {
    const r = await opener.openPaths([PKG], 'drop');
    expect(r.target).toBe('images');
    expect(shell.view).toBe('images');
    expect(shell.targets.images).toBeNull(); // grainatlas keeps its page; the files come through the bridge
    expect(platform.desktopFiles.offer).toHaveBeenCalledWith({
      scan: 's1',
      module: 'images',
      files: [
        { index: 0, path: '001_HJ-GC1/001_HJ-GC1_0000.jpg' },
        { index: 1, path: '001_HJ-GC1/001_HJ-GC1_0000.txt' },
        { index: 2, path: 'Mount_XS_150X.zag' },
      ],
      kind: 'package',
      name: 'Mount_XS_150X',
      path: PKG,
      nudge: true,
    });
    expect(shell.links[0].outcome).toMatch(/Images: TM4000 package Mount_XS_150X, 3 files .* handed to grainatlas/);
    expect(opener.status?.state).toBe('offered');
  });

  it('a .zag opened from the Finder opens its package', async () => {
    await opener.openPaths([`${PKG}/Mount_XS_150X.zag`], 'os');
    expect(platform.desktopFiles.scan).toHaveBeenCalledWith([PKG]);
    expect(shell.view).toBe('images');
  });

  it('a Qtegra export opens ingest in Sessions with its path', async () => {
    const r = await opener.openPaths([QTEGRA], 'drop on grainatlas');
    expect(r.target).toBe('sessions');
    expect(shell.view).toBe('sessions');
    expect(shell.targets.sessions?.url).toMatch(new RegExp(`^http://localhost:8000/app/(\\?theme=\\w+)?#/ingest\\?path=${encodeURIComponent(QTEGRA)}$`));
    const offer = vi.mocked(platform.desktopFiles.offer).mock.calls[0][0];
    expect(offer).toMatchObject({ module: 'sessions', kind: 'export', name: 'Apatite_demo', nudge: false });
  });

  it('says when nothing can be opened', async () => {
    const r = await opener.openPaths(['/nope'], 'drop');
    expect(r.target).toBeNull();
    expect(shell.view).toBe('home');
    expect(shell.links[0].refused).toBe(true);
    expect(shell.links[0].outcome).toMatch(/could not read \/nope/);
  });

  it('records when the module takes the files, or that it does not read them yet', async () => {
    vi.useFakeTimers();
    await opener.openPaths([PKG], 'drop');
    opener.taken('o1', 'grainatlas', 3, 2150);
    expect(opener.status?.state).toBe('taken');
    expect(shell.links[0].outcome).toBe('grainatlas took 3 files (2.1 KB)');

    await opener.openPaths([PKG], 'drop');
    vi.advanceTimersByTime(TAKE_TIMEOUT_MS + 1);
    expect(shell.links[0].outcome).toMatch(/grainatlas has not taken the files: it does not read open-files/);
    vi.useRealTimers();
  });
});

describe('opener (web delivery)', () => {
  it('holds the Files for the module and hands them over once', async () => {
    const push = vi.fn();
    opener.pushFrame = push;
    const set = {
      roots: [{ name: 'a.jpg', dir: false }],
      entries: [{ root: 0, rel: 'a.jpg', size: 1 }],
      files: [new File(['x'], 'a.jpg')],
    };
    const r = opener.openWebFiles(set, 'drop');
    expect(r.target).toBe('images');
    expect(push).toHaveBeenCalledWith('images');
    expect(opener.takeWeb('laicpmsdb', true)).toBeNull();
    expect(opener.takeWeb('grainatlas', false)?.files[0].path).toBe('a.jpg');
    const t = opener.takeWeb('grainatlas', true);
    expect(t?.kind).toBe('images');
    expect(await t?.files[0].file.text()).toBe('x');
    expect(opener.takeWeb('grainatlas', true)).toBeNull();
  });
});
