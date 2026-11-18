import { describe, expect, it } from 'vitest';
import type { ReviewSpot } from '../../lib/review-data';
import type { Band, Guide, Mark } from './plot-data';
import { plotVisibility } from './plot-visibility';

const spot = (key: string, sampleName: string, isReference = false) => ({ key, sampleName, isReference }) as ReviewSpot;
const marks: Mark[] = [
  { spot: spot('a1', 'A'), point: [1, 2], polygon: [[0, 1], [2, 3]], boxed: true },
  { spot: spot('a2', 'A'), path: [[1, 2], null, [3, 4]] },
  { spot: spot('b1', 'B'), point: [3, 4] },
];
const bands: Band[] = ['A', 'B', 'depth-column'].map(seriesKey => ({ seriesKey, color: 'red', upper: [[1, 2]], lower: [[1, 1]] }));
const guides: Guide[] = [{ path: [], label: 'reference' }, { seriesKey: 'A', path: [], point: [1, 2], label: 'A label' }];

describe('plotVisibility', () => {
  it('hides every primitive owned by a sample, retaining a dimmed legend toggle', () => {
    const visible = plotVisibility({ marks, bands, guides, hidden: new Set(['A']) });
    expect(visible.marks).toEqual([marks[2]]);
    expect(visible.bands).toEqual(bands.slice(1));
    expect(visible.guides).toEqual([guides[0]]);
    expect(visible.legend).toEqual([{ key: 'false:A', name: 'A', shown: false }, { key: 'false:B', name: 'B', shown: true }]);
  });
  it('hides a spot and its ellipse, path, band and label without hiding its peers', () => {
    const result = plotVisibility({ marks, bands: [{ ...bands[0], spotKey: 'a1' }],
      guides: [{ ...guides[1], spotKey: 'a1' }], hidden: new Set(['a1', 'a2']) });
    expect(result.marks).toEqual([marks[2]]);
    expect(result.bands).toEqual([]);
    expect(result.guides).toEqual([]);
    expect(result.legend.every(s => s.shown)).toBe(true);
  });
  it('hides a depth column trace and band by their shared series key', () => {
    const trace = { ...marks[0], seriesKey: 'depth-column' };
    const result = plotVisibility({ marks: [trace, marks[2]], bands, hidden: new Set(['depth-column']) });
    expect(result.marks).toEqual([marks[2]]);
    expect(result.bands).toEqual(bands.slice(0, 2));
  });
  it('distinguishes sample group keys and preserves all items when restored', () => {
    const reference = { ...marks[0], spot: spot('ref', 'A', true) };
    expect(plotVisibility({ marks: [...marks, reference], hidden: new Set(['false:A']) }).marks).toEqual([marks[2], reference]);
    const restored = plotVisibility({ marks, bands, guides, hidden: new Set() });
    expect(restored.marks).toEqual(marks);
    expect(restored.bands).toEqual(bands);
    expect(restored.guides).toEqual(guides);
  });
  it('keeps explicitly supplied legend entries when all their marks are absent', () => {
    expect(plotVisibility({ marks: [], samples: [{ key: 'A', name: 'A' }], hidden: new Set(['A']) }).legend)
      .toEqual([{ key: 'A', name: 'A', shown: false }]);
  });
  it('preserves unowned bands for older callers', () => {
    const band: Band = { upper: [[1, 2]], lower: [[1, 1]], color: 'red' };
    expect(plotVisibility({ marks, bands: [band], hidden: new Set(['A', 'B']) }).bands).toEqual([band]);
  });
});
