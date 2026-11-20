import { expect, it } from 'vitest';
import { capsulePucks, grainOutline, sourceOutline } from './tims-geometry';
import { timsFraction } from '../../tests/fixtures/review';
it('lays out default and partial pucks using the set dimensions', () => {
  expect(capsulePucks()).toEqual([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15]]);
  expect(capsulePucks(7, 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]); expect(capsulePucks(0)).toEqual([]);
});
it('scales a grain with equal aspect ratio and projects its LA spot, or returns a neutral placeholder', () => {
  expect(grainOutline([[100, 200], [300, 200], [300, 300], [100, 300]], { x_um: 200, y_um: 250 })).toEqual({ points: '10,30 90,30 90,70 10,70', dot: [50, 50] });
  for (const p of [null, [], [[0, 0]], [[1, 1], [1, 1], [1, 1]], [[0, 0], [NaN, 2], [1, 3]]]) expect(grainOutline(p)).toBeNull();
});
it('joins server and atlas identities from the actual mount-elements contract', () => {
  const source = { ...timsFraction.sources[0], grain_id: 'registered-grain', spot_id: 'registered-spot' };
  expect(sourceOutline(source, { grains: [{ id: 'atlas-grain', server_id: 'registered-grain', polygon_um: [[0, 0], [10, 0], [10, 10]] }], spots: [{ id: 'atlas-spot', server_id: 'registered-spot', x_um: 5, y_um: 5 }], current_project_uuid: 'invented' })?.dot).toEqual([50, 50]);
  expect(sourceOutline(undefined, undefined)).toBeNull();
});

it('uses source labels first, then shared mount elements and never displays a source id', async () => {
  const { sourceNames } = await import('./tims-geometry');
  const source = { ...timsFraction.sources[0], mount_label: null, grain_label: null, spot_label: null };
  const geometry = { label: 'Invented mount', current_project_uuid: null, grains: [{ id: source.atlas_grain_id, server_id: source.grain_id!, number: 3, polygon_um: null }], spots: [{ id: source.atlas_spot_id, server_id: source.spot_id!, label: 'Invented spot', x_um: 0, y_um: 0 }] };
  expect(sourceNames(source, geometry)).toEqual({ mount: 'Invented mount', grain: 3, spot: 'Invented spot' });
  expect(sourceNames({ ...source, mount_label: 'Recorded mount', grain_label: 'Recorded grain' }, geometry)).toMatchObject({ mount: 'Recorded mount', grain: 'Recorded grain' });
  expect(sourceNames(source)).toEqual({ mount: 'Not recorded', grain: 'Not recorded', spot: 'Not recorded' });
});
