<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import { statusWords, type BatchDetail, type FractionOut, type Parameters, type SpikeInput } from '../../lib/tims-api';
  import { mixed, groupValue, bulkPayload, groupPreview, undoPayload, lost, type BulkInput, type BulkResult, type UndoEdit } from '../../lib/tims-group';
  import { OnlineAction } from '../../lib/tims-requests';
  import { onlineOnlyReason } from '../../lib/outbox.svelte';
  import { timsError } from '../../lib/tims-readiness';
  import { WriteError } from '../../lib/oversight.svelte';
  import ParameterFields from './ParameterFields.svelte';
  import SpikePicker from './SpikePicker.svelte';
  let { batch, fractions, editable, undo, onbegin, onresult, onundo, onweight }: {
    batch: BatchDetail; fractions: FractionOut[]; editable: boolean; undo: UndoEdit | null;
    onbegin: () => () => boolean;
    onresult: (input: BulkInput, result: BulkResult) => void; onundo: (result: BulkResult) => void;
    onweight: (row: import('../../lib/tims-api').SpikeAddition) => void;
  } = $props();
  let choice = $state('fraction'), touched = $state.raw<Parameters>({}), preview = $state.raw<BulkInput | null>(null);
  let busy = $state(false), error = $state(''), message = $state(''), defaultChoice = $state(false), stale = $state(false);
  let versionNames = $state.raw<Record<string, string>>({});
  let weightIndex = $state<number | null>(null), weight = $state(''), weightInput = $state<HTMLInputElement>();
  const groupAction = new OnlineAction<BulkResult>(), weightAction = new OnlineAction<import('../../lib/tims-api').SpikeAddition>();
  let alive = true;
  onDestroy(() => { alive = false; });
  const step = $derived(batch.steps.find(s => s.id === choice));
  const target = $derived(choice === 'fraction' ? 'fraction' : step?.method_code === 'SP-TIMS-SPIKE' ? 'spike' : 'step_record');
  const active = $derived(fractions.filter(f => !lost(f)));
  const values = $derived(active.map(f => groupValue(batch, f, target, step)));
  const disabled = $derived(!editable || busy || !!onlineOnlyReason() || stale);
  const allRemaining = $derived(batch.fractions.filter(f => !f.retired_at && !lost(f)).every(f => fractions.some(v => v.id === f.id)));
  const canDefault = $derived(target === 'step_record' && allRemaining && !!step?.parameter_definitions.some(d => d.scope !== 'fraction' && d.role !== 'outcome'));
  const summary = $derived(groupPreview(batch, fractions, target, step, touched, { ...Object.fromEntries(Object.values(batch.spike_versions).map(v => [v.id, `${v.solution_name} ${v.version}`])), ...versionNames }));
  const weightFraction = $derived(weightIndex === null ? undefined : active[weightIndex]);
  function current(key: string) { return Object.hasOwn(touched, key) ? touched[key] : mixed(values.map(v => v[key])) ? '' : values[0]?.[key] ?? ''; }
  function hint(key: string) { return !Object.hasOwn(touched, key) && mixed(values.map(v => v[key])) ? 'Mixed' : ''; }
  function set(key: string, value: unknown) { touched = { ...touched, [key]: value }; preview = null; }
  function reset() { touched = {}; preview = null; error = ''; message = ''; defaultChoice = false; stale = false; weightIndex = null; }
  function parameterValues() {
    const keys = step?.parameter_definitions.map(d => d.config_key ?? d.name) ?? [];
    return { ...Object.fromEntries(keys.map(k => [k, mixed(values.map(v => (v.parameters as Parameters)?.[k])) ? undefined : (values[0]?.parameters as Parameters)?.[k]])), ...(touched.parameters as Parameters ?? {}) };
  }
  function prepare() {
    preview = bulkPayload(batch, fractions, target, step, touched, defaultChoice);
  }
  async function confirm(isUndo = false) {
    if (disabled || !isUndo && !preview || isUndo && !undo) return;
    const input = isUndo ? undoPayload(undo!, batch) : preview!;
    const current = onbegin();
    busy = true; error = '';
    try {
      const result = await groupAction.send(`/v1/tims/batches/${encodeURIComponent(batch.id)}/bulk`, 'POST', input, `batch:${batch.id}`);
      if (!current()) return;
      if (isUndo) onundo(result); else onresult(input, result);
      if (!alive) return;
      touched = {}; preview = null; message = isUndo ? 'Last group edit undone.' : 'Group edit saved.';
    } catch (e) {
      if (!alive || !current()) return;
      error = timsError(e);
      if (e instanceof WriteError && e.code === 'bulk_changed') { stale = true; preview = null; error = 'A selected capsule changed. Refresh the batch and review your selection before applying again.'; }
    } finally { if (alive) busy = false; }
  }
  async function startWeights(index = 0) {
    weightIndex = index; error = ''; message = '';
    const fraction = active[index];
    weight = batch.spikes.find(r => r.fraction_id === fraction?.id && r.step_id === step?.id)?.spike_weight_g ?? '';
    await tick(); weightInput?.focus(); weightInput?.select();
  }
  async function saveWeight(direction = 1) {
    if (!weightFraction || !step || disabled) return;
    if (!Number.isFinite(Number(weight)) || Number(weight) <= 0) { error = 'Enter a positive weight in grams.'; return; }
    const addition = batch.spikes.find(r => r.fraction_id === weightFraction.id && r.step_id === step.id);
    const metadata = groupValue(batch, weightFraction, 'spike', step);
    const version = metadata.spike_version_id || step.parameters.spike_version;
    if (!version) { error = 'Set a registered spike version for this capsule first.'; return; }
    const body: SpikeInput = { spike_version_id: String(version), spike_weight_g: weight,
      weighed_at: metadata.weighed_at as string | undefined, weighed_by_id: metadata.weighed_by_id as string | undefined,
      weighed_by_name: metadata.weighed_by_name as string | undefined,
      balance_readability_g: metadata.balance_readability_g as string | undefined,
      bottle_before_g: addition?.bottle_before_g ?? null, bottle_after_g: addition?.bottle_after_g ?? null,
      notes: addition?.notes ?? '', expected_updated_at: addition?.updated_at ?? batch.fraction_step_records.find(r => r.fraction_id === weightFraction!.id && r.step_id === step!.id)?.updated_at ?? null, expected_absent: !addition };
    const current = onbegin();
    busy = true; error = '';
    try {
      const row = await weightAction.send(`/v1/tims/batches/${encodeURIComponent(batch.id)}/fractions/${encodeURIComponent(weightFraction.id)}/steps/${encodeURIComponent(step.id)}/spike`, 'PUT', body, `batch:${batch.id}`);
      if (!current()) return;
      onweight(row);
      if (!alive) return;
      busy = false;
      const next = weightIndex! + direction;
      if (next >= active.length) { weightIndex = null; message = 'Selected capsule weights saved.'; }
      else await startWeights(Math.max(0, next));
    } catch (e) { if (alive && current()) error = timsError(e); }
    finally { if (alive) busy = false; }
  }
</script>
<section class="stack group-editor" aria-label="Group editor">
  <div class="group-heading stack"><h3>Group editor</h3><p class="small">{fractions.length} assigned capsules · {active.length} remaining</p><p class="small muted">Only edited fields apply. Mixed fields stay unchanged.</p></div>
  <div class="group-content stack">
    <label>Group step <select bind:value={choice} onchange={reset} disabled={busy}>
      <option value="fraction">Fraction info</option>
      {#each batch.steps as s}<option value={s.id}>{s.method_code === 'SP-TIMS-SPIKE' ? 'Spike' : s.method_name}{batch.steps.filter(v => v.method_code === s.method_code).length > 1 ? ` · ${s.ordinal}` : ''}</option>{/each}
    </select></label>
    {#if batch.completed_at}<p class="small">Completed batch · read only. Reopen it before editing.</p>{/if}
    {#if weightFraction}
      <section class="panel stack" aria-label="Selected capsule weight entry">
        <h4>{weightFraction.capsule_label} · {weightFraction.name} · {weightIndex! + 1} of {active.length}</h4>
        <label>Spike weight (g) <input bind:this={weightInput} bind:value={weight} inputmode="decimal" disabled={disabled} onkeydown={e => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (e.shiftKey && e.key === 'Tab') void startWeights(Math.max(0, weightIndex! - 1)); else void saveWeight(); } }} /></label>
        <p class="small muted">Tab or Enter saves and advances. Shift+Tab goes back.</p>
        <button class="btn primary" type="button" disabled={disabled} onclick={() => void saveWeight()}>Save weight and next</button>
        <button class="btn" type="button" disabled={busy} onclick={() => weightIndex = null}>Close weight entry</button>
      </section>
    {:else if target === 'fraction'}
      <label>Status <select value={String(current('status'))} disabled={disabled} onchange={e => set('status', e.currentTarget.value)}><option value="" disabled>{hint('status') || 'Choose status'}</option>{#each ['picked','transferred','abraded','spiked','dissolved','columns','loaded','measured','lost','dissolved_in_ca'] as status}<option value={status}>{statusWords(status)}</option>{/each}</select></label>
      <label>Fraction notes <textarea rows="3" value={String(current('notes'))} placeholder={hint('notes')} disabled={disabled} oninput={e => set('notes', e.currentTarget.value)}></textarea></label>
    {:else if target === 'spike'}
      <p class="small muted">{hint('spike_version_id') || 'Spike solution and registered version'} · weights remain per capsule.</p>
      <SpikePicker value={String(current('spike_version_id'))} lab={batch.lab_id} knownVersions={batch.spike_versions} showComposition disabled={disabled} onchange={(id, detail) => { set('spike_version_id', id); versionNames = { ...versionNames, [id]: `${detail.solution_name} ${detail.version}` }; }} />
      <label>Weighed at (UTC) {#if hint('weighed_at')}<span class="small muted">Mixed</span>{/if}<input type="datetime-local" value={String(current('weighed_at')).slice(0,19)} disabled={disabled} oninput={e => set('weighed_at', e.currentTarget.value ? new Date(e.currentTarget.value + 'Z').toISOString() : null)} /></label>
      <label>Weighed by <input value={String(current('weighed_by_name'))} placeholder={hint('weighed_by_name')} disabled={disabled} oninput={e => { set('weighed_by_name', e.currentTarget.value); set('weighed_by_id', null); }} /></label>
      <label>Balance readability (g) <input type="number" step="any" min="0" value={String(current('balance_readability_g'))} placeholder={hint('balance_readability_g')} disabled={disabled} oninput={e => set('balance_readability_g', e.currentTarget.value || null)} /></label>
      <button class="btn" type="button" disabled={disabled || !!preview || !!Object.keys(touched).length || !active.length} onclick={() => void startWeights()}>Enter weights</button>
    {:else if step}
      <label>Performed on {#if hint('performed_on')}<span class="small muted">Mixed</span>{/if}<input type="date" value={String(current('performed_on'))} disabled={disabled} oninput={e => set('performed_on', e.currentTarget.value || null)} /></label>
      <label>Performed at (UTC, optional) {#if hint('performed_at')}<span class="small muted">Mixed</span>{/if}<input type="datetime-local" value={String(current('performed_at')).slice(0,19)} disabled={disabled} oninput={e => set('performed_at', e.currentTarget.value ? new Date(e.currentTarget.value + 'Z').toISOString() : null)} /></label>
      <label>Operator <input value={String(current('operator_name'))} placeholder={hint('operator_name')} disabled={disabled} oninput={e => set('operator_name', e.currentTarget.value)} /></label>
      <ParameterFields definitions={step.parameter_definitions.filter(d => d.role !== 'outcome' && !['spike_weight_g','bottle_before_g','bottle_after_g'].includes(d.config_key ?? d.name))} values={parameterValues()} {disabled} group lab={batch.lab_id} knownVersions={batch.spike_versions}
        mixedKeys={new Set(step.parameter_definitions.map(d => d.config_key ?? d.name).filter(k => !Object.hasOwn(touched.parameters ?? {}, k) && mixed(values.map(v => (v.parameters as Parameters)?.[k]))))}
        onchange={() => {}} onfield={(key, value) => set('parameters', { ...(touched.parameters as Parameters ?? {}), [key]: value ?? null })} />
      <label>Skipped <select value={hint('skipped') ? '' : String(current('skipped'))} disabled={disabled} onchange={e => set('skipped', e.currentTarget.value === 'true')}><option value="" disabled>Mixed</option><option value="false">No</option><option value="true">Yes</option></select></label>
      <label>Outcome <select value={hint('outcome') ? "__mixed__" : String(current('outcome'))} disabled={disabled} onchange={e => set('outcome', e.currentTarget.value)}>{#if hint('outcome')}<option value="__mixed__" disabled>Mixed</option>{/if}<option value="">Not recorded</option>{#each step.parameter_definitions.find(d => d.role === 'outcome')?.choices ?? [] as c}<option value={typeof c === 'object' ? c.value : c}>{typeof c === 'object' ? c.label ?? c.value : statusWords(String(c))}</option>{/each}</select></label>
      <label>Step notes <textarea rows="3" value={String(current('outcome_note'))} placeholder={hint('outcome_note')} disabled={disabled} oninput={e => set('outcome_note', e.currentTarget.value)}></textarea></label>
      {#if canDefault}<label class="check"><input type="checkbox" bind:checked={defaultChoice} disabled={disabled} onchange={() => preview = null} /> Set as batch default (parameters and date)</label>{/if}
    {/if}
    {#if preview}<section class="panel stack" aria-label="Group edit preview"><p class="small">{summary}</p>{#if defaultChoice}<p class="small">Set batch parameters/date and clear selected overrides for those fields.</p>{/if}<div class="row"><button class="btn primary" disabled={disabled} onclick={() => void confirm()}>Confirm group edit</button><button class="btn" disabled={busy} onclick={() => preview = null}>Cancel</button></div></section>
    {:else if weightIndex === null}<button class="btn primary" disabled={disabled || !active.length || !Object.keys(touched).length || defaultChoice && !('parameters' in touched || 'performed_on' in touched)} onclick={prepare}>Preview group edit</button>{/if}
    <button class="btn" disabled={disabled || !undo} onclick={() => void confirm(true)}>Undo last group edit</button>
    <p class="small group-status" role="status" class:error={!!error}>{error || message || onlineOnlyReason()}</p>
  </div>
</section>
<style>
  .group-editor { height:100%;min-height:0;min-width:0;gap:4px; }
  .group-heading { height:88px;flex:none;border-bottom:1px solid var(--hairline);overflow:hidden; }
  .group-content { flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;padding:2px; }
  label { display:grid;gap:4px; } .check { display:flex;align-items:baseline; }
  input:not([type=checkbox]),select,textarea { width:100%;min-width:0; } p { margin:0;overflow-wrap:anywhere; }
  .group-status { min-height:40px; } section.panel { padding:8px; }
</style>
