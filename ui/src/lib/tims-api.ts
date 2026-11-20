import { identity } from './identity.svelte';
import { listPath, type ListPath } from './api-list';
import { apiReplyMessage, ApiReadError } from './server-error';
import { timsRights } from './tims-rights.svelte';
import { oversight } from './oversight.svelte';
import { outbox, onlineOnlyReason } from './outbox.svelte';
export interface BaseOut { id: string; created_at: string; updated_at: string; created_by_id: string | null }
export type Mineral = 'zircon' | 'baddeleyite' | 'titanite' | 'rutile' | 'apatite' | 'monazite' | 'xenotime' | 'other';
export type FractionStatus = 'picked' | 'transferred' | 'abraded' | 'spiked' | 'dissolved' | 'columns' | 'loaded' | 'measured' | 'lost' | 'dissolved_in_ca';
export interface SourceOut extends BaseOut { grain_id: string | null; atlas_grain_id: string | null; spot_id: string | null; atlas_spot_id: string | null; spot_label: string | null; mount_label?: string | null; grain_label?: string | null; mount_id: string | null; is_fragment: boolean; fragment_note: string; note: string; retired_at: string | null }
export interface FractionOut extends BaseOut { lab_id: string; name: string; sample: { id: string; name: string }; mineral: Mineral; status: FractionStatus; batch_id: string | null; capsule_number: number | null; capsule_label: string | null; capsule_set_name: string | null; notes: string; retired_at: string | null; retired_by_id: string | null; sources: SourceOut[] }
export interface CapsuleOut extends BaseOut { lab_id: string; facility: string; name: string; code: string; positions: number; positions_per_puck: number; active: boolean; notes: string; capsule_labels: string[] }
export type Parameters = Record<string, unknown>;
export interface RecipeStep { method_code: string; parameters: Parameters }
export interface RecipeOut extends BaseOut { lab_id: string; mineral: Mineral; name: string; steps: RecipeStep[]; active: boolean; notes: string; revision: number }
export interface BatchOut extends BaseOut { lab_id: string; capsule_set_id: string; started_on: string; operator_id: string | null; operator_name: string; recipe_id: string | null; recipe_snapshot: RecipeStep[]; recipe_name?: string | null; fraction_count?: number; capsule_set_name?: string; capsule_set_code?: string; notes: string; retired_at: string | null }
export interface ParameterDefinition { name: string; config_key?: string; meaning?: string; unit?: string | null; type?: string; choices?: (string | number | { value: string | number; label?: string })[]; default?: unknown; min?: number; max?: number; required?: boolean; scope?: 'batch' | 'fraction'; role?: 'parameter' | 'outcome' }
export interface StepOut extends BaseOut { batch_id: string; ordinal: number; method_code: string; method_name: string; parameters: Parameters; parameter_definitions: ParameterDefinition[]; performed_on: string | null; notes: string }
export interface FractionStepRecord extends BaseOut { fraction_id: string; step_id: string; parameters: Parameters; skipped: boolean; outcome: string; outcome_note: string }
export interface SpikeAddition extends BaseOut { fraction_id: string; step_id: string; spike_version_id: string; spike_weight_g: string; bottle_before_g: string | null; bottle_after_g: string | null; bottle_difference_g: string | null; notes: string; warnings: string[] }
export type VersionStatus = 'current' | 'superseded' | 'withdrawn';
export interface CompactVersion { id: string; version: string; status: VersionStatus; source: string; source_display: string; content_sha256: string }
export interface SpikeSubfraction extends BaseOut { lab_id: string | null; origin: string; sub_id: string; name: string; notes: string; versions: CompactVersion[] }
export interface SpikeSolution extends BaseOut { registry_id: string; name: string; aliases: string[]; spike_type: string; isotopes: string[]; description: string; origin: string; lab_id: string | null; active: boolean; subfractions: SpikeSubfraction[] }
export interface CompositionValue { value: number; unit?: 'mol/g'; uncertainty?: number; uncertainty_type?: '1sd_rel_pct' | '2sd_rel_pct' | '1sd_abs' | '2sd_abs' }
export interface Composition { concentrations: Record<string, CompositionValue>; ratios: Record<string, CompositionValue> }
export interface VersionOut extends BaseOut { solution_id: string; registry_id: string; solution_name: string; subfraction_id: string; subfraction: string; subfraction_name: string; version: string; status: VersionStatus; supersedes_id: string | null; calibrated: string; source: string; source_display: string; locator: string; notes: string; composition: Composition; content_sha256: string; registry_revision: string; is_current: boolean }
export interface BatchDetail extends BatchOut { capsule_set: CapsuleOut; steps: StepOut[]; capsule_map: Record<string, string | null>; fractions: FractionOut[]; fraction_step_records: FractionStepRecord[]; spikes: SpikeAddition[]; spike_versions: Record<string, VersionOut> }
export interface PickNoteRequest { text: string; lab_id: string; first_line?: number; last_line?: number; filename?: string; started_on?: string }
export interface PickNoteLine { number: number; text: string; kind: 'date' | 'set_heading' | 'sample_heading' | 'pick' | 'ignored'; parsed: Parameters; resolved: Parameters; status: 'ok' | 'refused' | 'skipped' | 'ignored'; code: string; message: string; refusals: { code: string; message: string }[]; normalisations: string[] }
export interface PickNotePlan { lab_id: string; filename: string; first_line: number; last_line: number; lines: PickNoteLine[]; summary: Record<string, number>; batches: { set_id: string; started_on: string; action: 'create' | 'reuse'; id: string | null; recipe: Parameters | null; explanation?: string }[] }
export interface HistoryRow { id: string; [key: string]: unknown }
export interface SourceInput { grain_id?: string; spot_id?: string; is_fragment?: boolean; fragment_note?: string; note?: string }
export interface FractionInput { sample_id: string; mineral: Mineral; name?: string; lab_id?: string; batch_id?: string | null; capsule_number?: number | null; status?: FractionStatus; notes?: string; sources?: SourceInput[] }
export type FractionPatch = Partial<Pick<FractionOut, 'name' | 'mineral' | 'batch_id' | 'capsule_number' | 'status' | 'notes'>>;
export type CapsuleInput = Pick<CapsuleOut, 'lab_id' | 'name'> & Partial<Pick<CapsuleOut, 'facility' | 'code' | 'positions' | 'positions_per_puck' | 'active' | 'notes'>>;
export type CapsulePatch = Partial<Pick<CapsuleOut, 'name' | 'code' | 'positions' | 'active' | 'notes'>>;
export type RecipeInput = Pick<RecipeOut, 'lab_id' | 'mineral' | 'name'> & Partial<Pick<RecipeOut, 'steps' | 'active' | 'notes'>>;
export type RecipePatch = Partial<Pick<RecipeOut, 'mineral' | 'name' | 'steps' | 'active' | 'notes'>>;
export type BatchInput = Pick<BatchOut, 'capsule_set_id' | 'started_on'> & Partial<Pick<BatchOut, 'operator_id' | 'operator_name' | 'recipe_id' | 'notes'>>;
export type BatchPatch = Partial<Pick<BatchOut, 'started_on' | 'operator_id' | 'operator_name' | 'notes' | 'retired_at'>>;
export interface StepInput { method_code: string; parameters?: Parameters; performed_on?: string | null; notes?: string }
export interface RecordInput { parameters?: Parameters; skipped?: boolean; outcome?: string; outcome_note?: string }
export interface SpikeInput { spike_version_id?: string; spike_weight_g: string; bottle_before_g?: string | null; bottle_after_g?: string | null; notes?: string }
export interface VersionInput { lab_id?: string; subfraction?: string; subfraction_name?: string; version: string; supersedes_id?: string | null; status?: VersionStatus; calibrated?: string; source?: string; source_display?: string; locator?: string; notes?: string; composition: Composition }
export interface SolutionInput { lab_id: string; registry_id: string; name: string; spike_type: string; aliases?: string[]; isotopes?: string[]; description?: string; first_version: VersionInput }
export interface ListPage<T> { items: T[]; nextCursor: string | null; more(): Promise<ListPage<T> | null> }
export class TimsReadError extends ApiReadError {}
const readScope = () => JSON.stringify([identity.target?.server, identity.account?.id ?? identity.account?.username, identity.revision]);
export async function read<T>(path: string): Promise<T> {
  const source = readScope();
  const reply = await identity.get<T>(path);
  if (source !== readScope()) throw new Error('The account or server changed during the request.');
  if (reply.status !== 200) throw new TimsReadError(reply.status, reply.body, apiReplyMessage(reply));
  return reply.body;
}
/** First page is ready independently; each more() consumes one opaque cursor once. */
export async function firstPage<T>(path: ListPath, filters: Record<string, string> = {}, cursor?: string): Promise<ListPage<T>> {
  const source = readScope();
  const reply = await identity.get<T[]>(listPath(path, cursor, filters));
  if (source !== readScope()) throw new Error('The account or server changed during the request.');
  if (reply.status !== 200 || !Array.isArray(reply.body)) throw new TimsReadError(reply.status, reply.body, apiReplyMessage(reply));
  let more: Promise<ListPage<T> | null> | undefined;
  const nextCursor = reply.nextCursor ?? null;
  if (nextCursor && nextCursor === cursor) throw new Error('The server repeated a list cursor.');
  return { items: reply.body, nextCursor, more: () => {
    if (source !== readScope()) return Promise.reject(new Error('The account or server changed. Reload this list.'));
    return more ??= nextCursor ? firstPage<T>(path, filters, nextCursor).catch(error => { more = undefined; throw error; }) : Promise.resolve(null);
  } };

}
export interface BoundedFractions { items: FractionOut[]; truncated: boolean; showing: string }
export async function mountFractions(mount: string, maximum = 10_000, progress?: (value: BoundedFractions) => void): Promise<BoundedFractions> {
  if (!Number.isInteger(maximum) || maximum < 1) throw new Error('A positive fraction limit is required.');
  let page: ListPage<FractionOut> | null = await firstPage('/v1/fractions', { mount, limit: '500' });
  const items = new Map<string, FractionOut>(), seen = new Set<string>();
  let truncated = false;
  while (page) {
    for (const item of page.items) { if (items.size >= maximum && !items.has(item.id)) { truncated = true; break; } items.set(item.id, item); }
    if (items.size >= maximum && page.nextCursor) truncated = true;
    const value = { items: [...items.values()], truncated, showing: truncated ? `Showing first ${items.size} fractions` : '' };
    progress?.(value);
    if (truncated || !page.nextCursor) return value;
    if (seen.has(page.nextCursor)) throw new Error('The server repeated a list cursor.');
    seen.add(page.nextCursor); page = await page.more();
  }
  return { items: [...items.values()], truncated, showing: '' };
}
const id = encodeURIComponent;
const batchPath = (batch: string) => `/v1/tims/batches/${id(batch)}`;
const stepPath = (batch: string, step: string) => `${batchPath(batch)}/steps/${id(step)}`;
const recordPath = (batch: string, fraction: string, step: string) => `${batchPath(batch)}/fractions/${id(fraction)}/steps/${id(step)}`;
function edit(objectKey: string, path: string, body: unknown, method: 'PATCH' | 'PUT' = 'PATCH') {
  oversight.assertWritable(path);
  const reason = timsRights.recordReason(objectKey); if (reason) throw new Error(reason);
  return outbox.enqueue({ objectKey, path, body, method });
}
/** Retain one form per exact input across manual retries; changing input needs a new form/key. */
export function onlineForm<T>(path: string, method: 'POST' | 'DELETE', body?: unknown, objectKey?: string) {
  const source = () => JSON.stringify([identity.target?.server, identity.account?.id ?? identity.account?.username, identity.revision]);
  const owner = source(), idempotencyKey = crypto.randomUUID(), payload = body === undefined ? undefined : structuredClone(body);
  return { idempotencyKey, get disabledReason() { return onlineOnlyReason(); }, send: async () => {
    if (source() !== owner) throw new Error('The account or server changed. Open this form again.');
    const recordReason = objectKey ? timsRights.recordReason(objectKey) : ''; if (recordReason) throw new Error(recordReason);
    const reason = onlineOnlyReason(); if (reason) throw new Error(reason);
    try {
      const reply = await identity.write<T>(path, method, payload, { idempotencyKey });
      if (source() !== owner) throw new Error('The account or server changed during the request.');
      return reply.body;
    }
    catch (error) { if (objectKey && source() === owner) timsRights.reject(objectKey, error); throw error; }
  } };
}
export const tims = {
  fractions: (filters: Record<string, string> = {}) => firstPage<FractionOut>('/v1/fractions', filters),
  grainFractions: (grain: string, atlas = false) => firstPage<FractionOut>(`/v1/grains/${atlas ? 'by-atlas/' : ''}${id(grain)}/fractions`),
  spotFractions: (spot: string, atlas = false) => firstPage<FractionOut>(`/v1/spots/${atlas ? 'by-atlas/' : ''}${id(spot)}/fractions`),
  fraction: (fraction: string) => read<FractionOut>(`/v1/fractions/${id(fraction)}`),
  suggestName: (sample: string, mineral: Mineral) => read<{ suggestion: string }>(`/v1/fractions/suggest-name?${new URLSearchParams({ sample, mineral })}`),
  createFraction: (body: FractionInput) => onlineForm<FractionOut>('/v1/fractions', 'POST', body),
  patchFraction: (fraction: string, body: FractionPatch) => edit(`fraction:${fraction}`, `/v1/fractions/${id(fraction)}`, body),
  retireFraction: (fraction: string) => onlineForm<FractionOut>(`/v1/fractions/${id(fraction)}/retire`, 'POST', {}, `fraction:${fraction}`),
  addSource: (fraction: string, body: SourceInput) => onlineForm<SourceOut>(`/v1/fractions/${id(fraction)}/sources`, 'POST', body, `fraction:${fraction}`),
  retireSource: (fraction: string, source: string) => onlineForm<SourceOut>(`/v1/fractions/${id(fraction)}/sources/${id(source)}/retire`, 'POST', {}, `fraction:${fraction}`),
  capsuleSets: (filters: Record<string, string> = {}) => firstPage<CapsuleOut>('/v1/tims/capsule-sets', filters),
  suggestCode: (lab: string, name: string) => read<{ suggestion: string }>(`/v1/tims/capsule-sets/suggest-code?${new URLSearchParams({ lab, name })}`),
  createCapsuleSet: (body: CapsuleInput) => onlineForm<CapsuleOut>('/v1/tims/capsule-sets', 'POST', body),
  patchCapsuleSet: (capsule: string, body: CapsulePatch) => edit(`capsule_set:${capsule}`, `/v1/tims/capsule-sets/${id(capsule)}`, body),
  recipes: (filters: Record<string, string> = {}) => firstPage<RecipeOut>('/v1/tims/recipes', filters),
  recipe: (recipe: string) => read<RecipeOut>(`/v1/tims/recipes/${id(recipe)}`),
  createRecipe: (body: RecipeInput) => onlineForm<RecipeOut>('/v1/tims/recipes', 'POST', body),
  patchRecipe: (recipe: string, body: RecipePatch) => edit(`recipe:${recipe}`, `/v1/tims/recipes/${id(recipe)}`, body),
  batches: (filters: Record<string, string> = {}) => firstPage<BatchOut>('/v1/tims/batches', filters),
  batch: (batch: string) => read<BatchDetail>(batchPath(batch)),
  createBatch: (body: BatchInput) => onlineForm<BatchDetail>('/v1/tims/batches', 'POST', body),
  patchBatch: (batch: string, body: BatchPatch) => edit(`batch:${batch}`, batchPath(batch), body),
  createStep: (batch: string, body: StepInput) => onlineForm<StepOut>(`${batchPath(batch)}/steps`, 'POST', body),
  patchStep: (batch: string, step: string, body: Partial<StepInput>) => edit(`batch:${batch}`, stepPath(batch, step), body),
  deleteStep: (batch: string, step: string) => onlineForm<{ deleted: boolean }>(stepPath(batch, step), 'DELETE', undefined, `batch:${batch}`),
  orderSteps: (batch: string, step_ids: string[]) => edit(`batch:${batch}`, `${batchPath(batch)}/steps/order`, { step_ids }, 'PUT'),
  putRecord: (batch: string, fraction: string, step: string, body: RecordInput) => edit(`batch:${batch}`, recordPath(batch, fraction, step), body, 'PUT'),
  putSpike: (batch: string, fraction: string, step: string, body: SpikeInput) => edit(`batch:${batch}`, `${recordPath(batch, fraction, step)}/spike`, body, 'PUT'),
  spikes: (filters: Record<string, string> = {}) => firstPage<SpikeSolution>('/v1/tims/spikes', filters),
  version: (version: string) => read<VersionOut>(`/v1/tims/spikes/versions/${id(version)}`),
  createSpike: (body: SolutionInput) => onlineForm<SpikeSolution>('/v1/tims/spikes', 'POST', body),
  createVersion: (solution: string, body: VersionInput) => onlineForm<VersionOut>(`/v1/tims/spikes/${id(solution)}/versions`, 'POST', body),
  patchVersion: (version: string, body: { status?: VersionStatus; notes?: string }) => edit(`spike_version:${version}`, `/v1/tims/spikes/versions/${id(version)}`, body),
  previewNotes: (body: PickNoteRequest) => onlineForm<PickNotePlan>('/v1/tims/pick-notes/preview', 'POST', body),
  importNotes: (body: PickNoteRequest & { status?: FractionStatus }) => onlineForm<{ plan: PickNotePlan; created: Record<string, string[]> }>('/v1/tims/pick-notes/import', 'POST', body),
  history: (kind: 'fraction' | 'batch' | 'capsule_set' | 'recipe' | 'spike_solution' | 'spike_version', object: string) => firstPage<HistoryRow>(`/v1/history/${kind}/${id(object)}`),
};
export const capsuleLabel = (fraction: Pick<FractionOut, 'capsule_label'>) => fraction.capsule_label ?? 'No capsule';
export const statusWords = (value: string) => value === 'dissolved_in_ca' ? 'dissolved during CA' : value.replaceAll('_', ' ');
export const mineralWords = (value: Mineral) => value.charAt(0).toUpperCase() + value.slice(1);
const displayUnit = (unit?: string | null) => unit?.trim().toLowerCase().replaceAll('°', '') === 'c' ? '°C' : unit?.trim();
function parameterName(def: ParameterDefinition): string {
  let label = (def.meaning || def.name).replaceAll('_', ' ').trim();
  const unit = def.unit?.trim();
  if (!unit) return label;
  const normalise = (s: string) => s.toLowerCase().replaceAll('°', '');
  const trailing = label.match(/\s+(?:\(([^()]+)\)|([^\s]+))$/);
  if (trailing && normalise(trailing[1] ?? trailing[2]) === normalise(unit)) label = label.slice(0, trailing.index);
  return label;
}
/** Editor label: the unit belongs beside the field, with a bare input value. */
export function parameterLabel(def: ParameterDefinition): string {
  const unit = displayUnit(def.unit);
  return parameterName(def) + (unit ? ` (${unit})` : '');
}
/** Read-only summary: put the unit on the stored value exactly once. */
export function parameterSummary(def: ParameterDefinition, value: unknown, versions: Record<string, VersionOut> = {}): string {
  return `${parameterName(def)}: ${formatParameter(def, value, versions)}`;
}
export function formatParameter(def: ParameterDefinition, value: unknown, versions: Record<string, VersionOut> = {}): string {
  if (value === undefined || value === null || value === '') return 'Not recorded';
  if (def.type === 'spike_version' || (def.config_key ?? def.name) === 'spike_version') {
    const version = versions[String(value)];
    return version ? `${version.solution_name} · ${version.subfraction_name} · ${version.version} (${version.status})` : 'Registered spike version (details unavailable)';
  }
  const unit = displayUnit(def.unit);
  if (Array.isArray(value)) return value.map(v => formatParameter({ ...def, unit: null }, v, versions)).join(', ') + (unit ? ` ${unit}` : '');
  const choice = def.choices?.find(c => typeof c === 'object' && c.value === value);
  const text = typeof choice === 'object' ? choice.label ?? String(choice.value) : def.type === 'integer' && typeof value === 'number' ? value.toFixed(0) : String(value);
  return text + (unit ? ` ${unit}` : '');
}
