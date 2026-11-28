import { afterEach, expect, it, vi } from 'vitest';
import { compile } from 'svelte/compiler';
import source from '../components/tims/Spikes.svelte?raw';
import { solutions, publishedVersion, labVersion, lab } from '../../tests/fixtures/tims';
import { TimsReadError, type ListPage, type SpikeSolution, type VersionOut, type SpikeDefault } from './tims-api';
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'https://invented.example' }, account: { id: 'invented' }, revision: 1 } }));
import { identity } from './identity.svelte';
import { ReplyScope } from './tims-requests';

// Run the actual compiled component setup/effects, as in spike-picker.test.ts,
// to measure request counts and stale replies without a DOM or a listening port.
const client = await import(/* @vite-ignore */ new URL('../../node_modules/svelte/src/internal/client/index.js', import.meta.url).href);
const { flushSync } = await import(/* @vite-ignore */ new URL('../../node_modules/svelte/src/index-client.js', import.meta.url).href);
const code = compile(source, { filename: 'Spikes.svelte', generate: 'client', dev: true }).js.code;
const setup = code.slice(code.indexOf('export default function Spikes'), code.indexOf('var $$exports')).replace('export default ', '') + `
  $.pop();
  return { choose, load, selectSolution, makeDefault, loadDefault,
    get spikeDefault() { return $.get(spikeDefault); },
    get rows() { return $.get(rows); }, get version() { return $.get(version); },
    get solutionId() { return $.get(solutionId); }, get versionId() { return $.get(versionId); }
  };
}
return Spikes(null, props);`;
const stops: (() => void)[] = [];
afterEach(() => { stops.splice(0).forEach(stop => stop()); });
const page = (items: SpikeSolution[], more = vi.fn()): ListPage<SpikeSolution> => ({ items, nextCursor: null, more });
async function settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); flushSync(); } }
function spikes(items = solutions) {
  const owner = client.state(lab);
  const api = {
    spikes: vi.fn().mockResolvedValue(page(items)),
    version: vi.fn<(id: string) => Promise<VersionOut>>().mockImplementation(async id => id === publishedVersion.id ? publishedVersion : labVersion),
    patchVersion: vi.fn(),
    spikeDefault: vi.fn<(lab: string) => Promise<SpikeDefault>>().mockResolvedValue({ id: null, lab_id: lab, default_spike_solution_id: null, version: publishedVersion, source: 'single_current' }),
  };
  const rights = { canEditLabProtocol: vi.fn(() => true) };
  const action = { send: vi.fn().mockResolvedValue({ id: 'invented-settings', lab_id: lab, default_spike_solution_id: items[0]?.id, version: publishedVersion, source: 'default' }) };
  let instance!: { makeDefault: () => Promise<void>; loadDefault: () => Promise<void>; spikeDefault: SpikeDefault | null; choose: (id: string, owner: string | null, refresh?: boolean) => Promise<void>; load: (more?: boolean) => Promise<void>; selectSolution: (solution: SpikeSolution) => void; rows: SpikeSolution[]; version: VersionOut | null; solutionId: string; versionId: string };
  const destroy: (() => void)[] = [];
  stops.push(client.effect_root(() => {
    instance = new Function('$', 'untrack', 'onDestroy', 'onMount', 'tims', 'identity', 'ReplyScope', 'OnlineAction', 'timsRights', 'TimsReadError', 'outbox', 'props', setup)(client, client.untrack, (fn: () => void) => destroy.push(fn), () => {}, api, identity, ReplyScope, class { send = action.send; }, rights, TimsReadError, { pending: () => [] }, { get lab() { return client.get(owner); } });
  }));
  stops.push(() => destroy.forEach(fn => fn())); flushSync();
  return { instance, api, rights, action, lab: (id: string) => { client.set(owner, id); flushSync(); } };
}
it('selects the first solution and prefers its published current master even when listed last', async () => {
  const solution = { ...solutions[0], subfractions: [...solutions[0].subfractions].reverse() };
  const s = spikes([solution]); await settle();
  expect(s.instance.solutionId).toBe(solution.id);
  expect(s.instance.version?.id).toBe(publishedVersion.id);
  expect(s.api.version).toHaveBeenCalledExactlyOnceWith(publishedVersion.id);
  expect(s.api.patchVersion).not.toHaveBeenCalled();
});
it('falls back to the first current version and handles a solution without any current version', async () => {
  const s = spikes([{ ...solutions[0], subfractions: [solutions[0].subfractions[1]] }]); await settle();
  expect(s.instance.versionId).toBe(labVersion.id);
  s.instance.selectSolution(solutions[1]); await settle();
  expect(s.instance.version).toBeNull(); expect(s.instance.versionId).toBe('');
});
it('reuses loaded and in-flight details and clears the cache on lab changes', async () => {
  const s = spikes(); await settle();
  let finish!: (value: VersionOut) => void;
  s.api.version.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = s.instance.choose(labVersion.id, lab), second = s.instance.choose(labVersion.id, lab);
  expect(s.api.version).toHaveBeenCalledTimes(2);
  await s.instance.choose(publishedVersion.id, null);
  finish(labVersion); await Promise.all([first, second]); await settle();
  expect(s.instance.version?.id).toBe(publishedVersion.id);
  await s.instance.choose(labVersion.id, lab);
  expect(s.instance.version?.id).toBe(labVersion.id); expect(s.api.version).toHaveBeenCalledTimes(2);
  s.lab('another-invented-lab'); await settle();
  expect(s.api.version).toHaveBeenCalledTimes(3); expect(s.instance.version?.id).toBe(publishedVersion.id);
  expect(s.api.patchVersion).not.toHaveBeenCalled();
});
it('does not cache or display an old lab reply in the new scope', async () => {
  const s = spikes(); await settle();
  let finish!: (value: VersionOut) => void;
  s.api.version.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const stale = s.instance.choose(labVersion.id, lab);
  s.lab('another-invented-lab'); await settle();
  finish({ ...labVersion, notes: 'Old scope' }); await stale; await settle();
  expect(s.instance.version?.id).toBe(publishedVersion.id);
  await s.instance.choose(labVersion.id, 'another-invented-lab');
  expect(s.api.version).toHaveBeenCalledTimes(4); expect(s.instance.version?.notes).not.toBe('Old scope');
});
it('publishes thousands of rows with one automatic detail read and pages only on demand', async () => {
  const items = Array.from({ length: 3000 }, (_, i) => ({ ...solutions[0], id: `invented-${i}`, name: `Invented spike ${i}` }));
  const s = spikes(items); await settle();
  expect(s.instance.rows).toHaveLength(3000);
  expect(s.api.spikes).toHaveBeenCalledTimes(1); expect(s.api.version).toHaveBeenCalledTimes(1);
  const next = vi.fn().mockResolvedValue(page([solutions[1]]));
  s.api.spikes.mockResolvedValueOnce({ ...page(items, next), nextCursor: 'invented-next' });
  await s.instance.load(); expect(next).not.toHaveBeenCalled();
  await s.instance.load(true); expect(next).toHaveBeenCalledTimes(1);
  expect(s.instance.rows).toHaveLength(3001); expect(s.api.version).toHaveBeenCalledTimes(1);
  expect(s.api.patchVersion).not.toHaveBeenCalled();
});

it('loads a lab default once and restricts Make default to lab owners', async () => {
  const s = spikes(); await settle();
  expect(s.api.spikeDefault).toHaveBeenCalledExactlyOnceWith(lab);
  s.rights.canEditLabProtocol.mockReturnValue(false);
  await s.instance.makeDefault(); expect(s.action.send).not.toHaveBeenCalled();
  s.rights.canEditLabProtocol.mockReturnValue(true);
  await s.instance.makeDefault();
  expect(s.action.send).toHaveBeenCalledExactlyOnceWith(`/v1/tims/labs/${lab}/spike-default`, 'PUT', { default_spike_solution_id: solutions[0].id });
  expect(s.instance.spikeDefault?.default_spike_solution_id).toBe(solutions[0].id);
});
it('does not apply a default-setting reply after switching labs', async () => {
  const s = spikes(); await settle();
  let finish!: (value: SpikeDefault) => void;
  s.api.spikeDefault.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const stale = s.instance.loadDefault();
  s.lab('another-invented-lab'); await settle();
  finish({ id: 'stale-settings', lab_id: lab, default_spike_solution_id: solutions[0].id, version: publishedVersion, source: 'default' });
  await stale; await settle();
  expect(s.instance.spikeDefault?.id).not.toBe('stale-settings');
  expect(s.api.spikeDefault).toHaveBeenCalledTimes(3);
});
