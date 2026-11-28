import { expect, it } from 'vitest';
import { defaultSpikeVersion } from './tims-spike-default';
import type { SpikeDefault } from './tims-api';
import { publishedVersion, lab } from '../../tests/fixtures/tims';
const settings: SpikeDefault = { id: 'invented-settings', lab_id: lab, default_spike_solution_id: publishedVersion.solution_id, version: publishedVersion, source: 'default' };
it('accepts the lab default current registered version with its exact id', () => {
  expect(defaultSpikeVersion('', settings)).toBe(publishedVersion);
});
it('accepts the server single-current fallback without needing the catalogue', () => {
  expect(defaultSpikeVersion('', { ...settings, default_spike_solution_id: null, source: 'single_current' })?.id).toBe(publishedVersion.id);
});
it('keeps an existing capsule or batch pin when the lab default changes', () => {
  expect(defaultSpikeVersion('previous-version', settings)).toBeNull();
});
it('leaves ambiguous, missing, withdrawn and superseded defaults for Choose spike', () => {
  expect(defaultSpikeVersion('', null)).toBeNull();
  expect(defaultSpikeVersion('', { ...settings, source: 'choose' })).toBeNull();
  expect(defaultSpikeVersion('', { ...settings, version: null })).toBeNull();
  for (const status of ['withdrawn', 'superseded'] as const)
    expect(defaultSpikeVersion('', { ...settings, version: { ...publishedVersion, status } })).toBeNull();
});
