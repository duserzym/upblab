import { expect, it } from 'vitest';
import { defaultLayout, dock, gap, geometry, readLayout, resize } from './review-layout';

it('fits the default review into a narrow desktop window', () => {
  const { tiles, dividers } = geometry(defaultLayout(true), 1280, 650);
  expect(dividers).toHaveLength(3);
  expect(tiles.images!.width).toBeGreaterThan(500);
  expect(tiles.plots!.width).toBeGreaterThan(240);
  expect(tiles.details!.y).toBe(tiles.spots!.height + gap);
  expect(tiles.details!.x).toBe(tiles.spots!.x);
  expect(tiles.details!.width).toBe(tiles.spots!.width);
  expect(tiles.plots!.y).toBe(tiles.images!.y);
  expect(tiles.plots!.height).toBe(tiles.images!.height);
  expect(tiles.images!.x + tiles.images!.width).toBe(1280);
});

it('re-tiles panes and remembers the resized layout', () => {
  const next = dock(defaultLayout(true), 'images', 'plots', 'top');
  const layout = resize(next, ['second'], 0.65);
  const json = JSON.stringify(layout);
  expect(readLayout(json, true, 50)).toEqual(layout);
  const { tiles } = geometry(layout, 1280, 650);
  expect(Object.keys(tiles)).toHaveLength(4);
  expect(tiles.images!.x).toBe(tiles.plots!.x);
  expect(tiles.images!.y + tiles.images!.height + gap).toBe(tiles.plots!.y);
});

it('rejects invalid saved layouts and layouts that repeat panes', () => {
  expect(readLayout('invalid', true, 57)).toEqual(defaultLayout(true, 57));
  expect(readLayout(JSON.stringify(defaultLayout(true)), false, 50)).toEqual(defaultLayout(false));
  expect(readLayout('{"axis":"x","ratio":0.5,"first":"plots","second":"plots"}', true, 50)).toEqual(defaultLayout(true));
});
