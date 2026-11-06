import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, scan, offer, projectPackage } = vi.hoisted(() => ({ get: vi.fn(), scan: vi.fn(), offer: vi.fn(), projectPackage: vi.fn() }));
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'http://lab', key: 'lab' }, revision: 1, get } }));
vi.mock('./platform', () => ({ desktopFiles: { scan, offer, projectPackage }, isDesktop: true, logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock('./shell.svelte', () => ({ shell: { show: vi.fn(), go: vi.fn(), handleLink: vi.fn(), note: vi.fn() } }));
const { Upload, POLL_MS, WATCH_MS } = await import('./upload.svelte');
const { opener } = await import('./opener.svelte');
const { shell } = await import('./shell.svelte');
const { identity } = await import('./identity.svelte');
let cards: InstanceType<typeof Upload>[];
const card = (target: 'sessions' | 'images') => { const c = new Upload(target); cards.push(c); return c; };
const session = { id: 's-new', session_key: 'Qtegra_demo', material: 'zircon', started_at: null, acquisition_count: 2 };
const csv = { roots: [{ name: 'Qtegra_demo.csv', dir: false }], entries: [{ root: 0, rel: 'Qtegra_demo.csv', size: 1024 }], files: [new File(['x'], 'Qtegra_demo.csv')] };
const image = { roots: [{ name: 'SEM', dir: true }], entries: [{ root: 0, rel: 'a.jpg', size: 2048 }], files: [new File(['xx'], 'a.jpg')] };
let nextId: number;

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); cards = []; nextId = 0;
  identity.revision = 1;
  get.mockResolvedValue({ status: 200, body: [] });
  offer.mockImplementation(async () => ({ id: `o${++nextId}` }));
  projectPackage.mockResolvedValue(null);
});
afterEach(() => { cards.forEach(c => c.dispose()); vi.clearAllTimers(); vi.useRealTimers(); });

describe('Home upload handoffs', () => {
  it('lists, sends and observes files taken (including the web tab name)', async () => {
    const c = card('sessions');
    await c.openWebFiles(csv);
    expect(c.steps.slice(0, 3).map(s => s.done)).toEqual([true, true, false]);
    const t = opener.takeWeb('sessions', true)!;
    expect(t).not.toBeNull();
    expect(c.taken).toEqual({ files: 1, bytes: 1 });
    expect(c.steps[2].text).toBe('Taken by laicpmsdb (1 files, 0.00 MB)');
    expect(c.ready).toBe(false);
  });

  it('refuses the wrong kind before offering or routing, on web and desktop', async () => {
    const c = card('sessions');
    await c.openWebFiles(image);
    expect(c.error).toContain('This button takes a Rich CSV');
    expect(opener.takeWeb('laicpmsdb', true)).toBeNull();
    expect(shell.show).not.toHaveBeenCalled();
    scan.mockResolvedValue({ scan: 'scan', ...image, missing: [], truncated: false });
    await c.openPaths(['/SEM']);
    expect(c.error).toContain('This button takes a Rich CSV');
    expect(offer).not.toHaveBeenCalled();
    const images = card('images');
    await images.openWebFiles(csv);
    expect(images.error).toContain('SEM package folder');
  });

  it('handles a desktop take arriving before the offer command returns', async () => {
    scan.mockResolvedValue({ scan: 'scan', ...csv, missing: [], truncated: false });
    offer.mockImplementation(async () => {
      opener.taken('instant', 'laicpmsdb', 1, 1024);
      return { id: 'instant' };
    });
    const c = card('sessions');
    await c.openPaths(['/Qtegra_demo.csv']);
    expect(c.taken).toEqual({ files: 1, bytes: 1024 });
  });

  it('keeps snapshot failures visible without offering files', async () => {
    get.mockResolvedValue({ status: 401, body: { detail: 'Sign in again' } });
    const c = card('sessions');
    await c.openPaths(['/Qtegra_demo.csv']);
    expect(c.error).toContain('Sign in again');
    expect(scan).not.toHaveBeenCalled();
    expect(offer).not.toHaveBeenCalled();
  });

  it('detects a session from the second sessions reply and gates Review on a completed run', async () => {
    const old = { ...session, id: 's-old', session_key: 'previous' };
    let replies = 0;
    let completed = false;
    get.mockImplementation(async (path: string) => ({ status: 200, body: path === '/v1/sessions'
      ? (++replies === 1 ? [old] : [session, old])
      : completed ? [{ id: 'run-1', status: 'completed' }] : [{ id: 'running', status: 'running' }] }));
    const c = card('sessions');
    await c.openWebFiles(csv);
    expect(replies).toBe(1);
    opener.takeWeb('laicpmsdb', true);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(c.session?.id).toBe('s-new');
    expect(c.outcome).toBe('Session Qtegra_demo ingested, 2 acquisitions');
    expect(c.ready).toBe(false);
    completed = true;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(c.ready).toBe(true);
    expect(c.completeRun).toBe('run-1');
    expect(replies).toBe(2); // Only reductions need watching after detection.
  });

  it('recognises an existing session by the uploaded CSV stem', async () => {
    get.mockResolvedValue({ status: 200, body: [session] });
    const c = card('sessions');
    await c.openWebFiles(csv);
    opener.takeWeb('laicpmsdb', true);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(c.session?.id).toBe(session.id);
  });

  it('shows the module outcome, ignores other sets and sources, and offers mounts without polling', async () => {
    get.mockResolvedValue({ status: 200, body: [{ id: 'm1', label: 'Demo mount' }] });
    const c = card('images');
    await c.openWebFiles(image);
    opener.takeWeb('grainatlas', true);
    opener.outcome('laicpmsdb', { name: 'SEM', outcome: 'opened: wrong source' });
    opener.outcome('grainatlas', { name: 'other', outcome: 'opened: another set' });
    expect(c.imageOpened).toBe(false);
    opener.outcome('grainatlas', { name: 'SEM', outcome: 'asked: scale' });
    expect(c.outcome).toBe('asked: scale');
    opener.outcome('grainatlas', { name: 'SEM', outcome: 'opened: package, 1 area(s)' });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.mounts[0].id).toBe('m1');
    expect(c.ready).toBe(false);
    c.mountId = 'm1';
    expect(c.ready).toBe(true);
    const calls = get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(get).toHaveBeenCalledTimes(calls);
  });

  it('matches a notified project id to a mount current atlas', async () => {
    get.mockImplementation(async (path: string) => ({ status: 200, body: path === '/v1/mounts'
      ? [{ id: 'm1', label: 'One' }, { id: 'm2', label: 'Two' }]
      : { current: { project_id: path.includes('m2') ? 'p2' : 'p1' } } }));
    const c = card('images');
    await c.openWebFiles(image);
    opener.outcome('grainatlas', { name: 'SEM', outcome: 'opened: package', project: 'p2' });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.mountId).toBe('m2');
  });

  it.each(['waiting', 'timeout'])('offers the project first and the package after %s', async mode => {
    projectPackage.mockResolvedValue({ name: 'SEM', path: '/SEM', exists: true });
    scan.mockImplementation(async (paths: string[]) => ({ scan: 'scan', roots: [{ path: paths[0], name: paths[0].slice(1), dir: true }], entries: [{ root: 0, rel: paths[0].endsWith('.grainatlas') ? 'project.json' : 'a.jpg', size: 20 }], missing: [], truncated: false }));
    const c = card('images');
    await c.openPaths(['/demo.grainatlas']);
    expect(offer.mock.calls.map(([a]) => a.kind)).toEqual(['project']);
    if (mode === 'waiting') opener.outcome('grainatlas', { name: 'demo.grainatlas', outcome: 'waiting: package SEM' });
    await vi.advanceTimersByTimeAsync(mode === 'waiting' ? 0 : 10_000);
    expect(offer.mock.calls.map(([a]) => a.kind)).toEqual(['project', 'area']);
    expect(scan.mock.calls.map(([paths]) => paths)).toEqual([['/demo.grainatlas'], ['/SEM']]);
    opener.outcome('grainatlas', { name: 'demo.grainatlas', outcome: 'opened: project SEM' });
    expect(c.imageOpened).toBe(true);
  });

  it('keeps failures visible and stops watching when dismissed or the account changes', async () => {
    const c = card('images');
    await c.openWebFiles(image);
    opener.outcome('grainatlas', { name: 'SEM', outcome: 'failed: invalid project' });
    expect(c.error).toContain('invalid project');
    const s = card('sessions');
    await s.openWebFiles(csv);
    opener.takeWeb('laicpmsdb', true);
    s.close();
    const calls = get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(get).toHaveBeenCalledTimes(calls);
    identity.revision++;
    c.syncIdentity();
    expect(c.open).toBe(false);
  });

  it('stops after ten minutes with a visible reason', async () => {
    const c = card('sessions');
    await c.openWebFiles(csv);
    opener.takeWeb('laicpmsdb', true);
    await vi.advanceTimersByTimeAsync(WATCH_MS);
    expect(c.error).toContain('No session detected after 10 minutes');
    const calls = get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(get).toHaveBeenCalledTimes(calls);
  });
});
