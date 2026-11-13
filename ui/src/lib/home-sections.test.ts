import { describe, expect, it } from 'vitest';
import { clampHeight, readHomeSections, restoredHeight, rowStep } from './home-sections';

describe('Home section sizes', () => {
  it('clamps to one row through show all, including short or empty grids', () => {
    expect(clampHeight(10, 120, 900)).toBe(120);
    expect(clampHeight(500, 120, 900)).toBe(500);
    expect(clampHeight(1000, 120, 900)).toBe(900);
    expect(clampHeight(300, 120, 20)).toBe(120);
    expect(clampHeight(NaN, 120, 900)).toBe(120);
  });
  it('steps by a measured card and gap, falling back before cards exist', () => {
    expect(rowStep(105.5, 7.5)).toBe(113);
    expect(rowStep(100, NaN)).toBe(100);
    expect(rowStep(100, -8)).toBe(100);
    expect(rowStep(0, 8)).toBe(120);
    expect(rowStep(NaN, 8)).toBe(120);
  });
  it('limits restored sizes to the viewer’s current window', () => {
    expect(restoredHeight(4000, 640)).toBe(512);
    expect(restoredHeight(300, 982)).toBe(300);
    expect(restoredHeight(1, 640)).toBe(80);
    expect(restoredHeight(9000)).toBe(4000);
  });
});

describe('Home layout validation', () => {
  it.each([null, [], 'bad', 12, undefined])('ignores a malformed layout: %j', value => {
    expect(readHomeSections(value)).toEqual({});
  });
  it('drops unknown keys and fields, clamps finite numbers, and preserves defaults', () => {
    expect(readHomeSections({
      other: { height: 300 }, sessions: { height: -10, collapsed: true, unknown: 'drop' },
      mounts: { height: 5000, collapsed: false }, atlases: { height: null },
    })).toEqual({ sessions: { height: 80, collapsed: true }, mounts: { height: 4000, collapsed: false } });
  });
  it.each([NaN, Infinity, '300', {}, false])('drops an invalid height %j without losing collapse', height => {
    expect(readHomeSections({ sessions: { height, collapsed: true }, mounts: [], atlases: { collapsed: 'true' } }))
      .toEqual({ sessions: { collapsed: true } });
  });
  it('optionally fits saved sizes to the viewport', () => {
    expect(readHomeSections({ mounts: { height: 4000 } }, 800)).toEqual({ mounts: { height: 640 } });
  });
  it.each(['all', 'with', 'without'] as const)('restores the %s atlas filter only for Mounts', atlasFilter => {
    expect(readHomeSections({ sessions: { atlasFilter }, mounts: { atlasFilter }, atlases: { atlasFilter } }))
      .toEqual({ mounts: { atlasFilter } });
  });
  it.each([null, true, 'unknown', {}, []])('drops an invalid atlas filter %j while keeping layout', atlasFilter => {
    expect(readHomeSections({ mounts: { atlasFilter, height: 300, collapsed: true } }))
      .toEqual({ mounts: { height: 300, collapsed: true } });
  });
});
