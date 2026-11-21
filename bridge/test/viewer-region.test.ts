import { describe, expect, it } from 'vitest';
import {
  ATLAS_EVENTS,
  PROTOCOL_MINOR,
  PROTOCOL_VERSION,
  VIEWER_REGION_MAX_SPOTS,
  viewerRegion,
  type ViewerRegionEvent,
  type ViewerRegionKind,
} from '../src/index';

const sample: ViewerRegionEvent = {
  type: 'lab.viewer.region', kind: 'sample', project: 'atlas-1', mount: 'mount-1',
  mountLabel: 'Test mount', area: 'area-1', areaLabel: 'Test area',
  sample: 'Test sample', spots: ['spot-1', 'spot-2'],
};
const area: ViewerRegionEvent = { ...sample, kind: 'area', sample: null };
const mount: ViewerRegionEvent = { ...area, kind: 'mount', area: null, areaLabel: null, spots: [] };

describe('viewer region (v5.4)', () => {
  it('exports the protocol version, event tag and spot cap', () => {
    expect([PROTOCOL_VERSION, PROTOCOL_MINOR]).toEqual([5, 4]);
    expect(ATLAS_EVENTS.viewerRegion).toBe('lab.viewer.region');
    expect(VIEWER_REGION_MAX_SPOTS).toBe(20000);
  });

  it.each([mount, area, sample])('round-trips a $kind event with a known or unknown mount', event => {
    const kind: ViewerRegionKind = event.kind;
    expect(viewerRegion(JSON.parse(JSON.stringify(event)))).toEqual({ ...event, kind });
    expect(viewerRegion({ ...event, mount: null })).toEqual({ ...event, mount: null });
  });

  it('returns a clean copy and deduplicates spots in their original order', () => {
    const input = { ...sample, spots: ['spot-2', 'spot-1', 'spot-2', 'spot-1'], future: true };
    const result = viewerRegion(input);
    expect(result).toEqual({ ...sample, spots: ['spot-2', 'spot-1'] });
    expect(result).not.toBe(input);
    expect(result!.spots).not.toBe(input.spots);
    result!.spots.push('spot-3');
    expect(input.spots).toEqual(['spot-2', 'spot-1', 'spot-2', 'spot-1']);
  });

  it.each([null, undefined, [], {}, 'region', 1, true])('rejects a malformed envelope: %j', value => {
    expect(viewerRegion(value)).toBeNull();
  });

  it('requires every event field', () => {
    for (const event of [mount, area, sample]) {
      for (const key of Object.keys(event)) {
        const input = { ...event };
        delete input[key];
        expect(viewerRegion(input), `${event.kind} missing ${key}`).toBeNull();
      }
    }
  });

  it.each([
    { type: 'lab.viewer.inset' }, { type: null }, { type: 1 },
    { kind: 'grain' }, { kind: null }, { kind: 1 },
  ])('rejects a wrong type or unknown kind: %j', patch => {
    expect(viewerRegion({ ...sample, ...patch })).toBeNull();
  });

  it.each(['project', 'mount', 'area'])('validates the %s id and its 200-character boundary', key => {
    for (const value of [undefined, 1, true, {}, [], '', 'x'.repeat(201)])
      expect(viewerRegion({ ...sample, [key]: value }), `${key}: ${String(value)}`).toBeNull();
    if (key !== 'mount') expect(viewerRegion({ ...sample, [key]: null })).toBeNull();
    const input = { ...sample, [key]: 'x'.repeat(200) };
    expect(viewerRegion(input)).toEqual(input);
  });

  it.each(['mountLabel', 'areaLabel', 'sample'])('validates the %s label and its 500-character boundary', key => {
    for (const value of [null, undefined, 1, true, {}, [], 'x'.repeat(501)])
      expect(viewerRegion({ ...sample, [key]: value }), `${key}: ${String(value)}`).toBeNull();
    const input = { ...sample, [key]: 'x'.repeat(500) };
    expect(viewerRegion(input)).toEqual(input);
  });

  it('requires area fields only for area and sample regions, and a sample name only for sample regions', () => {
    for (const event of [area, sample]) {
      expect(viewerRegion({ ...event, area: null })).toBeNull();
      expect(viewerRegion({ ...event, areaLabel: null })).toBeNull();
    }
    expect(viewerRegion({ ...mount, area: 'area-1' })).toBeNull();
    expect(viewerRegion({ ...mount, areaLabel: 'Test area' })).toBeNull();
    for (const event of [mount, area])
      expect(viewerRegion({ ...event, sample: 'Test sample' })).toBeNull();
    expect(viewerRegion({ ...sample, sample: null })).toBeNull();
  });

  it('rejects malformed spot arrays and spot ids', () => {
    for (const spots of [null, undefined, {}, 'spot-1', [1], [null], [undefined], [{}], [[]],
      [true], [''], ['x'.repeat(201)], ['spot-1', 2], new Array(1)])
      expect(viewerRegion({ ...sample, spots })).toBeNull();
    const input = { ...sample, spots: ['x'.repeat(200)] };
    expect(viewerRegion(input)).toEqual(input);
    for (const event of [area, sample])
      expect(viewerRegion({ ...event, spots: [] })).toEqual({ ...event, spots: [] });
    expect(viewerRegion({ ...mount, spots: ['spot-1'] })).toBeNull();
  });

  it.each([area, sample])('enforces the spot cap before deduplication for $kind regions', event => {
    const spots = Array.from({ length: VIEWER_REGION_MAX_SPOTS }, (_, i) => `spot-${i}`);
    expect(viewerRegion({ ...event, spots })?.spots).toEqual(spots);
    expect(viewerRegion({ ...event, spots: [...spots, 'one-too-many'] })).toBeNull();
    expect(viewerRegion({ ...event, spots: Array(VIEWER_REGION_MAX_SPOTS).fill('spot-1') })?.spots).toEqual(['spot-1']);
    expect(viewerRegion({ ...event, spots: Array(VIEWER_REGION_MAX_SPOTS + 1).fill('spot-1') })).toBeNull();
  });
});
