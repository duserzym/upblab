import { connectivity } from './connectivity.svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { atlasStatusFixture } from '../../tests/fixtures/atlas-sync';
import { atlasSync } from './atlas-sync.svelte';
import { MESSAGE_TAG, PROTOCOL_VERSION, type BridgeCommand } from '@lab/bridge';

vi.mock('./review.svelte', () => ({ review: { showRegion: vi.fn(async () => {}) } }));
vi.mock('./platform', () => ({
  isDesktop: false,
  logInfo: vi.fn(async () => {}),
  desktopFiles: {},
  desktopModules: { command: vi.fn(async () => true) },
}));
vi.mock('./identity.svelte', () => ({ identity: {}, SIGN_OUT_EVENTS: [] }));
vi.mock('./opener.svelte', () => ({ opener: { seen: vi.fn(), outcome: vi.fn() } }));
vi.mock('./shell.svelte', () => ({ shell: {} }));
vi.mock('./settings.svelte', () => ({ settings: { reviewSplit: false, loaded: true, reviewInset: null, update: vi.fn(async () => {}) } }));
vi.mock('./spot-actions', () => ({ dispatchSpotAction: vi.fn(async () => {}) }));

const platform = await import('./platform');
const { opener } = await import('./opener.svelte');
const { frames, registerFrame, sendCommand, onModuleEvent, moduleReady, publishImagesPresentation, publishOversight, unregisterFrame } = await import('./incoming');
const { oversight } = await import('./oversight.svelte');
const { shell } = await import('./shell.svelte');
const { settings } = await import('./settings.svelte');
const { dispatchSpotAction } = await import('./spot-actions');
const { selection } = await import('./selection.svelte');
const command: BridgeCommand = { type: 'focus-spot', project: 'p', spot: 's', via: 'review' };
const types = (frame: { postMessage: ReturnType<typeof vi.fn> }) => frame.postMessage.mock.calls.filter(call => call[0].push === 'command').map(call => call[0].command.type);

beforeEach(() => {
  connectivity.reset();
  atlasSync.v4 = false;
  atlasSync.status = null;
  frames.clear();
  shell.view = 'home';
  settings.reviewSplit = false;
  settings.reviewInset = null;
  selection.fromImages = null;
  vi.clearAllMocks();
  oversight.reset();
});

it('posts cloneable oversight snapshots on module load, scope change and reload', () => {
  const delivered: unknown[] = [];
  const frame = { postMessage: vi.fn(message => { delivered.push(structuredClone(message)); }) };
  registerFrame('sessions', frame as unknown as Window);
  oversight.select({ username: 'cedar', name: 'Cedar Analyst' }); publishOversight();
  const state = { viewAs: { username: 'cedar', name: 'Cedar Analyst' }, onBehalf: false };
  expect(delivered.at(-1)).toMatchObject({ push: 'oversight', oversight: state });
  expect(structuredClone(oversight.state)).toEqual(state); // The frame host's oversight read uses this too.
  registerFrame('sessions', frame as unknown as Window);
  expect(delivered.at(-1)).toMatchObject({ push: 'oversight', oversight: state });
  oversight.select(null); publishOversight();
  expect(delivered.at(-1)).toMatchObject({ push: 'oversight', oversight: { viewAs: null, onBehalf: false } });
  unregisterFrame('sessions');
});

describe('sendCommand', () => {
  it('posts a command to the existing frame', async () => {
    const frame = { postMessage: vi.fn() };
    frames.set('images', frame as unknown as Window);
    expect(await sendCommand('images', command)).toBe(true);
    expect(frame.postMessage).toHaveBeenCalledExactlyOnceWith({
      tag: MESSAGE_TAG, v: PROTOCOL_VERSION, push: 'command', command,
    }, '*');
    expect(platform.desktopModules.command).not.toHaveBeenCalled();
  });

  it('returns false without a frame and pushes only the newest command on its next load', async () => {
    const latest: BridgeCommand = { type: 'focus-grain', project: 'p', grain: 'a/2' };
    expect(await sendCommand('images', command)).toBe(false);
    expect(await sendCommand('images', latest)).toBe(false);
    const other = { postMessage: vi.fn() };
    registerFrame('sessions', other as unknown as Window);
    expect(other.postMessage).toHaveBeenCalledWith(expect.objectContaining({ push: 'oversight' }), '*');
    const frame = { postMessage: vi.fn() };
    registerFrame('images', frame as unknown as Window);
    expect(types(frame)).toEqual(['focus-grain', 'set-presentation']);
    expect(frame.postMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ command: latest }), '*');
    registerFrame('images', frame as unknown as Window);
    expect(types(frame)).toEqual(['focus-grain', 'set-presentation', 'set-presentation']);
  });

  it('holds commands during initial load while keeping the frame known for bridge requests', async () => {
    const frame = { postMessage: vi.fn() };
    registerFrame('images', frame as unknown as Window, false);
    expect(frames.get('images')).toBe(frame);
    expect(await sendCommand('images', command)).toBe(false);
    expect(frame.postMessage).not.toHaveBeenCalled();
    registerFrame('images', frame as unknown as Window);
    expect(types(frame)).toEqual(['focus-spot', 'set-presentation']);
    expect(frame.postMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ command }), '*');
  });

  it('ignores invalid commands without replacing a waiting one', async () => {
    await sendCommand('images', command);
    expect(await sendCommand('images', { ...command, spot: 'bad/id' })).toBe(false);
    const frame = { postMessage: vi.fn() };
    registerFrame('images', frame as unknown as Window);
    expect(types(frame)).toEqual(['focus-spot', 'set-presentation']);
    expect(frame.postMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ command }), '*');
  });

  it('refuses editor commands to the images module, even after v4', async () => {
    onModuleEvent(atlasStatusFixture, 'images');
    const frame = { postMessage: vi.fn() };
    frames.set('images', frame as unknown as Window);
    for (const refused of [
      { type: 'set-mode', project: 'p', mode: 'edit' },
      { type: 'leave-edit', project: 'p', decision: 'sync' },
      { type: 'sync-draft', project: 'p' },
      { type: 'discard-draft', project: 'p' },
      { type: 'set-presentation', presentation: 'editor' },
      { type: 'open-project', project: 'p', mode: 'edit' },
    ] as BridgeCommand[]) expect(await sendCommand('images', refused)).toBe(false);
    expect(frame.postMessage).not.toHaveBeenCalled();
    expect(await sendCommand('images', { type: 'open-project', project: 'p', mode: 'view' })).toBe(true);
    expect(await sendCommand('images', { type: 'set-presentation', presentation: 'viewer' })).toBe(true);
    expect(types(frame)).toEqual(['open-project', 'set-presentation']);
  });
});

it('keeps copy server URLs in direct and previously queued Images commands', async () => {
  const command: BridgeCommand = { type: 'focus-spot', project: 'p', spot: 's', server: 'https://copy.invalid' };
  await sendCommand('images', command);
  connectivity.offlineCopy = 'invented copy';
  const frame = { postMessage: vi.fn() };
  registerFrame('images', frame as unknown as Window);
  expect(frame.postMessage.mock.calls[0][0].command).toEqual(command);
  await sendCommand('images', command);
  expect(frame.postMessage.mock.calls.at(-1)![0].command).toEqual(command);
});

describe('module selections', () => {
  it('stores current selections with shell provenance and a timestamp', () => {
    const at = Date.now();
    onModuleEvent({ type: 'lab.spot.selected', project: 'p', spot: 's', grain: 'a/2', via: 'shell' }, 'grainatlas');
    expect(selection.fromImages).toMatchObject({ type: 'lab.spot.selected', project: 'p', spot: 's', grain: 'a/2', via: 'shell' });
    expect(selection.fromImages!.at).toBeGreaterThanOrEqual(at);
  });

  it('normalises legacy selections and ignores invalid or unrelated events', () => {
    onModuleEvent({ type: 'grainatlas.spot.selected', project: 'p', spot: 's', name: 'spot 1' }, 'images');
    const selected = selection.fromImages;
    expect(selected).toMatchObject({ type: 'lab.spot.selected', name: 'spot 1', via: 'user' });
    onModuleEvent({ type: 'other' }, 'images');
    onModuleEvent({ type: 'lab.spot.selected', project: 'p', spot: 'bad/id' }, 'images');
    expect(selection.fromImages).toBe(selected);
  });
});

describe('module upload outcomes', () => {
  it('forwards probe receipts with the canonical module name and ignores hosted image outcomes', () => {
    const opened = { type: 'grainatlas.files.opened', name: 'SEM', outcome: 'opened: package' };
    onModuleEvent(opened, 'images');
    expect(opener.outcome).not.toHaveBeenCalled();
    const seen = { type: 'lab.open-files.seen', id: 'o1', files: 2, bytes: 1024 };
    onModuleEvent(seen, 'sessions');
    expect(opener.seen).toHaveBeenCalledWith('upbdb', seen);
  });

  it('names People notifications as UPbDB', () => {
    onModuleEvent({ type: 'lab.people.changed' }, 'people');
    expect(platform.logInfo).toHaveBeenCalledWith('[bridge] upbdb: {"type":"lab.people.changed"}');
  });
});

describe('Atlas adoption', () => {
  it('accepts snapshots only from Images, with both source labels', () => {
    onModuleEvent(atlasStatusFixture, 'sessions');
    onModuleEvent(atlasStatusFixture, 'unknown');
    onModuleEvent({ type: 'lab.atlas.status' }, 'images');
    expect(atlasSync.v4).toBe(false);
    onModuleEvent(atlasStatusFixture, 'grainatlas');
    expect(atlasSync.status).toEqual(atlasStatusFixture);
    atlasSync.status = null;
    onModuleEvent(atlasStatusFixture, 'images');
    expect(atlasSync.status).toEqual(atlasStatusFixture);
  });
  it('never queues v4 commands until a valid Images v4 event', async () => {
    const frame = { postMessage: vi.fn() };
    registerFrame('images', frame as unknown as Window);
    frame.postMessage.mockClear();
    expect(await sendCommand('images', { type: 'report-status' })).toBe(false);
    expect(frame.postMessage).not.toHaveBeenCalled();
    onModuleEvent(atlasStatusFixture, 'images');
    frame.postMessage.mockClear();
    expect(await sendCommand('images', { type: 'report-status' })).toBe(true);
    expect(types(frame)).toEqual(['report-status']);
  });
});

describe('Images presentation delivery', () => {
  it('carries the remembered inset (v5.1) and stores the viewer\'s inset reports', async () => {
    const frame = { postMessage: vi.fn() };
    registerFrame('images', frame as unknown as Window);
    settings.reviewInset = { width: 240, collapsed: true };
    await publishImagesPresentation();
    expect(frame.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ command: { type: 'set-presentation', presentation: 'viewer', inset: { width: 240, collapsed: true } } }), '*');
    frame.postMessage.mockClear();
    onModuleEvent({ type: 'lab.viewer.inset', width: 300, collapsed: false }, 'images');
    expect(settings.update).toHaveBeenCalledExactlyOnceWith({ reviewInset: { width: 300, collapsed: false } });
    expect(frame.postMessage).not.toHaveBeenCalled();
    onModuleEvent({ type: 'lab.viewer.inset', width: 20, collapsed: false }, 'images');
    onModuleEvent({ type: 'lab.viewer.inset', width: 300, collapsed: false }, 'sessions');
    expect(settings.update).toHaveBeenCalledOnce();
  });
  it('reapplies on each frame load and native ready, without replacing a queued focus', async () => {
    shell.view = 'review'; settings.reviewSplit = true;
    await sendCommand('images', command);
    await publishImagesPresentation();
    const frame = { postMessage: vi.fn() };
    registerFrame('images', frame as unknown as Window);
    expect(frame.postMessage.mock.calls.filter(call => call[0].push === 'command').map(call => call[0].command.type)).toEqual(['focus-spot', 'set-presentation']);
    expect(frame.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ command: { type: 'set-presentation', presentation: 'viewer' } }), '*');
    frame.postMessage.mockClear();
    moduleReady('images');
    expect(frame.postMessage).toHaveBeenCalledOnce();
    shell.view = 'home'; settings.reviewSplit = false;
    await publishImagesPresentation();
    expect(frame.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ command: { type: 'set-presentation', presentation: 'viewer' } }), '*');
  });
  it('reapplies once on valid status readiness, preventing status feedback loops', () => {
    shell.view = 'review'; settings.reviewSplit = true;
    const frame = { postMessage: vi.fn() };
    registerFrame('images', frame as unknown as Window);
    frame.postMessage.mockClear();
    onModuleEvent(atlasStatusFixture, 'sessions');
    onModuleEvent({ type: 'lab.atlas.status' }, 'images');
    expect(frame.postMessage).not.toHaveBeenCalled();
    onModuleEvent(atlasStatusFixture, 'images');
    expect(frame.postMessage).toHaveBeenCalledOnce();
    onModuleEvent(atlasStatusFixture, 'images');
    expect(frame.postMessage).toHaveBeenCalledOnce();
  });
  it('dispatches notifications from Images through the validated action handler', () => {
    const action = { type: 'lab.spot.action', action: 'edit', project: 'p', spot: 's' };
    onModuleEvent(action, 'sessions');
    expect(dispatchSpotAction).not.toHaveBeenCalled();
    onModuleEvent(action, 'images');
    expect(dispatchSpotAction).toHaveBeenCalledWith(action, 'grainatlas');
  });
});

const { review } = await import('./review.svelte');
describe('viewer regions', () => {
  const region = { type: 'lab.viewer.region', kind: 'sample', project: 'p', mount: 'm', mountLabel: 'Demo',
    area: 'a', areaLabel: 'Area A', sample: 'Sample A', spots: ['s'] };
  it('accepts a validated images event while the split Review is active', () => {
    shell.view = 'review'; settings.reviewSplit = true;
    onModuleEvent(region, 'images');
    expect(review.showRegion).toHaveBeenCalledExactlyOnceWith(region, 'images');
  });
  it('ignores malformed events and events from other modules', () => {
    shell.view = 'review'; settings.reviewSplit = true;
    onModuleEvent({ ...region, spots: [1] }, 'images');
    onModuleEvent(region, 'sessions');
    expect(review.showRegion).not.toHaveBeenCalled();
  });
  it('ignores inactive Review and solo Review', () => {
    shell.view = 'home'; settings.reviewSplit = true;
    onModuleEvent(region, 'images');
    shell.view = 'review'; settings.reviewSplit = false;
    onModuleEvent(region, 'images');
    expect(review.showRegion).not.toHaveBeenCalled();
  });
});
