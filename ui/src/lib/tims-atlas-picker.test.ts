import { afterEach, expect, it, vi } from 'vitest';
import { compile } from 'svelte/compiler';
import source from '../components/tims/AtlasPicker.svelte?raw';
import type { PickerMount } from './tims-spot-finder';
import type { GrainChoice } from './tims-spot-search';
import { grainSources, missingSpotSources } from './tims-capsule-import';
import { mountSpotIndex } from './tims-spot-finder';
import * as context from './tims-picker-context';
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'https://picker.example' }, account: { id: 'invented' }, revision: 1, get: vi.fn(), write: vi.fn() } }));
vi.mock('./tims-rights.svelte', () => ({ timsRights: { recordReason: () => '', reject: vi.fn() } }));
vi.mock('./outbox.svelte', () => ({ outbox: {}, onlineOnlyReason: () => '' }));
import { identity } from './identity.svelte';
import { firstPage } from './tims-api';
import { OnlineAction, ReplyScope } from './tims-requests';

// Exercise actual component effects and assignment callbacks without a DOM or port.
const client = await import(/* @vite-ignore */ new URL('../../node_modules/svelte/src/internal/client/index.js', import.meta.url).href);
const { flushSync } = await import(/* @vite-ignore */ new URL('../../node_modules/svelte/src/index-client.js', import.meta.url).href);
const code = compile(source, { filename: 'AtlasPicker.svelte', generate: 'client', dev: true }).js.code;
const setup = code.slice(code.indexOf('export default function AtlasPicker'), code.indexOf('var $$exports')).replace('export default ', '') + `
  $.pop();
  return { loadMounts, openMount, select, save,
    search(value, sample) { $.set(grainQuery, value); $.set(sampleFilter, sample); },
    get mounts() { return $.get(mounts); },
    get context() { return { mount: $.get(mountId), sample: $.get(sampleFilter), search: $.get(grainQuery) }; }
  };
}
return AtlasPicker(null, props);`;
const stops: (() => void)[] = [];
let batchNumber = 0;
afterEach(() => { stops.splice(0).forEach(stop => stop()); vi.resetAllMocks(); });
async function settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); flushSync(); } }
const viewer = { server: 'https://picker.example', account: 'invented' };
function picker() {
  const batch = `batch-${++batchNumber}`, owner = client.state({ id: batch, lab_id: 'invented-lab' });
  const changed = () => { client.set(owner, { ...client.get(owner) }); flushSync(); };
  const assigned = vi.fn(() => { const saved = context.loadPickerContext(viewer, batch); changed(); return saved; });
  const destroy: (() => void)[] = [];
  let instance!: {
    loadMounts: () => Promise<void>; openMount: (id: string) => Promise<void>;
    select: (choice: GrainChoice) => void; save: () => Promise<void>;
    search: (value: string, sample: string) => void; mounts: PickerMount[];
    context: { mount: string; sample: string; search: string };
  };
  stops.push(client.effect_root(() => {
    instance = new Function('$', 'untrack', 'onDestroy', 'identity', 'ReplyScope', 'OnlineAction', 'firstPage', 'onlineOnlyReason',
      'mountElements', 'grainSources', 'missingSpotSources', 'mountSpotIndex', ...Object.keys(context), 'props', setup)(
      client, client.untrack, (fn: () => void) => destroy.push(fn), identity, ReplyScope, OnlineAction, firstPage, () => '',
      async () => ({ grains: [], spots: [], current_project_uuid: null }), grainSources, missingSpotSources, mountSpotIndex, ...Object.values(context),
      { get batch() { return client.get(owner).id; }, get lab() { return client.get(owner).lab_id; }, position: 3, editable: true, oncreated: assigned });
  }));
  stops.push(() => destroy.forEach(fn => fn())); flushSync();
  return { instance, changed, assigned, batch };
}
it('requests one mount page across parent updates, including while that page is in flight', async () => {
  const rows = Array.from({ length: 5000 }, (_, i) => ({ id: `mount-${i}`, label: `Invented ${i}`, atlas: null }));
  let finish!: (value: never) => void;
  vi.mocked(identity.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const start = performance.now(), p = picker();
  p.changed(); await p.instance.loadMounts();
  expect(identity.get).toHaveBeenCalledExactlyOnceWith('/v1/mounts?limit=50');
  finish({ status: 200, body: rows } as never); await settle();
  p.changed(); await settle();
  expect(p.instance.mounts).toHaveLength(5000);
  console.info(`TIMS picker parent updates / 5000 mocked mounts: ${vi.mocked(identity.get).mock.calls.length} list requests, no detail requests, ${(performance.now() - start).toFixed(2)} ms.`);
  expect(identity.get).toHaveBeenCalledTimes(1);
});
it('clears any typed grain search before notifying the parent and carries the cleared context', async () => {
  const mount = { id: 'mount-invented', label: 'Invented mount', atlas: null };
  vi.mocked(identity.get).mockResolvedValue({ status: 200, body: [mount] });
  vi.mocked(identity.write).mockResolvedValue({ status: 200, body: { id: 'fraction-invented' } });
  const p = picker(); await settle();
  await p.instance.openMount(mount.id);
  p.instance.search('Demo-12', 'Synthetic-A');
  p.instance.select({ grain: { id: 'grain-atlas', server_id: 'grain-invented', sample: 'Synthetic-A', polygon_um: null }, spots: [] });
  await settle(); await p.instance.save(); await settle();
  expect(p.assigned).toHaveBeenCalledOnce();
  expect(p.assigned.mock.results[0].value).toEqual({ mount, sample: 'Synthetic-A', search: '' });
  expect(p.instance.context).toEqual({ mount: mount.id, sample: 'Synthetic-A', search: '' });
  expect(context.loadPickerContext(viewer, p.batch)).toEqual({ mount, sample: 'Synthetic-A', search: '' });
  expect(identity.get).toHaveBeenCalledTimes(1);
});
