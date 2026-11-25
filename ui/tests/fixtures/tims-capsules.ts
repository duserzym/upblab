// Invented capsule corrections and mount metadata, shared by browser checks.
import { batch } from './tims';
import { inventedElements } from './tims-atlas';
import type { FractionOut } from '../../src/lib/tims-api';
export const capsuleMount = { id: 'mount-demo', label: 'Invented mount S 150X', atlas: { project_id: 'project-demo' }, sample_names: ['Synthetic-A', 'Synthetic-B'], sample_count: 2, grain_count: 2, projects: [{ code: 'DEMO', name: 'Invented project' }], content_revision: 1 };
export const correctionGrain = { ...inventedElements.grains[0], id: 'atlas-correction', server_id: 'grain-correction', label: '002_Demo/4', sample: batch.fractions[0].sample.name };
export const correctionSpot = { ...inventedElements.spots[0], id: 'atlas-correction-spot', server_id: 'spot-correction', grain_id: correctionGrain.id, name: 'Demo-12' };
export const correctionElements = { ...inventedElements, grains: [...inventedElements.grains, correctionGrain], spots: [...inventedElements.spots, correctionSpot] };
export const correctionFixtures = { '/v1/mounts?limit=50': [capsuleMount], '/v1/mounts/mount-demo': capsuleMount, '/v1/mounts/mount-demo/elements': correctionElements };
export const replacementPath = `/v1/fractions/${batch.fractions[0].id}/sources/${batch.fractions[0].sources[0].id}/replace`;
export function correctedFraction(crossSample = false): FractionOut {
  const old = batch.fractions[0];
  const retired = { ...old.sources[0], retired_at: '2026-11-24T12:00:00Z', retired_by_name: 'Invented analyst', replaced_by_id: 'source-correction', reason: 'Wrong grain selected' };
  return { ...old, ...(crossSample ? { id: 'fraction-correction', name: 'z7', sample: { id: 'sample-b', name: 'Synthetic-B' } } : {}),
    sources: [{ ...old.sources[0], id: 'source-correction', grain_id: correctionGrain.server_id, atlas_grain_id: correctionGrain.id, grain_label: correctionGrain.label,
      spot_id: correctionSpot.server_id, atlas_spot_id: correctionSpot.id, spot_label: correctionSpot.name, is_fragment: false, fragment_note: '' }],
    replaced_sources: [retired], replaced_fraction_id: crossSample ? old.id : null,
    replaces: crossSample ? { id: old.id, name: old.name, sample_name: old.sample.name, retired_at: retired.retired_at, retired_by_name: retired.retired_by_name, sources: [retired] } : null,
  };
}
