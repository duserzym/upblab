import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE_TAG, PROTOCOL_VERSION, type BridgeCommand } from '@lab/bridge';

vi.mock('./platform', () => ({
  isDesktop: false,
  logInfo: vi.fn(async () => {}),
  desktopFiles: {},
  desktopModules: { command: vi.fn(async () => true) },
}));
vi.mock('./identity.svelte', () => ({ identity: {}, SIGN_OUT_EVENTS: [] }));
vi.mock('./opener.svelte', () => ({ opener: { seen: vi.fn() } }));
vi.mock('./shell.svelte', () => ({ shell: {} }));
vi.mock('./settings.svelte', () => ({ settings: {} }));

const platform = await import('./platform');
const { frames, registerFrame, sendCommand, onModuleEvent } = await import('./incoming');
const { selection } = await import('./selection.svelte');
const command: BridgeCommand = { type: 'focus-spot', project: 'p', spot: 's', via: 'review' };

beforeEach(() => {
  frames.clear();
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
    expect(frame.postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ command: latest }), '*');
    registerFrame('images', frame as unknown as Window);
    expect(frame.postMessage).toHaveBeenCalledTimes(1);
  });

  it('holds commands during initial load while keeping the frame known for bridge requests', async () => {
    const frame = { postMessage: vi.fn() };
    registerFrame('images', frame as unknown as Window, false);
    expect(frames.get('images')).toBe(frame);
    expect(await sendCommand('images', command)).toBe(false);
    expect(frame.postMessage).not.toHaveBeenCalled();
    registerFrame('images', frame as unknown as Window);
    expect(frame.postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ command }), '*');
  });

  it('ignores invalid commands without replacing a waiting one', async () => {
    await sendCommand('images', command);
    expect(await sendCommand('images', { ...command, spot: 'bad/id' })).toBe(false);
    const frame = { postMessage: vi.fn() };
    registerFrame('images', frame as unknown as Window);
    expect(frame.postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ command }), '*');
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
