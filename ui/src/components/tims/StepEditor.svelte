<script lang="ts">
  import { onDestroy } from 'svelte';
  import { tims, parameterSummary, type SpikeAddition, type StepOut, type VersionOut, type Parameters } from '../../lib/tims-api';
  import { OnlineAction, ReplyScope } from '../../lib/tims-requests';
  import { parameterDefinitions, parameterKey, validateParameters } from '../../lib/tims-model';
  import { onlineOnlyReason } from '../../lib/outbox.svelte';
  import { columnProtocol, readColumnNotes, validMass, writeColumnNotes } from '../../lib/tims-protocol';
  import { latestBottleReading, readSpikingSession, writeSpikingSession, type SessionBottle } from '../../lib/tims-spiking';
  import ParameterFields from './ParameterFields.svelte';
  import { labProtocol, labProtocols, useLabProtocols } from '../../lib/tims-lab-protocols.svelte';
  import ColumnProtocol from './ColumnProtocol.svelte';
  import SpikePicker from './SpikePicker.svelte';

  let { step, batch, lab, editable, index, total, move, refresh, knownVersions = {}, spikes = [], sessionStepIds }: {
    step: StepOut; batch: string; lab: string; editable: boolean; index: number; total: number;
    move: (index: number, direction: number) => void; refresh: () => Promise<void>; knownVersions?: Record<string, VersionOut>;
    spikes?: SpikeAddition[];
    sessionStepIds: ReadonlySet<string>;
  } = $props();
  useLabProtocols(() => lab);
  let editing = $state(false), parameters = $state.raw<Parameters>({}), performed = $state(''), notes = $state('');
  let bottles = $state.raw<SessionBottle[]>([]), pickerVersion = $state('');
  let protocolDraft = $state(''), error = $state(''), busy = $state(false);
  const column = $derived(step.method_code === 'SP-TIMS-COL');
  const spiking = $derived(step.method_code === 'SP-TIMS-SPIKE');
  const session = $derived(readSpikingSession(step.notes));
  const definitions = $derived(spiking ? step.parameter_definitions.filter(d => parameterKey(d) !== 'spike_version') : step.parameter_definitions);
  const columnNotes = $derived(readColumnNotes(step.notes));
  const deletion = new OnlineAction<{ deleted: boolean }>();
  const replies = new ReplyScope(() => [lab, batch, step.id]);
  let formGeneration = 0;
  onDestroy(() => replies.invalidate());

  function toggleEdit() {
    formGeneration++;
    busy = false;
    error = '';
    editing = !editing;
    parameters = { ...step.parameters };
    performed = step.performed_on ?? '';
    notes = spiking ? session.notes : column ? columnNotes.notes : step.notes;
    bottles = session.bottles;
    pickerVersion = String(step.parameters.spike_version ?? '');
    protocolDraft = columnNotes.protocol;
  }
  function addBottle(id: string, version: VersionOut, spikeType?: string) {
    pickerVersion = id;
    error = '';
    const existing = bottles.find(bottle => bottle.bottleId === version.subfraction_id);
    if (existing && latestBottleReading(spikes, sessionStepIds, existing, knownVersions)) {
      if (existing.versionId !== id) error = 'This bottle already has weighed additions under the recorded version.';
      return;
    }
    const label = [version.solution_name, spikeType, version.subfraction_name, version.version].filter(Boolean).join(' · ');
    const before = existing?.before ?? '';
    const bottle = { bottleId: version.subfraction_id, versionId: id, label, before };
    bottles = existing ? bottles.map(row => row === existing ? bottle : row) : [...bottles, bottle];
  }
  async function save() {
    error = '';
    const defaultVersion = bottles.find(bottle => bottle.versionId === parameters.spike_version) ?? bottles[0];
    const storedParameters = spiking && defaultVersion ? { ...parameters, spike_version: defaultVersion.versionId } : parameters;
    const errors = validateParameters(parameterDefinitions(step.parameter_definitions), storedParameters, true);
    if (errors.length) { error = errors.join(' '); return; }
    if (spiking && bottles.some(bottle => !validMass(bottle.before))) {
      error = 'Enter a positive beginning weight for each bottle, with up to 12 decimal places.';
      return;
    }
    const settled = replies.capture(() => formGeneration);
    const current = replies.capture(() => [formGeneration, parameters, performed, notes, bottles, protocolDraft]);
    const storedNotes = spiking ? writeSpikingSession(notes, session, bottles) : column ? writeColumnNotes(notes, protocolDraft) : notes;
    busy = true;
    try {
      await tims.patchStep(batch, step.id, { parameters: storedParameters, performed_on: performed || null, notes: storedNotes });
      if (current()) editing = false;
    } catch (e) {
      if (current()) error = String(e);
    } finally {
      if (settled()) busy = false;
    }
  }
  async function remove() {
    const current = replies.capture(); busy = true; error = '';
    try {
      await deletion.send(`/v1/tims/batches/${encodeURIComponent(batch)}/steps/${encodeURIComponent(step.id)}`, 'DELETE', undefined, `batch:${batch}`);
      if (current()) await refresh();
    } catch (e) { if (current()) error = String(e); } finally { if (current()) busy = false; }
  }
</script>

<article class="panel stack" aria-label={step.method_name}>
  <div class="row heading">
    <h3>{step.method_name}</h3>
    <div class="row">
      <button class="btn small" type="button" disabled={!editable || index === 0 || busy} onclick={() => move(index, -1)} aria-label={`Move ${step.method_name} up`}>↑</button>
      <button class="btn small" type="button" disabled={!editable || index === total - 1 || busy} onclick={() => move(index, 1)} aria-label={`Move ${step.method_name} down`}>↓</button>
      <button type="button" class="btn small" disabled={!editable} onclick={toggleEdit}>{editing ? 'Cancel edit' : 'Edit step'}</button>
    </div>
  </div>
  {#if editing}
    <form class="stack" onsubmit={e => { e.preventDefault(); void save(); }}>
      <label>{spiking ? 'Spiking date' : 'Performed on'} <input type="date" bind:value={performed} disabled={!editable || busy} /></label>
      <ParameterFields {definitions} values={parameters} onchange={v => parameters = v} disabled={!editable || busy} {lab} {knownVersions} />
      {#if spiking}
        <fieldset class="stack">
          <legend>Session spike bottles</legend>
          {#if session.before || session.after}<p class="small">Earlier session record · {session.before || '—'} g begin · {session.after || '—'} g end</p>{/if}
          {#each bottles as bottle (bottle.bottleId)}
            {@const inUse = !!latestBottleReading(spikes, sessionStepIds, bottle, knownVersions)}
            <div class="row heading">
              <label>{bottle.label}
                <span class="small">Beginning weight (g)</span>
                <input type="text" inputmode="decimal" value={bottle.before} required disabled={!editable || busy || inUse}
                  oninput={e => { const before = e.currentTarget.value.trim(); bottles = bottles.map(row => row === bottle ? { ...row, before } : row); }} />
              </label>
              {#if !inUse}<button class="btn small" type="button" disabled={!editable || busy} aria-label={`Remove ${bottle.label}`} onclick={() => bottles = bottles.filter(row => row !== bottle)}>Remove</button>{/if}
            </div>
          {/each}
          <SpikePicker value={pickerVersion} onchange={addBottle} disabled={!editable || busy} {lab} {knownVersions} showComposition />
        </fieldset>
      {/if}
      {#if column}<ColumnProtocol reference={columnProtocol(parameters.scheme)} loadError={labProtocols.state(lab).error} labProtocol={labProtocol(lab, columnProtocol(parameters.scheme)?.scheme)} value={protocolDraft} saved={!!columnNotes.protocol} onchange={value => protocolDraft = value} />{/if}
      <label>Step notes <textarea rows="3" bind:value={notes} disabled={!editable || busy}></textarea></label>
      <div class="row heading">
        <button class="btn primary" disabled={!editable || busy}>Save step here</button>
        <button type="button" class="btn small" disabled={!editable || !!onlineOnlyReason() || busy || sessionStepIds.size > 1}
          title={sessionStepIds.size > 1 ? 'Additional spike entries use this session.' : onlineOnlyReason()} onclick={() => void remove()}>Delete step</button>
      </div>
    </form>
  {:else}
    <p class="small muted">{spiking ? 'Spiking date' : 'Performed on'} · {step.performed_on ?? 'Not recorded'}</p>
    {#if parameterDefinitions(definitions).length}
      <ul>{#each parameterDefinitions(definitions) as d}
        <li>{parameterSummary(d, step.parameters[parameterKey(d)], knownVersions)}</li>
      {/each}</ul>
    {/if}
    {#if spiking}
      {#if session.bottles.length}
        <ul class="stack">
          {#each session.bottles as bottle (bottle.bottleId)}
            {@const latest = latestBottleReading(spikes, sessionStepIds, bottle, knownVersions)}
            <li><strong>{bottle.label}</strong><br /><span class="small">{bottle.before} g beginning{latest ? ` · ${latest.bottle_after_g} g latest recorded` : ''}</span></li>
          {/each}
        </ul>
      {:else}<p class="small">Open Edit step to set the beginning weight for each bottle.</p>{/if}
      {#if session.before || session.after}<p class="small">Earlier session record · {session.before || '—'} g begin · {session.after || '—'} g end</p>{/if}
    {/if}
    {@const summary = spiking ? session.notes : column ? columnNotes.notes : step.notes}
    {#if summary}<p>{summary}</p>{/if}
    {#if column}<ColumnProtocol reference={columnProtocol(step.parameters.scheme)} loadError={labProtocols.state(lab).error} labProtocol={labProtocol(lab, columnProtocol(step.parameters.scheme)?.scheme)} value={columnNotes.protocol} saved={!!columnNotes.protocol} context={`Batch step ${step.ordinal} · ${step.performed_on ?? 'Date unrecorded'}`} />{/if}
  {/if}
  {#if error}<p class="error" role="status">{error}</p>{/if}
</article>

<style>
  article { padding: var(--space-4); min-width: 0; overflow-wrap: anywhere; }
  h3, p, ul { margin: 0; }
  .row { flex-wrap: wrap; }
  .heading { justify-content: space-between; }
  label { display: grid; gap: 4px; }
  textarea { width: 100%; }
  input { width: 100%; min-width: 0; }
  fieldset { min-width: 0; border: 1px solid var(--hairline); border-radius: var(--radius-sm); }
</style>
