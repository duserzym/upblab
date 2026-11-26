import type { BatchDetail, BatchReadiness, RecipeOut } from './tims-api';
import { guidedSteps, type GuidedStep } from './tims-guidance';
import type { WorkflowStep } from './ui-controls';

export function recipeHeaderMeta(batch: BatchDetail, recipes: Pick<RecipeOut, 'id' | 'name'>[]) {
  if (batch.recipe_name != null) return { text: batch.recipe_name };
  const recipe = recipes.find(r => r.id === batch.recipe_id);
  if (recipe) return { text: recipe.name, info: '(current recipe name; snapshot name unavailable)' };
  return { text: batch.recipe_id ? 'Recipe snapshot (name not supplied)' : 'No recipe' };
}

/** Presentation counts only: readiness totals and records already in batch detail. */
export function batchHeaderSteps(batch: BatchDetail, readiness: BatchReadiness, current: GuidedStep): WorkflowStep[] {
  const totals = readiness.totals;
  const setup = !!batch.capsule_set_id && !!batch.started_on && !!(batch.operator_id || batch.operator_name.trim());
  const chemistry = new Set(batch.steps.filter(s => s.method_code !== 'SP-TIMS-SPIKE').map(s => s.id));
  const mapped = new Set(Object.values(batch.capsule_map));
  const live = new Set(batch.fractions.filter(f => !f.retired_at && mapped.has(f.id)).map(f => f.id));
  const recorded = new Set(batch.fraction_step_records.filter(r => chemistry.has(r.step_id) && live.has(r.fraction_id)).map(r => r.fraction_id)).size;
  const hasRecords = batch.fraction_step_records.length > 0;
  const details = [setup ? 'Done' : 'Check', `${totals.grain} of ${batch.capsule_set.positions}`,
    `${totals.spike} of ${totals.capsules}`,
    !chemistry.size ? 'Not started' : hasRecords ? `${recorded} of ${live.size} recorded` : 'In progress',
    `${totals.ready} of ${totals.capsules} complete`];
  const done = [setup, totals.grain === batch.capsule_set.positions, totals.capsules > 0 && totals.spike === totals.capsules,
    chemistry.size > 0 && hasRecords && live.size > 0 && recorded === live.size, totals.capsules > 0 && totals.ready === totals.capsules];
  const labels = ['Setup', 'Grains', 'Spike', 'Chemistry', 'Review'];
  const hints = ['Check the capsule set, batch date, operator and recipe above.', 'Assign each capsule, then continue to Spike.',
    'Save a spike version and weighed mass for every capsule.', 'Use Batch steps and the matrix for chemistry records.',
    'Check that every capsule is complete, then complete the batch.'];
  return guidedSteps.map((fullName, i) => ({ label: labels[i], fullName, detail: details[i],
    state: i === current ? 'current' : done[i] ? 'done' : 'pending', hint: i === current ? hints[i] : undefined }));
}
