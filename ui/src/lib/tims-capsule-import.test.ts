import { expect, it } from 'vitest';
import { grainSources, missingSpotSources, mountGrainChoices } from './tims-capsule-import';
import { inventedElements } from '../../tests/fixtures/tims-atlas';
import { timsFraction } from '../../tests/fixtures/review';

it('imports registered associations only and excludes retired or other-project grains', () => {
  const grain = inventedElements.grains[0], spot = { ...inventedElements.spots[0], grain_id: grain.id };
  const options = mountGrainChoices({
    ...inventedElements,
    grains: [grain, { ...grain, id: 'old', retired: true }, { ...grain, id: 'old-project', project_uuid: 'old-project' }],
    spots: [spot, { ...spot, server_id: 'unlinked', grain_id: null }, { ...spot, server_id: undefined }],
  });
  expect(options).toEqual([{ grain, spots: [spot] }]);
  expect(grainSources(grain.server_id!, ['spot-1', 'spot-2', 'spot-1'], '  tip  ')).toEqual([
    { grain_id: 'grain-1', spot_id: 'spot-1', is_fragment: true, fragment_note: 'tip' },
    { grain_id: 'grain-1', spot_id: 'spot-2', is_fragment: true, fragment_note: 'tip' },
  ]);
  expect(grainSources('grain-1', [], '')).toEqual([{ grain_id: 'grain-1' }]);
  const second = { ...spot, server_id: 'spot-2' };
  expect(missingSpotSources(timsFraction.sources, grain, [spot, second])).toEqual({ grainOnly: false, spots: [second] });
});
