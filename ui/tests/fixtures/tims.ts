// Invented records only. No registry calibration or project data is copied here.
import { atlasFixtures } from './tims-atlas';
import { timsBatch, timsFraction, timsGrainFraction } from './review';
import type { MethodCode } from '../../src/lib/tims-model';
import type { BatchDetail, PickNotePlan, RecipeOut, SpikeSolution } from '../../src/lib/tims-api';
export const base = { created_at: '2026-11-06T10:00:00Z', updated_at: '2026-11-06T10:00:00Z', created_by_id: 'invented-account' };
export const lab = 'synthetic-lab';
export const methods: MethodCode[] = [
  { code: 'SP-TIMS-ANNEAL', name: 'Thermal annealing', level: 'code', status: 'proposed', parameters: [{ name: 'temperature_c', meaning: 'Temperature', type: 'number', unit: '°C', default: 900 }, { name: 'duration_h', meaning: 'Duration', type: 'choice', unit: 'h', choices: [60, 48], default: 60 }] },
  ...timsBatch.steps.map(s => ({ code: s.method_code, name: s.method_name, level: 'code', status: 'proposed', parameters: s.parameter_definitions })),
  ...['LEACH', 'CHLOR', 'COL', 'LOAD', 'WASH'].map(code => ({ code: `SP-TIMS-${code}`, name: code.toLowerCase(), level: 'code', status: 'proposed', parameters: [] })),
];
export const batch: BatchDetail = { ...timsBatch, fractions: [timsFraction, timsGrainFraction].map(f => ({ ...f, sources: f.sources.map(s => ({ ...s, mount_label: 'Invented mount S', grain_label: 'Invented grain one' })) })), steps: timsBatch.steps.map(s => s.method_code === 'SP-TIMS-CA' ? { ...s, parameter_definitions: [...s.parameter_definitions, { name: 'outcome', role: 'outcome', scope: 'fraction', type: 'choice', choices: ['survived', 'partly_dissolved', 'fully_dissolved'] }] } : s) };
export const version = batch.spike_versions['synthetic-version'];
export const solutions: SpikeSolution[] = [{ ...base, id: 'synthetic-solution', registry_id: 'Synthetic-spike', name: 'Synthetic spike', aliases: [], spike_type: 'invented', isotopes: ['205Pb'], description: '', origin: 'lab', lab_id: lab, active: true, subfractions: [{ ...base, id: 'synthetic-bottle', lab_id: lab, origin: 'lab', sub_id: 'master', name: 'Master', notes: '', versions: [{ id: version.id, version: version.version, status: version.status, source: version.source, source_display: version.source_display, content_sha256: 'invented' }, { id: 'withdrawn-version', version: 'old', status: 'withdrawn', source: 'invented', source_display: 'Invented', content_sha256: 'invented' }] }] }];
export const recipe: RecipeOut = { ...base, id: 'invented-recipe', lab_id: lab, mineral: 'zircon', name: 'Invented zircon recipe', active: true, revision: 2, notes: '', steps: [{ method_code: 'SP-TIMS-CA', parameters: { temperature_c: 190 } }] };
export const plan: PickNotePlan = { lab_id: lab, filename: '', first_line: 1, last_line: 1, summary: { ok: 1, refused: 0, skipped: 0, ignored: 0 }, batches: [{ set_id: 'set-k', started_on: '2026-11-06', action: 'create', id: null, recipe: { name: recipe.name } }], lines: [{ number: 1, text: 'K1-z1:S 1', kind: 'pick', parsed: { started_on: '2026-11-06' }, resolved: { sample: { id: 'sample-a', name: 'Synthetic-A', project_code: 'DEMO-2026' }, set: { id: 'set-k', name: 'Krogh', code: 'K' }, mount: { id: 'mount-demo', label: 'Invented mount S' }, spot: { id: 'spot-1', label: 'S 1' }, grain: { id: 'grain-1', label: 'Invented grain one' }, capsule_label: 'K1', fraction_name: 'z1' }, status: 'ok', code: '', message: 'Resolved spot and grain.', refusals: [], normalisations: ['Fraction name normalised to z1.'] }] };
export const fixtures: Record<string, unknown> = {
  '/v1/accounts/me': { id: 'invented-account', username: 'demo', display_name: 'Demo analyst', can_view_as: true },
  '/v1/labs': [{ id: lab, name: 'Invented lab', my_role: 'member' }],
  '/v1/accounts?limit=500&view_as=true': [{ id: 'other', username: 'invented-viewer', display_name: 'Invented viewer' }],
  '/v1/tims/capsule-sets?limit=500&lab=synthetic-lab': [batch.capsule_set],
  '/v1/tims/recipes?limit=500&lab=synthetic-lab': [recipe],
  '/v1/tims/recipes?limit=500&lab=synthetic-lab&mineral=zircon': [recipe],
  '/v1/tims/batches?limit=500&lab=synthetic-lab': [batch],
  [`/v1/tims/batches/${batch.id}`]: batch,
  '/v1/method-codes?q=SP-TIMS': methods,
  '/v1/tims/spikes': solutions,
  [`/v1/tims/spikes/versions/${version.id}`]: version,
  ...atlasFixtures,
  '/v1/history/batch/batch-synthetic': [{ id: 'history-invented', at: base.created_at, actor: 'Invented analyst', action: 'updated', before: { notes: 'old' }, after: { notes: 'new' } }],
};
