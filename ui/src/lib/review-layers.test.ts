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
