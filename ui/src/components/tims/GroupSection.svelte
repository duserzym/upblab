<script lang="ts">
  import { statusWords, type BatchDetail, type FractionOut, type Parameters } from '../../lib/tims-api';
  import { mixed, groupValue, lost, type GroupSection } from '../../lib/tims-group';
  import ParameterFields from './ParameterFields.svelte';
  import SpikePicker from './SpikePicker.svelte';
  let { batch, fractions, section, touched, defaultChoice, disabled, draftPending, onfield, ondefault, onversion, onweights } : {
    batch: BatchDetail; fractions: FractionOut[]; section: GroupSection; touched: Parameters; defaultChoice: boolean;
    disabled: boolean; draftPending: boolean; onfield: (key: string, value: unknown) => void;
    ondefault: (value: boolean) => void; onversion: (id: string, name: string) => void; onweights: () => void;
  } = $props();
  const step = $derived(section.step), target = $derived(section.target);
  const active = $derived(fractions.filter(f => !lost(f)));
  const values = $derived(active.map(f => groupValue(batch, f, target, step)));
  const allRemaining = $derived(batch.fractions.filter(f => !f.retired_at && !lost(f)).every(f => fractions.some(v => v.id === f.id)));
  const canDefault = $derived(target === 'step_record' && allRemaining && !!step?.parameter_definitions.some(d => d.scope !== 'fraction' && d.role !== 'outcome'));
  function current(key: string) { return Object.hasOwn(touched, key) ? touched[key] : mixed(values.map(v => v[key])) ? '' : values[0]?.[key] ?? ''; }
  function hint(key: string) { return !Object.hasOwn(touched, key) && mixed(values.map(v => v[key])) ? 'Mixed' : ''; }
  const set = (key: string, value: unknown) => onfield(key, value);
  function parameterValues() {
    const keys = step?.parameter_definitions.map(d => d.config_key ?? d.name) ?? [];
    return { ...Object.fromEntries(keys.map(k => [k, mixed(values.map(v => (v.parameters as Parameters)?.[k])) ? undefined : (values[0]?.parameters as Parameters)?.[k]])), ...(touched.parameters as Parameters ?? {}) };
  }
</script>
    {#if target === 'fraction'}
      <label>Status <select value={String(current('status'))} disabled={disabled} onchange={e => set('status', e.currentTarget.value)}><option value="" disabled>{hint('status') || 'Choose status'}</option>{#each ['picked','transferred','abraded','spiked','dissolved','columns','loaded','measured','lost','dissolved_in_ca'] as status}<option value={status}>{statusWords(status)}</option>{/each}</select></label>
      <label>Fraction notes <textarea rows="3" value={String(current('notes'))} placeholder={hint('notes')} disabled={disabled} oninput={e => set('notes', e.currentTarget.value)}></textarea></label>
    {:else if target === 'spike'}
      <p class="small muted">{hint('spike_version_id') || 'Spike solution and registered version'} · weights remain per capsule.</p>
      <SpikePicker value={String(current('spike_version_id'))} lab={batch.lab_id} knownVersions={batch.spike_versions} disabled={disabled} onchange={(id, detail) => { set('spike_version_id', id); onversion(id, `${detail.solution_name} ${detail.version}`); }} />
      <label>Weighed at (UTC) {#if hint('weighed_at')}<span class="small muted">Mixed</span>{/if}<input type="datetime-local" value={String(current('weighed_at')).slice(0,19)} disabled={disabled} oninput={e => set('weighed_at', e.currentTarget.value ? new Date(e.currentTarget.value + 'Z').toISOString() : null)} /></label>
      <label>Weighed by <input value={String(current('weighed_by_name'))} placeholder={hint('weighed_by_name')} disabled={disabled} oninput={e => { set('weighed_by_name', e.currentTarget.value); set('weighed_by_id', null); }} /></label>
      <label>Balance readability (g) <input type="number" step="any" min="0" value={String(current('balance_readability_g'))} placeholder={hint('balance_readability_g')} disabled={disabled} oninput={e => set('balance_readability_g', e.currentTarget.value || null)} /></label>
      <button class="btn" type="button" disabled={disabled || draftPending || !active.length} onclick={onweights}>Enter weights</button>
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
      {#if canDefault}<label class="check"><input type="checkbox" checked={defaultChoice} disabled={disabled} onchange={e => ondefault(e.currentTarget.checked)} /> Set as batch default (parameters and date)</label>{/if}
    {/if}

<style>
  label { display:grid;gap:4px; } .check { display:flex;align-items:baseline; }
  input:not([type=checkbox]),select,textarea { width:100%;min-width:0; } p { margin:0;overflow-wrap:anywhere; }
</style>
