import { afterEach, expect, it, vi } from 'vitest';
import { compile } from 'svelte/compiler';
import source from '../components/tims/SpikePicker.svelte?raw';
import { spikeVersionName } from './tims-display';
import { solutions, version } from '../../tests/fixtures/tims';
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'https://invented.example' }, account: { id: 'invented' }, revision: 1 } }));
import { ReplyScope } from './tims-requests';
import { identity } from './identity.svelte';

// Run the component's actual compiled setup/effects with the client runtime in Node.
// No DOM or browser is needed to reproduce list loss during a parent prop update.
const runtimePath = new URL('../../node_modules/svelte/src/internal/client/index.js', import.meta.url).href;
const sveltePath = new URL('../../node_modules/svelte/src/index-client.js', import.meta.url).href;
const client = await import(/* @vite-ignore */ runtimePath);
const { flushSync } = await import(/* @vite-ignore */ sveltePath);
const code = compile(source, { filename: 'SpikePicker.svelte', generate: 'client', dev: true }).js.code;
const setup = code.slice(code.indexOf('export default function SpikePicker'), code.indexOf('var $$exports')).replace('export default ', '') + `
  $.pop();
  return { load, get solutions() { return $.get(solutions); }, get selectedName() { return $.get(selectedName); } };
}
return SpikePicker(null, props);`;
const stops: (() => void)[] = [];
afterEach(() => { stops.splice(0).forEach(stop => stop()); });
function picker(initialValue = '', knownVersions = {}) {
  const selected = client.state(initialValue), lab = client.state('synthetic-lab');
  const api = { spikes: vi.fn(), version: vi.fn().mockResolvedValue(version) };
  const props = { get value() { return client.get(selected); }, get lab() { return client.get(lab); }, knownVersions, onchange: vi.fn() };
  let instance!: { load: () => Promise<void>; solutions: typeof solutions; selectedName: string };
  const destroy: (() => void)[] = [];
  stops.push(client.effect_root(() => {
    instance = new Function('$', 'untrack', 'onDestroy', 'tims', 'identity', 'ReplyScope', 'spikeVersionName', 'props', setup)(client, client.untrack, (fn: () => void) => destroy.push(fn), api, identity, ReplyScope, spikeVersionName, props);
  }));
  stops.push(() => destroy.forEach(fn => fn()));
  flushSync();
  return { instance, api, select: (id: string) => { client.set(selected, id); flushSync(); }, lab: (id: string) => { client.set(lab, id); flushSync(); } };
}
it('keeps a successful solution reply when the parent updates its selected version, including while loading', async () => {
  const p = picker();
  let finish!: (page: unknown) => void;
  p.api.spikes.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const loading = p.instance.load();
  p.select(version.id);
  finish({ items: solutions, nextCursor: null }); await loading; flushSync();
  expect(p.instance.solutions).toEqual(solutions);
  expect(p.instance.selectedName).toBe('Synthetic spike · Master · v1 (superseded)');
  p.select(''); expect(p.instance.solutions).toEqual(solutions);
  expect(p.api.spikes).toHaveBeenCalledTimes(1);
});
it('clears the catalogue and rejects an old reply when the lab changes', async () => {
  const p = picker();
  let finish!: (page: unknown) => void;
  p.api.spikes.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const loading = p.instance.load(); p.lab('another-invented-lab');
  finish({ items: solutions, nextCursor: null }); await loading; flushSync();
  expect(p.instance.solutions).toEqual([]);
});
it('uses the batch version details without another read, or one version read when they are absent', async () => {
  const known = picker(version.id, { [version.id]: version });
  expect(known.instance.selectedName).toBe('Synthetic spike · Master · v1 (superseded)');
  expect(known.api.version).not.toHaveBeenCalled();
  const missing = picker(version.id);
  await Promise.resolve(); flushSync();
  expect(missing.api.version).toHaveBeenCalledExactlyOnceWith(version.id);
  expect(missing.instance.selectedName).toBe('Synthetic spike · Master · v1 (superseded)');
});
