import { expect, it } from 'vitest';
import { fractionChemistry } from './tims-display';
import { timsBatch, timsFraction } from '../../tests/fixtures/review';
it('shows actual overrides, units, outcome and the selected spike version status', () => {
  const chemistry = fractionChemistry(timsBatch, timsFraction);
  expect(chemistry[0]).toMatchObject({ values: ['Acid: 29 M HF', 'Temperature: 180 °C', 'Duration: 12 h'], skipped: false, outcome: 'dissolved during CA' });
  expect(chemistry[1].values).toContain('Duration: 48 h');
  expect(chemistry[2].spike).toBe('Synthetic spike · Master · v1 · superseded');
});

it('shows names, project codes and unique pick-note results with ids kept out of visible text', async () => {
  const { resolvedReferences, pickNoteResult, planBatchName, planRecipeName, operatorName, spikeVersionName } = await import('./tims-display');
  const { plan, batch, recipe, solutions, version } = await import('../../tests/fixtures/tims');
  expect(resolvedReferences({ sample: { id: 'invented-id', name: 'Invented sample', project_code: 'DEMO-2026' }, set: { id: 'set-k', name: 'Krogh', code: 'K' }, mount: { id: 'mount-demo', label: 'Invented mount S' }, grain: { id: 'grain-demo', number: 3 }, spot: { id: 'spot-demo', label: 'S 1' } })).toBe('Sample Invented sample (DEMO-2026) · Set Krogh K · Mount Invented mount S · Spot S 1 · Grain 3');
  expect(resolvedReferences({ sample_id: 'invented-id', grain: { id: 'invented-id' } })).toBe('No named references supplied');
  expect(pickNoteResult({ status: 'ok', kind: 'pick', code: 'ok' })).toBe('ok · pick');
  expect(pickNoteResult({ status: 'ok', kind: 'pick', code: 'pick_ok' })).toBe('ok · pick');
  expect(pickNoteResult({ status: 'ignored', kind: 'ignored', code: 'ignored' })).toBe('ignored');
  expect(pickNoteResult({ status: 'refused', kind: 'pick', code: 'capsule_taken' })).toBe('refused · pick · capsule taken');
  expect(planBatchName(plan.batches[0], [batch.capsule_set])).toBe('Krogh (K) · 2026-11-06');
  expect(planRecipeName({ id: recipe.id }, [recipe])).toBe(recipe.name);
  expect(planRecipeName({ id: 'unknown' }, [])).toBe('Recipe name unavailable');
  const account = { id: 'operator-demo', username: 'analyst', display_name: 'Invented analyst' };
  expect(operatorName({ operator_name: 'Recorded operator', operator_id: account.id }, account)).toBe('Recorded operator');
  expect(operatorName({ operator_name: '', operator_id: account.id }, account)).toBe('Invented analyst');
  expect(operatorName({ operator_name: '', operator_id: account.id }, null, [account])).toBe('Invented analyst');
  expect(operatorName({ operator_name: '', operator_id: 'unknown' }, account)).toBe('Operator not recorded');
  expect(spikeVersionName(version.id, solutions)).toBe('Synthetic spike · Master · v1 (superseded)');
  expect(spikeVersionName(version.id, [], version)).toBe('Synthetic spike · Master · v1 (superseded)');
});
