import type { BatchDetail, FractionStepRecord, ParameterDefinition, Parameters, PickNotePlan, RecipeStep } from './tims-api';
import { plural } from './plural';
export const fractionStatuses = ['picked', 'transferred', 'abraded', 'spiked', 'dissolved', 'columns', 'loaded', 'measured', 'lost', 'dissolved_in_ca'] as const;
export const minerals = ['zircon', 'titanite', 'rutile', 'apatite', 'monazite', 'xenotime', 'baddeleyite', 'other'] as const;
export const parameterKey = (d: ParameterDefinition) => d.config_key ?? d.name;
export const choices = (d: ParameterDefinition) => (d.choices ?? []).map(c => typeof c === 'object' ? c : { value: c, label: String(c).replaceAll('_', ' ') });
export function parameterDefinitions(defs: ParameterDefinition[], fraction = false) {
  return defs.filter(d => d.role !== 'outcome' && (fraction || d.scope !== 'fraction'));
}
export function parameterValue(d: ParameterDefinition, input: string): unknown {
  if (input === '') return undefined;
  if (d.type === 'number' || d.type === 'integer') return Number(input);
  if (d.type === 'choice') return choices(d).find(c => String(c.value) === input)?.value ?? input;
  return input;
}
export function validateParameters(defs: ParameterDefinition[], values: Parameters, partial = false): string[] {
  return defs.flatMap(d => {
    const v = values[parameterKey(d)];
    if (v === undefined || v === null || v === '') return d.required && !partial ? [`${d.meaning ?? d.name} is required.`] : [];
    const allowed = choices(d).map(c => c.value);
    if (d.type === 'number' || d.type === 'integer') {
      if (typeof v !== 'number' || !Number.isFinite(v) || d.type === 'integer' && !Number.isInteger(v)) return [`${d.name} needs a ${d.type}.`];
      if (d.min !== undefined && v < d.min || d.max !== undefined && v > d.max) return [`${d.name} is outside the allowed range.`];
    }
    if (d.type === 'choice' && !allowed.includes(v as string | number)) return [`${d.name} needs a listed choice.`];
    if (d.type === 'multi_choice' && (!Array.isArray(v) || v.some(x => !allowed.includes(x)))) return [`${d.name} needs listed choices.`];
    return [];
  });
}
export function withDefaults(defs: ParameterDefinition[], values: Parameters = {}): Parameters {
  return { ...Object.fromEntries(parameterDefinitions(defs).filter(d => d.default !== undefined).map(d => [parameterKey(d), structuredClone(d.default)])), ...values };
}
export function effectiveParameters(batch: Parameters, record?: Pick<FractionStepRecord, 'parameters'>) {
  return Object.entries({ ...batch, ...record?.parameters }).map(([key, value]) => ({ key, value, overridden: Object.hasOwn(record?.parameters ?? {}, key) }));
}
export interface BatchFilters { capsule_set: string; started_after: string; started_before: string; status: string }
export const emptyBatchFilters = (): BatchFilters => ({ capsule_set: '', started_after: '', started_before: '', status: '' });
export const batchQuery = (lab: string, filters: BatchFilters) => Object.fromEntries(Object.entries({ lab, ...filters }).filter(([, v]) => !!v));
export const preferenceKey = (server: string, account: string) => `upbstudio.tims:${JSON.stringify([server, account])}`;
export function reorder<T>(rows: T[], index: number, direction: number): T[] {
  const next = [...rows], target = index + direction;
  if (target < 0 || target >= rows.length) return next;
  [next[index], next[target]] = [next[target], next[index]]; return next;
}
export function planSummary(plan: PickNotePlan) {
  const picks = plan.lines.filter(l => l.kind === 'pick' && l.status === 'ok' && !l.resolved.fraction_id);
  return { batches: plan.batches.filter(b => b.action === 'create').length, fractions: picks.length,
    sources: picks.filter(l => l.resolved.grain || l.resolved.grain_id || l.resolved.spot || l.resolved.spot_id).length,
    refused: plan.lines.filter(l => l.status === 'refused').length };
}
export const planSentence = (plan: PickNotePlan) => { const s = planSummary(plan); return `${plural(s.batches, 'batch', 'batches')}, ${plural(s.fractions, 'fraction')}, ${plural(s.sources, 'source')}`; };
export function historyChanges(row: Record<string, unknown>): string[] {
  const before = row.before as Parameters | undefined, after = row.after as Parameters | undefined;
  if (!before && !after) return ['The server did not supply before and after values.'];
  const word = (v: unknown): string => v === undefined || v === null ? 'not recorded' : typeof v === 'object' ? JSON.stringify(v) : String(v).replaceAll('_', ' ');
  return [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter(k => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]))
    .map(k => `${k.replaceAll('_', ' ')}: ${word(before?.[k])} → ${word(after?.[k])}`);
}
export function snapshotName(batch: BatchDetail, recipes: { id: string; name: string }[]) {
  const recipe = recipes.find(r => r.id === batch.recipe_id);
  return batch.recipe_name ?? (recipe ? `${recipe.name} (current recipe name; snapshot name unavailable)` : undefined) ?? (batch.recipe_id ? 'Recipe snapshot (name not supplied)' : 'No recipe');
}
export interface MethodCode { code: string; name: string; level: string; status: string; parameters: ParameterDefinition[] }
export const recipeParameters = (step: RecipeStep, methods: MethodCode[]) => methods.find(m => m.code === step.method_code)?.parameters ?? [];
