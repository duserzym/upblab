<script lang="ts">
  import GrainImage from './GrainImage.svelte';
  import { untrack, onDestroy } from 'svelte';
  import { tims, statusWords, parameterSummary, type BatchDetail, type FractionOut, type FractionStatus, type StepOut, type Parameters } from '../../lib/tims-api';
  import { fractionStatuses, choices, effectiveParameters, parameterDefinitions, parameterKey, validateParameters } from '../../lib/tims-model';
  import { editInAtlas } from '../../lib/apps.svelte';
  import { sourceNames, type MountGeometry } from '../../lib/tims-geometry';
  import ParameterFields from './ParameterFields.svelte';
  import SpikePicker from './SpikePicker.svelte';
  import Composition from './Composition.svelte';
  import { ReplyScope } from '../../lib/tims-requests';
  let { batch, fraction, editable, geometry, geometryError = '', initialStep = '', close }: { batch: BatchDetail; fraction: FractionOut; editable: boolean; geometry: Record<string, MountGeometry>; geometryError?: string; initialStep?: string; close: () => void } = $props();
  let status = $state<FractionStatus>(untrack(() => fraction.status)), notes = $state(untrack(() => fraction.notes)), error = $state(''), busy = $state(false);
  let activeStep = $state(''), overrides = $state.raw<Parameters>({}), skipped = $state(false), outcome = $state(''), outcomeNote = $state('');
  let version = $state(''), weight = $state(''), before = $state(''), after = $state(''), spikeNotes = $state('');
  const replies = new ReplyScope(() => [batch.id, fraction.id]);
  let formGeneration = 0;
  onDestroy(() => replies.invalidate());
  const step = $derived(batch.steps.find(s => s.id === activeStep));
  const addition = $derived(batch.spikes.find(s => s.fraction_id === fraction.id && s.step_id === activeStep));
  const recordedVersion = $derived(addition ? batch.spike_versions[addition.spike_version_id] : undefined);
  function choose(s: StepOut) {
    formGeneration++; busy = false; error = '';
    activeStep = s.id; const record = batch.fraction_step_records.find(r => r.fraction_id === fraction.id && r.step_id === s.id);
    overrides = { ...record?.parameters }; skipped = record?.skipped ?? false; outcome = record?.outcome ?? ''; outcomeNote = record?.outcome_note ?? '';
    const spike = batch.spikes.find(r => r.fraction_id === fraction.id && r.step_id === s.id);
    version = spike?.spike_version_id ?? String(s.parameters.spike_version ?? ''); weight = spike?.spike_weight_g ?? ''; before = spike?.bottle_before_g ?? ''; after = spike?.bottle_after_g ?? ''; spikeNotes = spike?.notes ?? '';
  }
  $effect(() => { const id = initialStep; if (id) untrack(() => { const s = batch.steps.find(s => s.id === id); if (s) choose(s); }); });
  async function run(action: () => Promise<unknown>) {
    const settled = replies.capture(() => formGeneration), current = replies.capture(() => [formGeneration, activeStep, status, notes, overrides, skipped, outcome, outcomeNote, version, weight, before, after, spikeNotes]);
    busy = true; error = ''; try { await action(); } catch (e) { if (current()) error = String(e); } finally { if (settled()) busy = false; }
  }
  async function saveRecord() {
    if (!step) return;
    const errors = validateParameters(parameterDefinitions(step.parameter_definitions, true).filter(d => !['spike_weight_g', 'bottle_before_g', 'bottle_after_g'].includes(parameterKey(d))), { ...step.parameters, ...overrides }, skipped);
    if (errors.length) { error = errors.join(' '); return; }
    await run(() => tims.putRecord(batch.id, fraction.id, step.id, { parameters: overrides, skipped, outcome, outcome_note: outcomeNote }));
  }
  async function saveSpike() {
    if (!step) return;
    if (!version || !/^\d+(\.\d+)?$/.test(weight) || !/[1-9]/.test(weight)) { error = 'Choose a registered version and enter a positive decimal spike weight in g.'; return; }
    await run(() => tims.putSpike(batch.id, fraction.id, step.id, { spike_version_id: version, spike_weight_g: weight, bottle_before_g: before || null, bottle_after_g: after || null, notes: spikeNotes }));
  }
</script>
<section class="panel stack drawer" aria-label="Capsule details">
  <div class="row"><h3>{fraction.capsule_label} · {fraction.name} · {fraction.sample.name}</h3><button class="btn" type="button" onclick={close}>Close capsule</button></div>
  <form class="stack" onsubmit={e => { e.preventDefault(); void run(() => tims.patchFraction(fraction.id, { status, notes })); }}>
    <label>Status (explicit change) <select bind:value={status} disabled={!editable}>{#each fractionStatuses as s}<option value={s}>{statusWords(s)}</option>{/each}</select></label>
    <label>Fraction notes <textarea bind:value={notes} disabled={!editable}></textarea></label><button class="btn" disabled={!editable || busy}>Save fraction here</button>
  </form>
  <h4>Sources</h4>
  {#each fraction.sources.filter(s => !s.retired_at) as source (source.id)}
    {@const project = source.mount_id ? geometry[source.mount_id]?.current_project_uuid : null}
    {@const names = sourceNames(source, source.mount_id ? geometry[source.mount_id] : undefined)}
    <article class="small"><GrainImage {source} mount={source.mount_id ? geometry[source.mount_id] : undefined} size={180} {geometryError} /><p title={[source.mount_id, source.grain_id, source.atlas_grain_id, source.spot_id].filter(Boolean).join(' · ')}>Mount: {names.mount} · Grain: {names.grain} · Spot: {names.spot}</p>
    {#if source.is_fragment}<p class="warning">Fragment · {source.fragment_note}</p>{/if}{#if source.note}<p>{source.note}</p>{/if}
    <button type="button" class="btn" disabled={!editable || !project || !source.atlas_grain_id} title={!project ? 'No grainatlas project is available for this mount.' : ''} onclick={() => void run(() => editInAtlas({ project: project!, mount: source.mount_id, grain: source.atlas_grain_id, spot: source.atlas_spot_id }, 'tims'))}>Open in grainatlas</button></article>
  {:else}<p class="muted">Sample-only fraction; no source recorded.</p>{/each}
  <h4>Per-step records</h4>
  <div class="row">{#each batch.steps as s}<button type="button" class="btn small" aria-pressed={activeStep === s.id} onclick={() => choose(s)}>{s.method_name}</button>{/each}</div>
  {#if step}{#key activeStep}
    <form class="stack" onsubmit={e => { e.preventDefault(); void saveRecord(); }}>
      <h4>{step.method_name}</h4>
      <p class="small">Effective values: {effectiveParameters(step.parameters, { parameters: overrides }).map(p => `${parameterSummary(step.parameter_definitions.find(d => parameterKey(d) === p.key) ?? { name: p.key }, p.value, batch.spike_versions)}${p.overridden ? ' (overridden)' : ''}`).join(' · ')}</p>
      <ParameterFields definitions={step.parameter_definitions.filter(d => step.method_code !== 'SP-TIMS-SPIKE' || !['spike_weight_g', 'bottle_before_g', 'bottle_after_g'].includes(parameterKey(d)))} values={overrides} onchange={v => overrides = v} inherited={step.parameters} knownVersions={batch.spike_versions} fraction disabled={!editable} lab={batch.lab_id} />
      <label><input type="checkbox" bind:checked={skipped} disabled={!editable} /> Skipped</label>
      <label>Outcome <select bind:value={outcome} disabled={!editable}><option value="">Not recorded</option>{#each choices(step.parameter_definitions.find(d => d.role === 'outcome') ?? { name: 'outcome' }) as c}<option value={String(c.value)}>{statusWords(String(c.label ?? c.value))}</option>{/each}</select></label>
      <label>Outcome note <textarea bind:value={outcomeNote} disabled={!editable}></textarea></label>
      <button class="btn" disabled={!editable || busy}>Save capsule record here</button>
    </form>
    {#if step.method_code === 'SP-TIMS-SPIKE'}
      <form class="stack" onsubmit={e => { e.preventDefault(); void saveSpike(); }}>
        <SpikePicker knownVersions={batch.spike_versions} value={version} onchange={v => version = v} disabled={!editable} lab={batch.lab_id} />
        <label>Spike weight (g, decimal) <input type="text" inputmode="decimal" bind:value={weight} required disabled={!editable} /></label>
        <label>Bottle before (g) <input type="text" inputmode="decimal" bind:value={before} disabled={!editable} /></label><label>Bottle after (g) <input type="text" inputmode="decimal" bind:value={after} disabled={!editable} /></label>
        <p>Server bottle difference: {addition?.bottle_difference_g ?? 'Not recorded'} g</p>
        {#if addition?.warnings.includes('spike_version_not_current')}<p class="warning">The server reports that this spike version is not current.</p>{/if}
        {#if recordedVersion}<Composition version={recordedVersion} />{/if}
        <label>Spike notes <textarea bind:value={spikeNotes} disabled={!editable}></textarea></label><button class="btn" disabled={!editable || busy}>Save spike here</button>
      </form>
    {/if}
  {/key}{/if}
  {#if error}<p class="error" role="status">{error}</p>{/if}
</section>
<style>.drawer{padding:10px;min-width:0;overflow-wrap:anywhere}h3,h4,p{margin:0}.row{flex-wrap:wrap}label{display:grid;gap:4px}label:has(input[type=checkbox]){display:flex}input:not([type=checkbox]),select,textarea{min-width:0;width:100%}.warning{color:var(--warning)}</style>
