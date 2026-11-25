import { expect, it } from 'vitest';
import { weighedMass, spikeWarnings } from './tims-tracer';

it('uses the direct mass or positive bottle difference, retaining decimal precision', () => {
  expect(weighedMass('', '25.00000', '24.99000', true)).toBe('0.01000');
  expect(weighedMass('0.02', '', '', false)).toBe('0.02');
  expect(weighedMass(' 0.02 ', '', '', false)).toBe('0.02');
  expect(weighedMass('', '25.0', '25.1', true)).toBe('');
  expect(weighedMass('', 'invalid', '24.99', true)).toBe('');
});
it('explains the server warnings without calculating tracer amounts or uncertainty', () => {
  expect(spikeWarnings).toEqual({
    spike_version_not_current: 'The recorded spike version is no longer current.',
    spike_weight_unusual: 'This spike weight is unusual. Check the balance reading and grams.',
    bottle_difference_mismatch: 'The bottle difference does not match the recorded spike weight.',
    readability_missing: 'Balance readability is missing; weight uncertainty is not given.',
  });
});
