import { parameterSummary, statusWords, type BatchDetail, type FractionOut } from './tims-api';
import { readCapsuleNotes, readColumnNotes } from './tims-protocol';
import { readSpikingSession, spikingSessionId } from './tims-spiking';
export function fractionChemistry(batch: BatchDetail, fraction: FractionOut) {
  return batch.steps.filter(step => spikingSessionId(step) === step.id ||
    batch.spikes.some(row => row.step_id === step.id && row.fraction_id === fraction.id)).map(step => {
    const record = batch.fraction_step_records.find(r => r.fraction_id === fraction.id && r.step_id === step.id);
    const addition = batch.spikes.find(r => r.fraction_id === fraction.id && r.step_id === step.id);
    const parameters = { ...step.parameters, ...record?.parameters };
    const versionId = addition?.spike_version_id ?? parameters.spike_version;
    const version = typeof versionId === 'string' ? batch.spike_versions[versionId] : undefined;
    const values = Object.entries(parameters).filter(([key]) => key !== 'spike_version').map(([key, value]) => {
      const def = step.parameter_definitions.find(d => (d.config_key ?? d.name) === key) ?? { name: key };
      return parameterSummary(def, value);
    });
    if (addition) {
      values.push(`Spike weight: ${addition.spike_weight_g} g`);
      if (addition.bottle_before_g !== null) values.push(`Bottle before: ${addition.bottle_before_g} g`);
      if (addition.bottle_after_g !== null) values.push(`Bottle after: ${addition.bottle_after_g} g`);
      if (addition.notes) values.push(`Spike comment: ${addition.notes}`);
    }
    const column = step.method_code === 'SP-TIMS-COL';
    const parent = spikingSessionId(step);
    const root = parent === step.id ? step : batch.steps.find(s => s.id === parent);
    const session = step.method_code === 'SP-TIMS-SPIKE' && root ? readSpikingSession(root.notes) : null;
    const bottle = session?.bottles.find(b => b.versionId === versionId || b.bottleId === version?.subfraction_id);
    if (bottle) values.push(`Session bottle begin: ${bottle.before} g`);
    if (!session?.bottles.length && session?.before) values.push(`Session bottle begin: ${session.before} g`);
    if (!session?.bottles.length && session?.after) values.push(`Session bottle end: ${session.after} g`);
    const capsule = readCapsuleNotes(column ? readColumnNotes(record?.outcome_note ?? '').notes : record?.outcome_note ?? '');
    return { id: step.id, name: parent === step.id ? step.method_name : `${step.method_name} · additional entry`, values, skipped: record?.skipped ?? false,
      outcome: record?.outcome ? statusWords(record.outcome) : '', outcomeNote: capsule.notes,
      note: column ? readColumnNotes(step.notes).notes : session?.notes ?? step.notes, performedOn: capsule.date || (root ?? step).performed_on,
      spike: version ? `${version.solution_name} · ${version.subfraction_name} · ${version.version} · ${version.is_current ? 'current' : statusWords(version.status)}` : bottle ? bottle.label
        : versionId ? 'Spike version details unavailable in this batch reply' : '',
    };
  });
}

export function spikeVersionName(id: string, solutions: import('./tims-api').SpikeSolution[], detail?: import('./tims-api').VersionOut | null): string {
  if (!id) return '';
  if (detail?.id === id) return `${detail.solution_name} · ${detail.subfraction_name} · ${detail.version} (${detail.status})`;
  for (const solution of solutions) for (const sub of solution.subfractions) {
    const version = sub.versions.find(v => v.id === id);
    if (version) return `${solution.name} · ${sub.name} · ${version.version} (${version.status})`;
  }
  return '';
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (...values: unknown[]): string => {
  const value = values.find(v => (typeof v === 'string' && v.trim() && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v)) || typeof v === 'number');
  return value === undefined ? '' : String(value);
};
const named = (value: unknown) => { const row = object(value); return text(row.name, row.label, row.code, row.number, value); };
export function resolvedReferences(resolved: Record<string, unknown>): string {
  const sample = object(resolved.sample), project = object(resolved.project ?? sample.project);
  const sampleName = named(sample) || text(resolved.sample_name);
  const projectName = text(project.code, project.name, resolved.project_code, sample.project_code, resolved.project, sample.project);
  const refs = [sampleName ? `Sample ${sampleName}${projectName ? ` (${projectName})` : ''}` : ''];
  for (const [key, label] of [['set', 'Set'], ['mount', 'Mount'], ['spot', 'Spot'], ['grain', 'Grain']] as const) {
    const row = resolved[key] ?? (key === 'set' ? resolved.capsule_set : undefined);
    let name = named(row) || text(resolved[`${key}_label`], resolved[`${key}_name`], key === 'grain' ? resolved.grain_number : undefined);
    const code = text(object(row).code);
    if (key === 'set' && name && code && code !== name) name += ` ${code}`;
    if (name) refs.push(`${label} ${name}`);
  }
  if (text(resolved.capsule_label)) refs.push(`Capsule ${text(resolved.capsule_label)}`);
  if (text(resolved.fraction_name)) refs.push(`Fraction ${text(resolved.fraction_name)}`);
  return refs.filter(Boolean).join(' · ') || 'No named references supplied';
}
export function pickNoteResult(line: Pick<import('./tims-api').PickNoteLine, 'status' | 'kind' | 'code'>): string {
  const parts = [...new Set([line.status, line.kind].map(statusWords))];
  const code = statusWords(line.code), words = new Set(parts.flatMap(part => part.split(' ')));
  if (code && code.split(' ').some(word => !words.has(word))) parts.push(code);
  return parts.join(' · ');
}
export function planBatchName(batch: import('./tims-api').PickNotePlan['batches'][number], sets: import('./tims-api').CapsuleOut[], plan?: import('./tims-api').PickNotePlan, includeCode = true): string {
  const set = sets.find(s => s.id === batch.set_id);
  const resolved = plan?.lines.map(l => object(l.resolved.set ?? l.resolved.capsule_set)).find(s => s.id === batch.set_id);
  const name = set ? set.name + (includeCode ? ` (${set.code})` : '') : named(resolved) || 'Capsule set name unavailable';
  return `${name} · ${batch.started_on}`;
}
export function planRecipeName(recipe: Record<string, unknown> | null, recipes: import('./tims-api').RecipeOut[]): string {
  return recipe ? text(recipe.name) || recipes.find(r => r.id === recipe.id)?.name || 'Recipe name unavailable' : 'No recipe';
}
export function operatorName(batch: Pick<import('./tims-api').BatchOut, 'operator_name' | 'operator_id'>, account: { id?: string; display_name?: string; username: string } | null, accounts: { id?: string; display_name?: string; username: string }[] = []): string {
  const match = batch.operator_id ? (account?.id === batch.operator_id ? account : accounts.find(a => a.id === batch.operator_id)) : undefined;
  return batch.operator_name || match?.display_name || match?.username || 'Operator not recorded';
}
