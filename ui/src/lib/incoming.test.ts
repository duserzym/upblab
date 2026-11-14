import { beforeEach, describe, expect, it, vi } from 'vitest';
import { atlasStatusFixture } from '../../tests/fixtures/atlas-sync';
import { atlasSync } from './atlas-sync.svelte';
import { MESSAGE_TAG, PROTOCOL_VERSION, type BridgeCommand } from '@lab/bridge';

vi.mock('./platform', () => ({
  isDesktop: false,
  logInfo: vi.fn(async () => {}),
  desktopFiles: {},
  desktopModules: { command: vi.fn(async () => true) },
}));
vi.mock('./identity.svelte', () => ({ identity: {}, SIGN_OUT_EVENTS: [] }));
vi.mock('./opener.svelte', () => ({ opener: { seen: vi.fn(), outcome: vi.fn() } }));
vi.mock('./shell.svelte', () => ({ shell: {} }));
vi.mock('./settings.svelte', () => ({ settings: { reviewSplit: false } }));
vi.mock('./spot-actions', () => ({ dispatchSpotAction: vi.fn(async () => {}) }));

const platform = await import('./platform');
const { opener } = await import('./opener.svelte');
const { frames, registerFrame, sendCommand, onModuleEvent, moduleReady, publishImagesPresentation } = await import('./incoming');
const { shell } = await import('./shell.svelte');
const { settings } = await import('./settings.svelte');
const { dispatchSpotAction } = await import('./spot-actions');
const { selection } = await import('./selection.svelte');
const command: BridgeCommand = { type: 'focus-spot', project: 'p', spot: 's', via: 'review' };
const types = (frame: { postMessage: ReturnType<typeof vi.fn> }) => frame.postMessage.mock.calls.map(call => call[0].command.type);

beforeEach(() => {
  atlasSync.v4 = false;
  atlasSync.status = null;
  frames.clear();
  shell.view = 'home';
  settings.reviewSplit = false;
  selection.fromImages = null;
  vi.clearAllMocks();
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
    expect(other.postMessage).not.toHaveBeenCalled();
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
    expect(opener.seen).toHaveBeenCalledWith('laicpmsdb', seen);
  });

  it('names People notifications as laicpmsdb', () => {
    onModuleEvent({ type: 'lab.people.changed' }, 'people');
    expect(platform.logInfo).toHaveBeenCalledWith('[bridge] laicpmsdb: {"type":"lab.people.changed"}');
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
  it('reapplies on each frame load and native ready, without replacing a queued focus', async () => {
    shell.view = 'review'; settings.reviewSplit = true;
    await sendCommand('images', command);
    await publishImagesPresentation();
    const frame = { postMessage: vi.fn() };
    registerFrame('images', frame as unknown as Window);
    expect(frame.postMessage.mock.calls.map(call => call[0].command.type)).toEqual(['focus-spot', 'set-presentation']);
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
