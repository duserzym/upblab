import { expect, it } from 'vitest';
import { groupSpots, normalise } from './review-data';
import { layerVisibility, moveLayer, orderedLayers, resultLayers } from './review-layers';

it('keeps samples and standards in separate branches even when their names match', () => {
  const rows = [
    normalise({ label: 'Material_1', sample_name: 'Material', grain_id: 'g1' }),
    normalise({ label: 'Material_2', kind: 'secondary_standard' }),
  ];
  const [sample, standard] = resultLayers(groupSpots(rows));
  expect(sample).toMatchObject({ name: 'Samples', children: [{ name: 'Material', children: [{ grain: true }] }] });
  expect(standard).toMatchObject({ name: 'Standards', children: [{ name: 'Material', children: [{ spot: rows[1] }] }] });
  expect(layerVisibility(rows, new Set())).toBe(true);
  expect(layerVisibility(rows, new Set([rows[1].key]))).toBe('mixed');
  expect(layerVisibility(rows, new Set(rows.map(row => row.key)))).toBe(false);
});

it('moves siblings and preserves the order when results are filtered', () => {
  const rows = ['A', 'B', 'C'].map(name => normalise({ label: name, sample_name: name }));
  const children = groupSpots(rows).map(group => group.key);
  const moved = moveLayer(children, children[2], children[0], false);
  expect(moved).toEqual([children[2], children[0], children[1]]);
  const [branch] = orderedLayers(resultLayers(groupSpots([rows[1], rows[2]])), { samples: moved });
  expect('children' in branch && branch.children.map(layer => layer.name)).toEqual(['C', 'B']);
  expect(moveLayer(children, 'outside', children[0], false)).toBe(children);
});

import { reuseLayers, layerIndex, type Layer } from './review-layers';
it('retains unchanged samples and spot rows when a sample is removed or restored', () => {
  const spots = Array.from({ length: 2000 }, (_, i) => normalise({ acquisition_id: `invented-${i}`, sample_name: `Sample ${i % 5}`, grain_id: `grain-${i % 100}`, grain_label: `Grain ${i % 100}` }));
  const all = orderedLayers(resultLayers(groupSpots(spots)), {});
  const next = reuseLayers(all, orderedLayers(resultLayers(groupSpots(spots.filter(s => s.sampleName !== 'Sample 1'))), {}));
  expect(next).not.toBe(all);
  if (!('children' in all[0]) || !('children' in next[0])) throw new Error('samples branch');
  for (const sample of next[0].children) expect(sample).toBe(all[0].children.find(s => s.key === sample.key));
  expect(reuseLayers(all, orderedLayers(resultLayers(groupSpots(spots)), {}))).toBe(all);
  const restored = reuseLayers(next, orderedLayers(resultLayers(groupSpots(spots)), {}));
  if (!('children' in restored[0])) throw new Error('samples branch');
  for (const sample of next[0].children) expect(restored[0].children.find(s => s.key === sample.key)).toBe(sample);
});
it('indexes visible keyboard order and paths through collapsed branches, including standards', () => {
  const tree: Layer[] = [{ key: 'samples', name: 'Samples', rows: [], children: [
    { key: 'closed', name: 'Closed', rows: [], children: [{ key: 'a', name: 'a', rows: [], spot: normalise({ acquisition_id: 'a' }) }] },
    { key: 'open', name: 'Open', rows: [], children: [{ key: 'b', name: 'b', rows: [], spot: normalise({ acquisition_id: 'b' }) }] },
  ] }, { key: 'standards', name: 'Standards', rows: [], children: [{ key: 'c', name: 'c', rows: [], spot: normalise({ acquisition_id: 'c', kind: 'standard' }) }] }];
  const index = layerIndex(tree, layer => layer.key !== 'closed');
  expect(index.visible).toEqual(['b', 'c']); expect(index.positions.get('b')).toBe(0); expect(index.positions.get('c')).toBe(1);
  expect(index.paths.get('a')).toEqual(['samples', 'closed']); expect(index.paths.get('c')).toEqual(['standards']);
  expect(index.closed).toEqual(new Set(['closed']));
});
it('does not reuse stale metadata or rows after a stored result refresh', () => {
  const spot = normalise({ acquisition_id: 'a', sample_name: 'A' });
  const before = resultLayers(groupSpots([spot]));
  const updated = reuseLayers(before, resultLayers(groupSpots([{ ...spot, label: 'new label' }])));
  expect(updated).not.toBe(before);
  expect(updated[0].rows[0].label).toBe('new label');
});
