import { describe, expect, it } from 'vitest';
import { readHomeSections } from './home-sections';

describe('Home layout validation', () => {
  it.each([null, [], 'bad', 12, undefined])('ignores a malformed layout: %j', value => {
    expect(readHomeSections(value)).toEqual({});
  });
  it('ignores old board heights and collapse states while retaining the atlas filter', () => {
    expect(readHomeSections({
      sessions: { height: -10, collapsed: true }, local: { height: null, collapsed: false },
      mounts: { height: 5000, collapsed: true, atlasFilter: 'with' }, atlases: { height: 300 }, other: {},
    }, 800)).toEqual({ mounts: { atlasFilter: 'with' } });
  });
  it.each(['overview', 'records'] as const)('restores the %s view and drops unknown keys', view => {
    expect(readHomeSections({ view, unknown: 'drop', sessions: { view: 'records' } })).toEqual({ view });
  });
  it.each(['all', 'with', 'without'] as const)('restores the %s atlas filter only for Mounts', atlasFilter => {
    expect(readHomeSections({ sessions: { atlasFilter }, mounts: { atlasFilter }, atlases: { atlasFilter } }))
      .toEqual({ mounts: { atlasFilter } });
  });
  it.each([null, true, 'unknown', {}, []])('drops invalid values %j', value => {
    expect(readHomeSections({ view: value, mounts: { atlasFilter: value, height: 300, collapsed: true } })).toEqual({});
  });
});
