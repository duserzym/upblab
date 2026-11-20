import { expect, it } from 'vitest';
import { grainCrop } from './tims-grain-image';
import { inventedAtlas, inventedElements } from '../../tests/fixtures/tims-atlas';

const grain = inventedElements.grains[0], spot = inventedElements.spots[0];
it('maps nonzero mosaic origin and positive-down axes, masks exactly, and projects the spot diameter', () => {
  const crop = grainCrop(inventedAtlas, grain, spot, 180);
  expect(crop.level.z).toBe(0);
  expect(crop.viewBox).toBe('220 220 240 140');
  expect(crop.points).toBe('240,240 440,240 400,340 240,320');
  expect(crop.spot).toEqual({ x: 340, y: 280, radius: 10 });
  expect(crop.tiles.map(t => t.path)).toEqual(['pyramid/area-a/0/0_0.webp', 'pyramid/area-a/0/1_0.webp', 'pyramid/area-a/0/0_1.webp', 'pyramid/area-a/0/1_1.webp']);
  expect(crop.tiles[3]).toMatchObject({ x: 256, y: 256, width: 256, height: 256 });
});
it('chooses the closest sufficient level for cells, drawers and Review at device resolution', () => {
  for (const [size, dpr, z] of [[72, 1, 1], [72, 2, 0], [180, 1, 0], [120, 1, 0], [30, 1, 2], [180, 3, 0]]) {
    const crop = grainCrop(inventedAtlas, grain, spot, size, dpr);
    expect(crop.level.z).toBe(z);
    if (z === 1) { expect(crop.points).toBe('120,120 220,120 200,170 120,160'); expect(crop.spot?.radius).toBe(5); expect(crop.tiles).toHaveLength(1); }
  }
});
it('uses the stored second area, its origin, pixel scale and partial edge tiles', () => {
  const crop = grainCrop(inventedAtlas, { ...grain, area_id: 'area-b', polygon_um: [[1456, 550], [1500, 550], [1500, 600], [1456, 600]] }, { ...spot, x_um: 1478, y_um: 575, diameter_um: null }, 120);
  expect(crop.points).toBe('512,300 600,300 600,400 512,400');
  expect(crop.tiles).toEqual([{ path: 'pyramid/area-b/0/2_1.webp', col: 2, row: 1, x: 512, y: 256, width: 88, height: 144 }]);
  expect(crop.spot).toEqual({ x: 556, y: 350, radius: null });
});
it('does not request an adjacent tile when the grain ends exactly on its boundary, or tiles for padding', () => {
  const crop = grainCrop(inventedAtlas, { ...grain, polygon_um: [[580, 430], [612, 430], [612, 462], [580, 462]] }, undefined, 72);
  expect(crop.points).toBe('240,240 256,240 256,256 240,256');
  expect(crop.tiles.map(t => t.path)).toEqual(['pyramid/area-a/0/0_0.webp']);
  expect(crop.spot).toBeNull();
});
it('rejects missing or invalid polygons and areas rather than guessing a different area', () => {
  for (const polygon_um of [null, [], [[0, 0]], [[580, 430], [NaN, 430], [980, 630]], [[580, 430], [580, 430], [580, 430]]]) {
    expect(() => grainCrop(inventedAtlas, { ...grain, polygon_um }, undefined, 72)).toThrow();
  }
  expect(() => grainCrop(inventedAtlas, { ...grain, area_id: 'missing' }, undefined, 72)).toThrow('grain area');
  expect(() => grainCrop(inventedAtlas, { ...grain, polygon_um: [[0, 0], [1, 0], [1, 1]] }, undefined, 72)).toThrow('outside');
});
