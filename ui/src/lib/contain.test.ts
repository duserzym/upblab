import { describe, expect, it } from 'vitest';
import { containRect } from './contain';
const bounds = { left: 100, top: 80, width: 300, height: 200 };
describe('containRect', () => {
  it('places a popup below its anchor', () => {
    expect(containRect({ w: 120, h: 50 }, { left: 120, top: 90, width: 40, height: 20 }, bounds))
      .toEqual({ left: 120, top: 114, maxWidth: 120, maxHeight: 50 });
  });
  it('clamps every edge, including a popup larger than its panel', () => {
    for (const size of [{ w: 500, h: 400 }, { w: 120, h: 50 }]) {
      for (const anchor of [{ left: 0, top: 0, width: 20, height: 20 }, { left: 900, top: 900, width: 20, height: 20 }]) {
        const r = containRect(size, anchor, bounds);
        expect(r.left).toBeGreaterThanOrEqual(bounds.left);
        expect(r.top).toBeGreaterThanOrEqual(bounds.top);
        expect(r.left + r.maxWidth).toBeLessThanOrEqual(bounds.left + bounds.width);
        expect(r.top + r.maxHeight).toBeLessThanOrEqual(bounds.top + bounds.height);
      }
    }
  });
  it('flips above when there is no room below the anchor', () => {
    expect(containRect({ w: 120, h: 50 }, { left: 120, top: 240, width: 40, height: 20 }, bounds))
      .toEqual({ left: 120, top: 186, maxWidth: 120, maxHeight: 50 });
  });
  it('aligns to the anchor right edge before clamping', () => {
    expect(containRect({ w: 120, h: 50 }, { left: 330, top: 90, width: 40, height: 20 }, bounds))
      .toEqual({ left: 250, top: 114, maxWidth: 120, maxHeight: 50 });
  });
  it('clamps above when neither side has enough room', () => {
    expect(containRect({ w: 120, h: 180 }, { left: 120, top: 160, width: 40, height: 20 }, bounds).top).toBe(80);
  });
  it('handles a collapsed panel without negative sizes', () => {
    expect(containRect({ w: 100, h: 100 }, bounds, { ...bounds, width: 0, height: 0 }))
      .toEqual({ left: 100, top: 80, maxWidth: 0, maxHeight: 0 });
  });
});
