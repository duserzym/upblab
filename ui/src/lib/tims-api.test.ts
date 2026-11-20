import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./identity.svelte', () => ({ identity: { get: vi.fn(), write: vi.fn() } }));
vi.mock('./tims-rights.svelte', () => ({ timsRights: { recordReason: () => '', reject: vi.fn() } }));
vi.mock('./outbox.svelte', () => ({ outbox: { enqueue: vi.fn() }, onlineOnlyReason: vi.fn(() => '') }));
import { identity } from './identity.svelte';
import { outbox, onlineOnlyReason } from './outbox.svelte';
import { oversight, READ_ONLY_REASON } from './oversight.svelte';
import { capsuleLabel, firstPage, formatParameter, mineralWords, mountFractions, onlineForm, statusWords, tims } from './tims-api';
import { timsFraction } from '../../tests/fixtures/review';
beforeEach(() => { vi.clearAllMocks(); oversight.reset(); vi.mocked(onlineOnlyReason).mockReturnValue(''); vi.mocked(identity.get).mockResolvedValue({ status: 200, body: [] }); vi.mocked(identity.write).mockResolvedValue({ status: 200, body: { id: 'synthetic' } }); });
it('returns the first page immediately, retains filters and treats the cursor as opaque data', async () => {
  vi.mocked(identity.get).mockResolvedValueOnce({ status: 200, body: [timsFraction], nextCursor: 'https://other.example/?x=1&after=evil' }).mockResolvedValueOnce({ status: 200, body: [] });
  const page = await firstPage('/v1/fractions', { mount: 'synthetic', after: 'ignored' });
  expect(identity.get).toHaveBeenCalledTimes(1); expect(page.items).toEqual([timsFraction]);
  const [next, duplicate] = await Promise.all([page.more(), page.more()]); expect(next).toBe(duplicate);
  const url = new URL(vi.mocked(identity.get).mock.calls[1][0], 'https://synthetic.example');
  expect(url.origin).toBe('https://synthetic.example'); expect(url.searchParams.get('after')).toBe(page.nextCursor); expect(url.searchParams.get('mount')).toBe('synthetic');
  expect(await next!.more()).toBeNull(); expect(identity.get).toHaveBeenCalledTimes(2);
});
it('pages 5000 invented fractions over ten bounded reads, publishes progressively, and bounds oversized scopes', async () => {
  const fractions = Array.from({ length: 5000 }, (_, i) => ({ ...timsFraction, id: `synthetic-${i}` }));
  const pages = Array.from({ length: 10 }, (_, i) => fractions.slice(i * 500, (i + 1) * 500));
  vi.mocked(identity.get).mockImplementation(async path => {
    const after = new URL(path, 'https://synthetic.example').searchParams.get('after');
    const i = after ? Number(after) : 0; return { status: 200, body: pages[i], nextCursor: i < 9 ? String(i + 1) : undefined } as never;
  });
  const progress = vi.fn(); const start = performance.now();
  const result = await mountFractions('synthetic-mount', 10_000, progress);
  expect(result.items).toHaveLength(5000); expect(result.truncated).toBe(false); expect(identity.get).toHaveBeenCalledTimes(10);
  expect(progress.mock.calls.map(([v]) => v.items.length)).toEqual(Array.from({ length: 10 }, (_, i) => (i + 1) * 500));
  expect(vi.mocked(identity.get).mock.calls.every(([path]) => new URL(path, 'https://synthetic.example').searchParams.get('limit') === '500')).toBe(true);
  console.info(`TIMS 5000 fractions: 10 requests, ${(performance.now() - start).toFixed(1)} ms (mock network). Existing scope previously made 0 TIMS requests.`);
  vi.mocked(identity.get).mockClear(); const bounded = await mountFractions('synthetic-mount', 2500);
  expect(bounded.items).toHaveLength(2500); expect(bounded.showing).toBe('Showing first 2500 fractions'); expect(bounded.truncated).toBe(true); expect(identity.get).toHaveBeenCalledTimes(5);
});
it('refuses cursor cycles and retains status and server sentence for reads', async () => {
  vi.mocked(identity.get).mockResolvedValue({ status: 200, body: [], nextCursor: 'repeat' });
  await expect(mountFractions('synthetic')).rejects.toThrow('repeated a list cursor');
  vi.mocked(identity.get).mockResolvedValue({ status: 403, body: { detail: 'Synthetic permission refused.' } });
  await expect(tims.batch('batch')).rejects.toThrow('403'); await expect(tims.batch('batch')).rejects.toThrow('Synthetic permission refused.');
});
it('routes every list and detail through the identity cache with bounded pages', async () => {
  await tims.fractions({ sample: 's' }); await tims.grainFractions('g'); await tims.grainFractions('g', true); await tims.spotFractions('s'); await tims.spotFractions('s', true);
  await tims.capsuleSets(); await tims.recipes(); await tims.batches(); await tims.spikes(); await tims.history('fraction', 'f');
  expect(vi.mocked(identity.get).mock.calls.map(([p]) => p)).toEqual(['/v1/fractions?limit=500&sample=s', '/v1/grains/g/fractions?limit=500', '/v1/grains/by-atlas/g/fractions?limit=500', '/v1/spots/s/fractions?limit=500', '/v1/spots/by-atlas/s/fractions?limit=500', '/v1/tims/capsule-sets?limit=500', '/v1/tims/recipes?limit=500', '/v1/tims/batches?limit=500', '/v1/tims/spikes?limit=500', '/v1/history/fraction/f?limit=500']);
  vi.mocked(identity.get).mockClear();
  await tims.fraction('a/b'); await tims.recipe('r'); await tims.batch('b'); await tims.version('v'); await tims.suggestName('s', 'zircon'); await tims.suggestCode('l', 'Krogh');
  expect(vi.mocked(identity.get).mock.calls.map(([p]) => p)).toEqual(['/v1/fractions/a%2Fb', '/v1/tims/recipes/r', '/v1/tims/batches/b', '/v1/tims/spikes/versions/v', '/v1/fractions/suggest-name?sample=s&mineral=zircon', '/v1/tims/capsule-sets/suggest-code?lab=l&name=Krogh']);
});
it('sends all existing-record edits through the durable outbox, serializing batch children under the batch key', async () => {
  await tims.patchFraction('f', { notes: 'local' }); await tims.patchCapsuleSet('c', { active: false }); await tims.patchRecipe('r', { name: 'Synthetic' });
  await tims.patchBatch('b', { notes: 'local' }); await tims.patchStep('b', 's', { parameters: { duration_h: 12 } }); await tims.orderSteps('b', ['s']);
  await tims.putRecord('b', 'f', 's', { skipped: true }); await tims.putSpike('b', 'f', 's', { spike_weight_g: '0.0001' }); await tims.patchVersion('v', { status: 'superseded' });
  expect(vi.mocked(outbox.enqueue).mock.calls.map(([e]) => [e.objectKey, e.method, e.path])).toEqual([
    ['fraction:f', 'PATCH', '/v1/fractions/f'], ['capsule_set:c', 'PATCH', '/v1/tims/capsule-sets/c'], ['recipe:r', 'PATCH', '/v1/tims/recipes/r'],
    ['batch:b', 'PATCH', '/v1/tims/batches/b'], ['batch:b', 'PATCH', '/v1/tims/batches/b/steps/s'], ['batch:b', 'PUT', '/v1/tims/batches/b/steps/order'],
    ['batch:b', 'PUT', '/v1/tims/batches/b/fractions/f/steps/s'], ['batch:b', 'PUT', '/v1/tims/batches/b/fractions/f/steps/s/spike'], ['spike_version:v', 'PATCH', '/v1/tims/spikes/versions/v'],
  ]); expect(identity.write).not.toHaveBeenCalled();
});
it('routes every online-only operation with a form key, and preserves that key and exact body across manual retries', async () => {
  const version = { version: 'v1', composition: { concentrations: {}, ratios: {} } };
  const forms = [tims.createFraction({ sample_id: 's', mineral: 'zircon' }), tims.retireFraction('f'), tims.addSource('f', { grain_id: 'g' }), tims.retireSource('f', 's'), tims.createCapsuleSet({ lab_id: 'l', name: 'Krogh' }), tims.createRecipe({ lab_id: 'l', name: 'Synthetic', mineral: 'zircon' }), tims.createBatch({ capsule_set_id: 'c', started_on: '2026-11-06' }), tims.createStep('b', { method_code: 'SP-TIMS-CA' }), tims.deleteStep('b', 's'), tims.createSpike({ lab_id: 'l', registry_id: 'Synthetic', name: 'Synthetic', spike_type: 'Synthetic', first_version: version }), tims.createVersion('s', version), tims.previewNotes({ text: 'Synthetic-A', lab_id: 'l' }), tims.importNotes({ text: 'Synthetic-A', lab_id: 'l' })];
  for (const form of forms) await form.send();
  expect(vi.mocked(identity.write).mock.calls.map(([path, method]) => [path, method])).toEqual([
    ['/v1/fractions', 'POST'], ['/v1/fractions/f/retire', 'POST'], ['/v1/fractions/f/sources', 'POST'], ['/v1/fractions/f/sources/s/retire', 'POST'], ['/v1/tims/capsule-sets', 'POST'], ['/v1/tims/recipes', 'POST'], ['/v1/tims/batches', 'POST'], ['/v1/tims/batches/b/steps', 'POST'], ['/v1/tims/batches/b/steps/s', 'DELETE'], ['/v1/tims/spikes', 'POST'], ['/v1/tims/spikes/s/versions', 'POST'], ['/v1/tims/pick-notes/preview', 'POST'], ['/v1/tims/pick-notes/import', 'POST'],
  ]);
  expect(new Set(forms.map(f => f.idempotencyKey)).size).toBe(forms.length);
  vi.mocked(identity.write).mockClear(); const body = { name: 'Synthetic-A' }; const form = onlineForm('/v1/fractions', 'POST', body); body.name = 'changed';
  vi.mocked(identity.write).mockRejectedValueOnce(new Error('network')); await expect(form.send()).rejects.toThrow('network'); await form.send();
  expect(vi.mocked(identity.write).mock.calls[0]).toEqual(vi.mocked(identity.write).mock.calls[1]);
  expect(identity.write).toHaveBeenLastCalledWith('/v1/fractions', 'POST', { name: 'Synthetic-A' }, { idempotencyKey: form.idempotencyKey });
  vi.mocked(onlineOnlyReason).mockReturnValue('Needs the server: offline'); await expect(form.send()).rejects.toThrow('Needs the server');
  oversight.select({ username: 'synthetic', name: 'Synthetic' }); expect(() => tims.patchBatch('b', { notes: 'no' })).toThrow(READ_ONLY_REASON);
});
it('formats capsules, statuses, minerals and the typed parameter vocabulary', () => {
  expect(capsuleLabel(timsFraction)).toBe('K1'); expect(capsuleLabel({ capsule_label: null })).toBe('No capsule'); expect(statusWords('dissolved_in_ca')).toBe('dissolved during CA'); expect(mineralWords('baddeleyite')).toBe('Baddeleyite');
  expect(formatParameter({ name: 'temperature', unit: '°C' }, 190)).toBe('190 °C'); expect(formatParameter({ name: 'time', unit: 'h' }, 12)).toBe('12 h'); expect(formatParameter({ name: 'mass', unit: 'g' }, '0.000125')).toBe('0.000125 g');
  expect(formatParameter({ name: 'cycles', type: 'integer' }, 2)).toBe('2'); expect(formatParameter({ name: 'acids', type: 'multi_choice', choices: ['HF', 'HCl'] }, ['HF', 'HCl'])).toBe('HF, HCl');
  expect(formatParameter({ name: 'choice', choices: [{ value: 'k', label: 'Krogh' }] }, 'k')).toBe('Krogh'); expect(formatParameter({ name: 'unknown' }, null)).toBe('Not recorded');
});
it('allows retrying a failed next page and refuses to continue an old account list or form', async () => {
  vi.mocked(identity.get).mockResolvedValueOnce({ status: 200, body: [], nextCursor: 'next' }).mockRejectedValueOnce(new Error('Network stalled')).mockResolvedValueOnce({ status: 200, body: [] });
  const page = await tims.fractions(); await expect(page.more()).rejects.toThrow('Network stalled'); expect(await page.more()).toMatchObject({ items: [] });
  const form = onlineForm('/v1/fractions', 'POST', { notes: 'Synthetic' });
  identity.revision = 44;
  await expect(page.more()).rejects.toThrow('account or server changed'); await expect(form.send()).rejects.toThrow('account or server changed');
  identity.revision = 0;
});

it('formats machine-made meanings with one readable trailing unit', async () => {
  const { parameterLabel } = await import('./tims-api');
  for (const [meaning, unit, expected] of [
    ['Temperature c', '°C', 'Temperature (°C)'], ['Temperature C', 'c', 'Temperature (°C)'],
    ['Duration h', 'h', 'Duration (h)'], ['Ultrasonic min', 'min', 'Ultrasonic (min)'],
    ['Hotplate temperature c', '°C', 'Hotplate temperature (°C)'], ['Spike weight g', 'g', 'Spike weight (g)'],
    ['Temperature (°C)', '°C', 'Temperature (°C)'], ['Acid', 'M', 'Acid (M)'],
  ]) expect(parameterLabel({ name: 'invented', meaning, unit })).toBe(expected);
  expect(parameterLabel({ name: 'duration_h', unit: 'h' })).toBe('duration (h)');
  expect(parameterLabel({ name: 'acid', meaning: 'Acid' })).toBe('Acid');
  expect(formatParameter({ name: 'temperature_c', unit: 'c' }, 180)).toBe('180 °C');
  expect(parameterLabel({ name: 'value', meaning: 'Value min', unit: 'g' })).toBe('Value min (g)');
});

it('formats read-only summaries with units on values and unit-free names', async () => {
  const { parameterSummary } = await import('./tims-api');
  for (const meaning of ['Temperature', 'Temperature c', 'Temperature C', 'Temperature (°C)']) {
    expect(parameterSummary({ name: 'temperature_c', meaning, unit: 'c' }, 180)).toBe('Temperature: 180 °C');
  }
  expect(parameterSummary({ name: 'duration_h', unit: 'h' }, 12)).toBe('duration: 12 h');
  expect(parameterSummary({ name: 'time', meaning: 'Duration (h)', unit: 'h' }, 48)).toBe('Duration: 48 h');
  expect(parameterSummary({ name: 'mass', meaning: 'Spike weight g', unit: 'g' }, '0.000125')).toBe('Spike weight: 0.000125 g');
  expect(parameterSummary({ name: 'acid', meaning: 'Acid' }, '29 M HF')).toBe('Acid: 29 M HF');
  expect(parameterSummary({ name: 'value', meaning: 'Value min', unit: 'g' }, 2)).toBe('Value min: 2 g');
  expect(parameterSummary({ name: 'temperature_c', meaning: 'Temperature', unit: '°C' }, null)).toBe('Temperature: Not recorded');
});


it('uses loaded spike names in parameter summaries and never a raw version id', async () => {
  const { parameterSummary } = await import('./tims-api');
  const { batch, version } = await import('../../tests/fixtures/tims');
  const def = { name: 'spike_version', type: 'spike_version' };
  expect(formatParameter(def, version.id, batch.spike_versions)).toBe('Synthetic spike · Master · v1 (superseded)');
  expect(formatParameter(def, 'unknown-version')).toBe('Registered spike version (details unavailable)');
  expect(parameterSummary(def, version.id, batch.spike_versions)).toBe('spike version: Synthetic spike · Master · v1 (superseded)');
});
