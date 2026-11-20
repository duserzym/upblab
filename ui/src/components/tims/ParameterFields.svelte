<script lang="ts">
  import { parameterLabel, type ParameterDefinition, type Parameters, type VersionOut } from '../../lib/tims-api';
  import { choices, parameterDefinitions, parameterKey, parameterValue } from '../../lib/tims-model';
  import SpikePicker from './SpikePicker.svelte';
  let { definitions, values, onchange, disabled = false, fraction = false, inherited = {}, lab = '', knownVersions = {} }: {
    definitions: ParameterDefinition[]; values: Parameters; onchange: (values: Parameters) => void; disabled?: boolean; fraction?: boolean; inherited?: Parameters; lab?: string; knownVersions?: Record<string, VersionOut>;
  } = $props();
  function set(key: string, value: unknown) { const next = { ...values }; if (value === undefined) delete next[key]; else next[key] = value; onchange(next); }
</script>
<div class="fields">
{#each parameterDefinitions(definitions, fraction) as d (parameterKey(d))}
  {@const key = parameterKey(d)}
  {@const override = Object.hasOwn(values, key)}
  {@const value = override ? values[key] : inherited[key]}
  <div class="stack field">
    {#if fraction}<label class="small"><input type="checkbox" checked={override} {disabled} onchange={e => set(key, e.currentTarget.checked ? value ?? d.default ?? (d.type === 'multi_choice' ? [] : '') : undefined)} /> Override {parameterLabel(d)}{override ? ' · overridden' : ''}</label>{/if}
    {#if d.type === 'spike_version'}
      <span>{parameterLabel(d)}</span><SpikePicker value={String(value ?? '')} disabled={disabled || fraction && !override} {lab} {knownVersions} onchange={v => set(key, v)} />
    {:else if d.type === 'multi_choice'}
      <fieldset disabled={disabled || fraction && !override}><legend>{parameterLabel(d)}</legend>{#each choices(d) as c}<label><input type="checkbox" checked={Array.isArray(value) && value.includes(c.value)} onchange={e => set(key, e.currentTarget.checked ? [...(Array.isArray(value) ? value : []), c.value] : (Array.isArray(value) ? value : []).filter(v => v !== c.value))} />{c.label ?? c.value}</label>{/each}</fieldset>
    {:else}
      <label>{parameterLabel(d)}
      {#if d.type === 'choice'}
        <select value={String(value ?? '')} disabled={disabled || fraction && !override} required={d.required && !fraction} onchange={e => set(key, parameterValue(d, e.currentTarget.value))}><option value="">Not recorded</option>{#each choices(d) as c}<option value={String(c.value)}>{c.label ?? c.value}</option>{/each}</select>
      {:else if d.type === 'number' || d.type === 'integer'}
        <input type="number" value={typeof value === 'number' ? value : ''} step={d.type === 'integer' ? 1 : 'any'} min={d.min} max={d.max} required={d.required && !fraction} disabled={disabled || fraction && !override} oninput={e => set(key, parameterValue(d, e.currentTarget.value))} />
      {:else}
        <input type="text" value={String(value ?? '')} required={d.required && !fraction} disabled={disabled || fraction && !override} oninput={e => set(key, parameterValue(d, e.currentTarget.value))} />
      {/if}</label>
    {/if}
  </div>
{/each}
</div>
<style>.fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:8px;min-width:0}.field{min-width:0}label{display:grid;gap:4px}label:has(input[type=checkbox]){display:flex;align-items:center}input:not([type=checkbox]),select{width:100%;min-width:0}fieldset{min-width:0;border:1px solid var(--hairline);border-radius:var(--radius-sm)}</style>
