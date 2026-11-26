import { expect, it } from 'vitest';
import { batch, recipe } from '../../tests/fixtures/tims';
import { batchHeaderSteps, recipeHeaderMeta } from './tims-header';
import { batchReadiness } from './tims-readiness';
import type { BatchReadiness } from './tims-api';

it('uses the supplied readiness totals and gives current precedence over done', () => {
  const readiness: BatchReadiness = { capsules: [], totals: { capsules: 7, grain: 15, spike: 7, ready: 6, pending: 1 } };
  const steps = batchHeaderSteps(batch, readiness, 2);
  expect(steps.map(s => s.label)).toEqual(['Setup', 'Grains', 'Spike', 'Chemistry', 'Review']);
  expect(steps[0]).toMatchObject({ fullName: 'Batch & capsule set', detail: 'Done', state: 'done' });
  expect(steps[1]).toMatchObject({ detail: '15 of 15', state: 'done' });
  expect(steps[2]).toMatchObject({ detail: '7 of 7', state: 'current' });
  expect(steps[2].hint).toContain('weighed mass');
  expect(steps[4]).toMatchObject({ fullName: 'Review & complete', detail: '6 of 7 complete', state: 'pending' });
  expect(steps.filter(s => s.hint)).toHaveLength(1);
});
it('checks setup by capsule set, date and operator, accepting an account or a name', () => {
  const readiness = batchReadiness(batch);
  for (const missing of [{ capsule_set_id: '' }, { started_on: '' }, { operator_id: null, operator_name: '  ' }]) {
    expect(batchHeaderSteps({ ...batch, ...missing }, readiness, 4)[0]).toMatchObject({ state: 'pending', detail: 'Check' });
  }
  expect(batchHeaderSteps({ ...batch, operator_id: 'invented', operator_name: '' }, readiness, 4)[0].detail).toBe('Done');
});
it('counts each live mapped capsule once for chemistry, excluding spike records', () => {
  const copy = structuredClone(batch);
  const chemistry = copy.steps.find(s => s.method_code !== 'SP-TIMS-SPIKE')!;
  const record = copy.fraction_step_records[0];
  copy.fraction_step_records = [
    { ...record, step_id: chemistry.id, fraction_id: copy.fractions[0].id },
    { ...record, id: 'duplicate', step_id: chemistry.id, fraction_id: copy.fractions[0].id },
    { ...record, id: 'spike', step_id: 'spike-step', fraction_id: copy.fractions[1].id },
    { ...record, id: 'unmapped', step_id: chemistry.id, fraction_id: 'not-live' },
  ];
  expect(batchHeaderSteps(copy, batchReadiness(copy), 0)[3]).toMatchObject({ detail: '1 of 2 recorded', state: 'pending' });
  copy.fraction_step_records.push({ ...record, id: 'second', step_id: chemistry.id, fraction_id: copy.fractions[1].id });
  expect(batchHeaderSteps(copy, batchReadiness(copy), 0)[3]).toMatchObject({ detail: '2 of 2 recorded', state: 'done' });
  copy.fractions[1].retired_at = '2026-11-25T00:00:00Z';
  expect(batchHeaderSteps(copy, batchReadiness(copy), 0)[3]).toMatchObject({ detail: '1 of 1 recorded', state: 'done' });
});
it('distinguishes absent chemistry steps from chemistry without capsule records', () => {
  const readiness = batchReadiness(batch);
  expect(batchHeaderSteps({ ...batch, steps: [] }, readiness, 0)[3]).toMatchObject({ detail: 'Not started', state: 'pending' });
  expect(batchHeaderSteps({ ...batch, fraction_step_records: [] }, readiness, 0)[3]).toMatchObject({ detail: 'In progress', state: 'pending' });
  expect(batchHeaderSteps({ ...batch, fraction_step_records: [{ ...batch.fraction_step_records[0], step_id: 'spike-step' }] }, readiness, 0)[3]).toMatchObject({ detail: '0 of 2 recorded', state: 'pending' });
});
it('keeps the stored snapshot name and moves current-name provenance into info', () => {
  expect(recipeHeaderMeta({ ...batch, recipe_name: 'Stored recipe' }, [recipe])).toEqual({ text: 'Stored recipe' });
  expect(recipeHeaderMeta({ ...batch, recipe_name: undefined, recipe_id: recipe.id }, [recipe])).toEqual({ text: recipe.name, info: '(current recipe name; snapshot name unavailable)' });
  expect(recipeHeaderMeta({ ...batch, recipe_name: undefined, recipe_id: null }, [recipe])).toEqual({ text: 'No recipe' });
  expect(recipeHeaderMeta({ ...batch, recipe_name: undefined, recipe_id: recipe.id }, [])).toEqual({ text: 'Recipe snapshot (name not supplied)' });
});

it('does not mark Spike or Review done for a batch without capsules', () => {
  const readiness: BatchReadiness = { capsules: [], totals: { capsules: 0, grain: 0, spike: 0, ready: 0, pending: 0 } };
  const steps = batchHeaderSteps(batch, readiness, 0);
  expect(steps[2]).toMatchObject({ detail: '0 of 0', state: 'pending' });
  expect(steps[4]).toMatchObject({ detail: '0 of 0 complete', state: 'pending' });
});
