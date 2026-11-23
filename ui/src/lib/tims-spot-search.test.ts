import { describe, expect, it } from 'vitest';
import { buildSpotSearchIndex, grainChoiceLabel, searchSpots, spotMountQuery } from './tims-spot-search';
import type { MountGeometry } from './tims-geometry';

function mount(rows: [string, string, string[]][]): MountGeometry {
  return { current_project_uuid: null,
    grains: rows.map(([sample, name], i) => ({ id: `a${i}`, server_id: `g${i}`, sample, label: name, polygon_um: null })),
    spots: rows.flatMap(([, , names], i) => names.map((name, j) => ({ id: `s${i}-${j}`, server_id: `s${i}-${j}`, grain_id: `a${i}`, name, x_um: 0, y_um: 0 }))),
  };
}
const snapshot = mount([
  ['ZZ01', '001_ZZ01/12', ['ZZ01_S_195', 'ZZ01_S_196']],
  ['ZZ01', '002_ZZ01/12', ['ZZ01_S_1950']],
  ['ZZ02', '003_ZZ02/12', ['ZZ02-641']],
  ['ZZ01', '004_ZZ01/12', []],
]);
const ids = (query: string) => searchSpots(buildSpotSearchIndex(snapshot), query).map(m => m.choice.grain.server_id);
describe('TIMS spot search', () => {
  it.each(['195', 'S 195', 'S_195', 'ZZ01_S_195', 'zz01 195', 'zz01.s/00195', 's-000195'])('matches %s by complete numbers and text prefixes', query => {
    expect(ids(query)).toEqual(['g0']);
  });
  it('matches sample prefixes and hyphenated spot numbers', () => { expect(ids('zz 641')).toEqual(['g2']); });
  it('matches whole grain labels, grains without spots, and all tokens across a choice', () => {
    expect(ids('004_ZZ01/12')).toEqual(['g3']);
    expect(ids('ZZ01 004')).toEqual(['g3']);
    expect(ids('195 196')).toEqual(['g0']);
    expect(ids('195 641')).toEqual([]);
    expect(ids('19')).toEqual([]);
  });
  it('filters by sample and preserves the mount order for an empty query', () => {
    const index = buildSpotSearchIndex(snapshot);
    expect(index.samples).toEqual(['ZZ01', 'ZZ02']);
    expect(searchSpots(index, '', 'ZZ01').map(m => m.choice.grain.server_id)).toEqual(['g0', 'g1', 'g3']);
    expect(searchSpots(index, '641', 'ZZ01')).toEqual([]);
    expect(grainChoiceLabel(index.entries[0].choice)).toBe('ZZ01_S_195, ZZ01_S_196 · grain 001_ZZ01/12');
    expect(grainChoiceLabel(index.entries[3].choice)).toBe('004_ZZ01/12');
  });
  it('ranks exact spot, spot tokens, grain label, then sample, stably within each rank', () => {
    const index = buildSpotSearchIndex(mount([
      ['ZZ01', 'other', []], ['other', 'ZZ01', []], ['other', 'grain', ['ZZ01_S_195']],
      ['other', 'grain', ['ZZ01']], ['other', 'grain', ['ZZ01_S_196']],
    ]));
    const results = searchSpots(index, 'zz01');
    expect(results.map(m => m.choice.grain.server_id)).toEqual(['g3', 'g2', 'g4', 'g1', 'g0']);
    expect(results.map(m => m.rank)).toEqual([0, 1, 1, 2, 3]);
  });
  it('reports matching spot names using sample context', () => {
    const index = buildSpotSearchIndex(mount([['ZZ01', 'grain', ['S 195', 'S 196']]]));
    expect(searchSpots(index, 'ZZ01 195')[0].spotNames).toEqual(['S 195']);
  });
  it('indexes only registered active grains and spots', () => {
    const data = mount([['ZZ01', 'grain', ['ZZ01_S_195']]]);
    data.grains.push({ ...data.grains[0], server_id: 'retired', retired: true });
    data.spots.push({ ...data.spots[0], server_id: undefined, name: 'ZZ01_S_196' });
    expect(buildSpotSearchIndex(data).entries).toHaveLength(1);
    expect(searchSpots(buildSpotSearchIndex(data), '196')).toEqual([]);
  });
  it('reuses an index for thousands of grains and repeated in-memory searches', () => {
    const data = mount(Array.from({ length: 5000 }, (_, i) => ['ZZ01', `grain/${i}`, [`ZZ01_S_${i}`, `ZZ01_T_${i}`]]));
    const start = performance.now(), index = buildSpotSearchIndex(data), built = performance.now();
    for (let i = 190; i < 210; i++) expect(searchSpots(index, `S ${i}`)[0].choice.grain.server_id).toBe(`g${i}`);
    console.info(`TIMS spot index: 5000 grains / 10000 spots built in ${(built - start).toFixed(2)} ms; 20 searches in ${(performance.now() - built).toFixed(2)} ms; 0 requests.`);
  });
});
it('extracts a mount sample query only on submit, keeping local number/letter searches local', () => {
  for (const query of ['ZZ01_S_195', 'ZZ01-641', 'zz01 195', 'ZZ01']) expect(spotMountQuery(query, true)?.toLowerCase()).toBe('zz01');
  expect(spotMountQuery('S 195', true)).toBeNull();
  expect(spotMountQuery('195', true)).toBeNull();
  expect(spotMountQuery('ZZ01', false)).toBe('ZZ01');
  expect(spotMountQuery('ZZ-01_S_195', false)).toBe('ZZ-01');
  expect(spotMountQuery('ZZ.01-641', false)).toBe('ZZ.01');
});
