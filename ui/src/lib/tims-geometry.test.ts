import { expect, it } from 'vitest';
import { capsulePucks, grainOutline, isLooseGrain, puckSlotCoordinates, sourceNames, sourceOutline, sourceSpotNames } from './tims-geometry';
import { timsFraction } from '../../tests/fixtures/review';
it('lays out default and partial pucks using the set dimensions', () => {
  expect(capsulePucks()).toEqual([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15]]);
  expect(capsulePucks(7, 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]); expect(capsulePucks(0)).toEqual([]);
});
it('runs clockwise from the front left to the front right, leaving the sixth position at the notch', () => {
  const [one, two, three, four, five] = Array.from({ length: 5 }, (_, index) => puckSlotCoordinates(index, 5));
  expect(one.x).toBeLessThan(50);
  expect(two.x).toBeCloseTo(one.x);
  expect(three.x).toBeCloseTo(50);
  expect(four.x).toBeCloseTo(five.x);
  expect(one.x + five.x).toBeCloseTo(100);
  expect(five.x).toBeGreaterThan(50);
  expect(one.y).toBeCloseTo(five.y);
  expect(two.y).toBeCloseTo(four.y);
  expect(three.y).toBeLessThan(two.y);
  expect(two.y).toBeLessThan(one.y);
  expect(Math.hypot(one.x - 50, one.y - 50)).toBeCloseTo(33);
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

it('shows every active linked spot once, preserving full stored names and falling back to elements', async () => {
  const { sourceSpotNames } = await import('./tims-geometry');
  const source = { ...timsFraction.sources[0], spot_label: 'ZZ01_S_195' };
  const geometry = { [source.mount_id!]: { current_project_uuid: null, grains: [], spots: [{ id: 'a196', server_id: 's196', name: 'ZZ01_S_196', x_um: 0, y_um: 0 }] } };
  expect(sourceSpotNames([source, source, { ...source, spot_id: 's196', atlas_spot_id: 'a196', spot_label: null },
    { ...source, spot_label: 'ZZ01_S_197', retired_at: '2026-11-23' }], geometry)).toEqual(['ZZ01_S_195', 'ZZ01_S_196']);
  expect(sourceSpotNames([{ ...source, spot_id: null, atlas_spot_id: null, spot_label: null }], geometry)).toEqual([]);
});

it('names loose grains without inventing a mount or LA spot', () => {
  const source = { ...timsFraction.sources[0], grain_id: null, atlas_grain_id: null, spot_id: null, atlas_spot_id: null, mount_id: null,
    grain_label: null, mount_label: null, spot_label: null, loose_grain_id: 'loose-invented', loose_grain_label: 'LG-invented-1' };
  expect(isLooseGrain(source)).toBe(true);
  expect(sourceNames(source)).toEqual({ loose: true, mount: 'Loose grain', grain: 'LG-invented-1', spot: 'Not recorded' });
  expect(sourceSpotNames([source], {})).toEqual([]);
  expect(sourceNames({ ...source, loose_grain_label: null }).grain).toBe('Loose grain');
  expect(sourceNames({ ...source, loose_grain_label: '  ' }).grain).toBe('Loose grain');
  expect(isLooseGrain({ loose_grain_label: ' L-7 ' })).toBe(true);
  expect(sourceNames({ ...source, loose_grain_id: null, loose_grain_label: ' L-7 ' }).grain).toBe('L-7');
});

it('keeps older-server and registered sources unchanged when loose-grain fields are absent or blank', () => {
  const registered = { ...timsFraction.sources[0], mount_label: 'Invented mount', grain_label: 'Registered grain', spot_label: 'Stored spot' };
  expect(isLooseGrain(registered)).toBe(false);
  expect(sourceNames(registered)).toEqual({ mount: 'Invented mount', grain: 'Registered grain', spot: 'Stored spot' });
  expect(sourceNames({ ...registered, loose_grain_id: null, loose_grain_label: '  ' })).toEqual(sourceNames(registered));
  const older = { ...registered, grain_id: null, atlas_grain_id: null, spot_id: null, atlas_spot_id: null, mount_id: null,
    grain_label: null, mount_label: null, spot_label: null };
  expect(sourceNames(older)).toEqual({ mount: 'Not recorded', grain: 'Not recorded', spot: 'Not recorded' });
});
