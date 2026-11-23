<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import { tims, statusWords, parameterSummary, type BatchDetail, type FractionOut, type FractionStatus, type StepOut, type Parameters, type SourceOut } from '../../lib/tims-api';
  import { fractionStatuses, choices, effectiveParameters, parameterDefinitions, parameterKey, validateParameters } from '../../lib/tims-model';
  import { editInAtlas } from '../../lib/apps.svelte';
  import { sourceNames, type MountGeometry } from '../../lib/tims-geometry';
  import { ReplyScope } from '../../lib/tims-requests';
  import { columnProtocol, readCapsuleNotes, readColumnNotes, validMass, writeCapsuleNotes, writeColumnNotes } from '../../lib/tims-protocol';
  import { laterWeighing, latestBottleReading, readSpikingSession, repeatedBottleLoss, spikeMassUsed, spikingSessionId, usesBottle } from '../../lib/tims-spiking';
  import { onlineOnlyReason } from '../../lib/outbox.svelte';
  import { readCapsulePreparation, writeCapsulePreparation } from '../../lib/tims-capsule-intake';
  import GrainImage from './GrainImage.svelte';
  import ParameterFields from './ParameterFields.svelte';
  import SpikePicker from './SpikePicker.svelte';
  import { labProtocol, labProtocols, useLabProtocols } from '../../lib/tims-lab-protocols.svelte';
  import ColumnProtocol from './ColumnProtocol.svelte';

  let { batch, fraction, editable, geometry, geometryError = '', activeStep, onstep, onbatchstep, onpick, createSpikeStep }: {
    batch: BatchDetail; fraction: FractionOut; editable: boolean; geometry: Record<string, MountGeometry>; geometryError?: string;
    activeStep: string; onstep: (id: string) => void; onbatchstep: (id: string) => void; onpick: () => void;
    createSpikeStep: (session: StepOut) => Promise<StepOut>;
  } = $props();
  useLabProtocols(() => batch.lab_id);
  let status = $state<FractionStatus>(untrack(() => fraction.status)), notes = $state(untrack(() => readCapsulePreparation(fraction.notes).notes));
  const preparation = $derived(readCapsulePreparation(fraction.notes).preparation);
  const isBlank = $derived(preparation === 'lab-blank');
  let error = $state(''), busy = $state(false), feedback = $state('');
  let overrides = $state.raw<Parameters>({}), skipped = $state(false), outcome = $state(''), outcomeNote = $state('');
  let date = $state(''), protocolDraft = $state('');
  let version = $state(''), bottleChoice = $state(''), weight = $state(''), before = $state(''), after = $state(''), spikeNotes = $state('');
  let repeatDraft = $state(false);
  const replies = new ReplyScope(() => [batch.id, fraction.id]);
  let formGeneration = 0;
  onDestroy(() => replies.invalidate());

  const step = $derived(batch.steps.find(s => s.id === activeStep));
  const addition = $derived(repeatDraft ? undefined : batch.spikes.find(s => s.fraction_id === fraction.id && s.step_id === activeStep));
  const recordSteps = $derived(new Set([
    ...batch.fraction_step_records.filter(r => r.fraction_id === fraction.id).map(r => r.step_id),
    ...batch.spikes.filter(r => r.fraction_id === fraction.id).map(r => r.step_id),
  ]));
  const chemistrySteps = $derived(batch.steps.filter(s => spikingSessionId(s) === s.id || !batch.steps.some(root => root.id === spikingSessionId(s))));
  const repeats = $derived(new Set(chemistrySteps.filter((step, index) =>
    chemistrySteps.findIndex(other => other.method_code === step.method_code) !== index).map(step => step.method_code)));
  const sourceGroups = $derived.by(() => {
    const groups = new Map<string, SourceOut[]>();
    for (const source of fraction.sources) {
      if (source.retired_at) continue;
      const key = source.grain_id ?? source.atlas_grain_id ?? source.id;
      const group = groups.get(key) ?? [];
      group.push(source);
      groups.set(key, group);
    }
    return [...groups.values()];
  });
  const column = $derived(step?.method_code === 'SP-TIMS-COL');
  const spiking = $derived(step?.method_code === 'SP-TIMS-SPIKE');
  const columnNotes = $derived(column && step ? readColumnNotes(step.notes) : null);
  const inheritedProtocol = $derived(overrides.scheme && overrides.scheme !== step?.parameters.scheme ? '' : columnNotes?.protocol ?? '');
  const savedProtocol = $derived(column ? readColumnNotes(batch.fraction_step_records.find(r => r.fraction_id === fraction.id && r.step_id === activeStep)?.outcome_note ?? '').protocol : '');
  const sessionStep = $derived(spiking && step ? batch.steps.find(s => s.id === spikingSessionId(step)) ?? step : undefined);
  const sessionSteps = $derived(sessionStep ? batch.steps.filter(s => spikingSessionId(s) === sessionStep.id) : []);
  const sessionStepIds = $derived(new Set(sessionSteps.map(s => s.id)));
  const entrySteps = $derived(sessionSteps.filter(s => s.id === sessionStep?.id || s.id === activeStep || recordSteps.has(s.id)));
  const emptyRepeat = $derived(sessionSteps.find(s => s.id !== sessionStep?.id && !recordSteps.has(s.id)));
  const session = $derived(sessionStep ? readSpikingSession(sessionStep.notes) : null);
  const additionVersion = $derived(addition ? batch.spike_versions[addition.spike_version_id] : undefined);
  const legacySpike = $derived(!!addition && !(addition.bottle_before_g && addition.bottle_after_g));
  const bottle = $derived(session?.bottles.find(row => addition
    ? row.versionId === addition.spike_version_id || row.bottleId === additionVersion?.subfraction_id
    : row.bottleId === bottleChoice) ?? (!addition && !bottleChoice && session?.bottles.length === 1 ? session.bottles[0] : undefined));
  const latest = $derived(step && (bottle || addition) ? latestBottleReading(batch.spikes, sessionStepIds, bottle ?? {
    bottleId: additionVersion?.subfraction_id ?? '', versionId: addition!.spike_version_id, label: '', before: '',
  }, batch.spike_versions) : undefined);
  const capsuleBottleTotal = $derived(bottle && addition ? repeatedBottleLoss(batch.spikes.filter(row =>
    sessionStepIds.has(row.step_id) && row.fraction_id === fraction.id && usesBottle(row, bottle, batch.spike_versions))) : '');
  const historicalSpike = $derived(!!addition && !!latest && laterWeighing(latest, addition));
  const startWeight = $derived(addition?.bottle_before_g ?? (addition ? '' : latest?.bottle_after_g ?? bottle?.before ?? ''));
  const usedWeight = $derived(addition && (historicalSpike || after.trim() === addition.bottle_after_g)
    ? addition.spike_weight_g : spikeMassUsed(startWeight, after.trim()));
  const spikeKeys = ['spike_weight_g', 'bottle_before_g', 'bottle_after_g'];

  $effect(() => {
    const id = activeStep;
    untrack(() => {
      formGeneration++;
      busy = false;
      error = '';
      feedback = '';
      const record = batch.fraction_step_records.find(r => r.fraction_id === fraction.id && r.step_id === id);
      overrides = { ...record?.parameters };
      skipped = record?.skipped ?? false;
      outcome = record?.outcome ?? '';
      const columnRecord = column ? readColumnNotes(record?.outcome_note ?? '') : { notes: record?.outcome_note ?? '', protocol: '' };
      const capsule = readCapsuleNotes(columnRecord.notes);
      outcomeNote = capsule.notes;
      date = capsule.date;
      protocolDraft = columnRecord.protocol;
      resetSpikeForm(false);
    });
  });

  function resetSpikeForm(repeat: boolean) {
    repeatDraft = repeat;
    version = addition?.spike_version_id ?? String(overrides.spike_version ?? sessionStep?.parameters.spike_version ?? '');
    bottleChoice = session?.bottles.find(row => row.versionId === version)?.bottleId ?? '';
    weight = addition?.spike_weight_g ?? '';
    before = addition?.bottle_before_g ?? '';
    after = addition?.bottle_after_g ?? '';
    spikeNotes = addition?.notes ?? '';
    error = '';
    feedback = '';
  }

  async function run(action: () => Promise<unknown>) {
    const settled = replies.capture(() => formGeneration);
    busy = true;
    error = '';
    feedback = '';
    try {
      await action();
      if (settled()) feedback = 'Saved here.';
    } catch (e) {
      if (settled()) error = String(e);
    } finally {
      if (settled()) busy = false;
    }
  }

  async function saveRecord() {
    if (!step) return;
    const errors = validateParameters(parameterDefinitions(step.parameter_definitions, true), { ...step.parameters, ...overrides }, skipped);
    if (errors.length) { error = errors.join(' '); return; }
    const plainNotes = writeCapsuleNotes(outcomeNote, date);
    await run(() => tims.putRecord(batch.id, fraction.id, step!.id, {
      parameters: overrides, skipped, outcome, outcome_note: column ? writeColumnNotes(plainNotes, protocolDraft) : plainNotes,
    }));
  }

  async function saveSpike() {
    if (!step) return;
    const end = after.trim();
    const versionId = legacySpike && !historicalSpike ? version : addition?.spike_version_id ?? bottle?.versionId;
    const used = legacySpike && !historicalSpike ? weight.trim() : usedWeight;
    const start = historicalSpike ? addition!.bottle_before_g : legacySpike ? before.trim() : startWeight;
    const final = historicalSpike ? addition!.bottle_after_g : end;
    if (!versionId) { error = 'Choose a spike bottle for this capsule.'; return; }
    if (!validMass(used)) { error = legacySpike ? 'Enter a positive spike weight in grams.' : 'Enter an ending weight below the starting weight, with up to 12 decimal places.'; return; }
    if (!historicalSpike && [start, final].some(value => value && !validMass(value))) { error = 'Enter positive decimal bottle weights in grams.'; return; }
    const body = {
      spike_version_id: versionId, spike_weight_g: used, bottle_before_g: start || null, bottle_after_g: final || null, notes: spikeNotes,
    };
    const isRepeat = repeatDraft;
    const batchId = batch.id, fractionId = fraction.id, previous = step.id, reusable = emptyRepeat, root = sessionStep!;
    const current = replies.capture(() => [activeStep, repeatDraft]);
    await run(async () => {
      const stepId = isRepeat ? (reusable ?? await createSpikeStep(root)).id : previous;
      if (batch.id !== batchId) return;
      await tims.putSpike(batchId, fractionId, stepId, body);
      if (isRepeat && current()) onstep(stepId);
    });
  }
</script>

<div class="stack">
  <div class="picker-steps" role="group" aria-label="Capsule navigation">
    <button class="btn small" type="button" aria-pressed={!activeStep} onclick={() => onstep('')}>{preparation ? 'Capsule record' : 'Sources'}</button>
    {#if batch.steps.length}
      <select aria-label="Capsule step" value={sessionStep?.id ?? step?.id ?? ''} onchange={event => onstep(event.currentTarget.value)}>
        <option value="">Choose chemistry step</option>
        {#each chemistrySteps as s (s.id)}
          <option value={s.id}>{repeats.has(s.method_code) ? `${s.ordinal}. ` : ''}{s.method_name}{recordSteps.has(s.id) ? ' · recorded' : ''}</option>
        {/each}
      </select>
    {/if}
  </div>
  {#if !step}
    <section class="stack" aria-label="Capsule sources">
      {#if preparation && !sourceGroups.length}
        {#if isBlank}
          <h4>Lab blank</h4>
          <p class="muted">Process blank linked to {fraction.sample.name}.</p>
          {#if !chemistrySteps.some(item => item.method_code === 'SP-TIMS-SPIKE')}<p class="small muted">Add a Spiking step in Batch steps to record the blank’s spike.</p>{/if}
        {:else}
          <h4>TIMS-only sample</h4>
          <p class="muted">{fraction.sample.name} · {statusWords(fraction.status)}</p>
        {/if}
      {:else}
      <div class="row heading"><h4>Grain and LA spots</h4>{#if !isBlank}<button class="btn small" type="button" disabled={!editable} onclick={onpick}>Browse GrainAtlas</button>{/if}</div>
      {#each sourceGroups as sources (sources[0].id)}
        {@const source = sources.find(s => s.spot_id) ?? sources[0]}
        {@const mount = source.mount_id ? geometry[source.mount_id] : undefined}
        {@const names = sourceNames(source, mount)}
        <article class="source">
          <GrainImage {source} {mount} size={104} {geometryError} />
          <div class="stack labels">
            <p class="small muted">Mount: {names.mount} · Grain: <strong>{names.grain}</strong></p>
            {#if sources.some(s => s.spot_id)}
              <ul aria-label="Linked LA spots">{#each sources.filter(s => s.spot_id) as linked (linked.id)}<li>{sourceNames(linked, mount).spot}</li>{/each}</ul>
            {:else}<span class="small muted">No linked LA spots</span>{/if}
            {#each [...new Set(sources.filter(s => s.is_fragment).map(s => s.fragment_note))] as fragmentNote}<p class="small warning">Fragment · {fragmentNote}</p>{/each}
            {#each [...new Set(sources.map(s => s.note).filter(Boolean))] as note}<p class="small">{note}</p>{/each}
            <button type="button" class="btn small" disabled={!editable || !mount?.current_project_uuid || !source.atlas_grain_id}
              title={!mount?.current_project_uuid ? 'No GrainAtlas project is available for this mount.' : ''}
              onclick={() => void run(() => editInAtlas({ project: mount!.current_project_uuid!, mount: source.mount_id, grain: source.atlas_grain_id, spot: source.atlas_spot_id }, 'tims'))}>Open in GrainAtlas</button>
          </div>
        </article>
      {:else}<p class="muted">No grain linked to this fraction.</p>{/each}
      {/if}
    </section>
    <details class="details">
      <summary>Fraction status and notes</summary>
      <form class="stack" onsubmit={e => { e.preventDefault(); void run(() => tims.patchFraction(fraction.id, { status, notes: writeCapsulePreparation(preparation, notes) })); }}>
        <label>Status <select bind:value={status} disabled={!editable || busy}>{#each fractionStatuses as s}<option value={s}>{statusWords(s)}</option>{/each}</select></label>
        <label>Fraction notes <textarea rows="3" bind:value={notes} disabled={!editable || busy}></textarea></label>
        <button class="btn" disabled={!editable || busy}>Save fraction here</button>
      </form>
    </details>
  {:else}
    {#key activeStep}
      <div class="row heading">
        <div>
          <h4>{step.method_name}</h4>
          {#if spiking}<p class="small muted">Spiking date · {sessionStep?.performed_on ?? 'Not recorded'}</p>{/if}
        </div>
        <button class="btn small" type="button" onclick={() => onbatchstep(sessionStep?.id ?? step!.id)}>{spiking ? 'Spiking session' : 'Batch defaults'}</button>
      </div>
      {#if spiking}
        {#if entrySteps.length > 1 || repeatDraft}
          <div class="row" role="group" aria-label="Spike entries for this capsule">
            {#each entrySteps as entry, index (entry.id)}
              <button class="btn small" type="button" disabled={busy} aria-pressed={!repeatDraft && entry.id === activeStep}
                onclick={() => { if (entry.id === activeStep) resetSpikeForm(false); else onstep(entry.id); }}>Entry {index + 1}</button>
            {/each}
            {#if repeatDraft}<strong class="small">New spike entry</strong>{/if}
          </div>
        {/if}
        {#if addition || session?.bottles.length}
          <form class="stack spike-form" onsubmit={e => { e.preventDefault(); void saveSpike(); }}>
            {#if !addition}
              <label>Spike bottle
                <select value={bottle?.bottleId ?? ''} required disabled={!editable || busy}
                  onchange={e => { bottleChoice = e.currentTarget.value; after = ''; }}>
                  <option value="" disabled>Choose a session bottle</option>
                  {#each session?.bottles ?? [] as row (row.bottleId)}<option value={row.bottleId}>{row.label}</option>{/each}
                </select>
              </label>
            {/if}
            {#if legacySpike && !historicalSpike}
              <SpikePicker knownVersions={batch.spike_versions} value={version} onchange={v => version = v} disabled={!editable || busy} lab={batch.lab_id} showComposition />
              <label>Recorded spike weight (g) <input type="text" inputmode="decimal" bind:value={weight} required disabled={!editable || busy} /></label>
              <details class="details">
                <summary>Earlier bottle readings</summary>
                <label>Bottle before this capsule (g) <input type="text" inputmode="decimal" bind:value={before} disabled={!editable || busy} /></label>
                <label>Bottle after this capsule (g) <input type="text" inputmode="decimal" bind:value={after} disabled={!editable || busy} /></label>
              </details>
            {:else if addition || bottle}
              <SpikePicker knownVersions={batch.spike_versions} value={addition?.spike_version_id ?? bottle?.versionId} lab={batch.lab_id} showComposition />
              <div class="weighing">
                <div class="start-weight">
                  <span class="small muted">Bottle before this capsule</span>
                  <strong>{startWeight ? `${startWeight} g` : 'Unrecorded'}</strong>
                </div>
                <label>Bottle after this capsule (g) <input type="text" inputmode="decimal" bind:value={after} required disabled={!editable || busy || historicalSpike} /></label>
              </div>
              <p>Spike used from bottle · <output><strong>{usedWeight ? `${usedWeight} g` : '—'}</strong></output></p>
              {#if capsuleBottleTotal}<p class="small">Recorded loss from this bottle across entries · <strong>{capsuleBottleTotal} g</strong></p>{/if}
              {#if historicalSpike}<p class="small muted">A later capsule uses this reading as a starting weight. The comment can still be edited.</p>{/if}
              {#if after.trim() && !usedWeight}
                <p class="small warning">{validMass(after.trim()) ? 'The ending weight must be below the starting weight.' : 'Enter the full weight in grams, with up to 12 decimal places.'}</p>
              {/if}
              {#if addition?.bottle_difference_g && addition.bottle_difference_g !== addition.spike_weight_g && after === addition.bottle_after_g}
                <p class="small">Recorded bottle difference · {addition.bottle_difference_g} g</p>
              {/if}
            {/if}
            {#if addition?.warnings.includes('spike_version_not_current')}<p class="warning">The recorded spike version is no longer current.</p>{/if}
            <label>Spike comment <textarea rows="2" bind:value={spikeNotes} disabled={!editable || busy} placeholder="Missed drops, repeat additions, or other observations"></textarea></label>
            <div class="row">
              <button class="btn primary" disabled={!editable || busy || !addition && !usedWeight}>Save spike here</button>
              {#if repeatDraft}<button class="btn" type="button" disabled={busy} onclick={() => resetSpikeForm(false)}>Cancel entry</button>
              {:else if addition && session?.bottles.length && editable}
                <button class="btn" type="button" disabled={busy || !emptyRepeat && !!onlineOnlyReason()}
                  title={emptyRepeat ? undefined : onlineOnlyReason()} onclick={() => resetSpikeForm(true)}>Add another spike entry</button>
              {/if}
            </div>
          </form>
        {:else}
          <p class="small muted">Use Spiking session to set the beginning weight for each bottle.</p>
        {/if}
        {#if step.id === sessionStep?.id && !repeatDraft}<details class="details">
          <summary>Spiking step record{skipped ? ' · skipped' : ''}</summary>
          <form class="stack" onsubmit={e => { e.preventDefault(); void saveRecord(); }}>
            <ParameterFields definitions={step.parameter_definitions} values={overrides} onchange={v => overrides = v} inherited={step.parameters} knownVersions={batch.spike_versions} fraction disabled={!editable || busy} lab={batch.lab_id} />
            <label class="check"><input type="checkbox" bind:checked={skipped} disabled={!editable || busy} /> Skipped</label>
            <label>Step note <textarea rows="2" bind:value={outcomeNote} disabled={!editable || busy}></textarea></label>
            <button class="btn" disabled={!editable || busy}>Save capsule record here</button>
          </form>
        </details>{/if}
      {:else}
        {@const values = effectiveParameters(step.parameters, { parameters: overrides })}
        {@const outcomes = choices(step.parameter_definitions.find(d => d.role === 'outcome') ?? { name: 'outcome' })}
        <form class="stack" onsubmit={e => { e.preventDefault(); void saveRecord(); }}>
          {#if values.length}<p class="small muted">{values.map(p => `${parameterSummary(step.parameter_definitions.find(d => parameterKey(d) === p.key) ?? { name: p.key }, p.value, batch.spike_versions)}${p.overridden ? ' (overridden)' : ''}`).join(' · ')}</p>{/if}
          <label>Capsule date <input type="date" bind:value={date} disabled={!editable || busy} /></label>
          {#if step.performed_on}<p class="small muted">Batch date · {step.performed_on}</p>{/if}
          <ParameterFields definitions={step.parameter_definitions.filter(d => !spikeKeys.includes(parameterKey(d)))} values={overrides} onchange={v => overrides = v} inherited={step.parameters} knownVersions={batch.spike_versions} fraction disabled={!editable || busy} lab={batch.lab_id} />
          <label class="check"><input type="checkbox" bind:checked={skipped} disabled={!editable || busy} /> Skipped</label>
          {#if outcomes.length}
            <label>Outcome <select bind:value={outcome} disabled={!editable || busy}><option value="">Not recorded</option>{#each outcomes as c}<option value={String(c.value)}>{statusWords(String(c.label ?? c.value))}</option>{/each}</select></label>
          {/if}
          {#if column}
            <ColumnProtocol reference={columnProtocol(overrides.scheme ?? step.parameters.scheme, fraction.mineral)}
              loadError={labProtocols.state(batch.lab_id).error} labProtocol={labProtocol(batch.lab_id, columnProtocol(overrides.scheme ?? step.parameters.scheme, fraction.mineral)?.scheme)} layer="capsule"
              inherited={inheritedProtocol} saved={!!(savedProtocol || inheritedProtocol)}
              value={protocolDraft} onchange={editable && !busy ? value => protocolDraft = value : undefined}
              context={`${batch.capsule_set.name} · ${fraction.capsule_label} · ${date || step.performed_on || 'Date unrecorded'}`} />
          {/if}
          <label>Step note <textarea rows="2" bind:value={outcomeNote} disabled={!editable || busy}></textarea></label>
          <button class="btn primary" disabled={!editable || busy}>Save capsule record here</button>
        </form>
      {/if}
    {/key}
  {/if}
  {#if error}<p class="error" role="status">{error}</p>{/if}
  {#if feedback}<p class="small muted" role="status">{feedback}</p>{/if}
</div>

<style>
  h4, p { margin: 0; }
  .row { flex-wrap: wrap; }
  .heading { justify-content: space-between; }
  .picker-steps { display: flex; gap: var(--space-2); padding-bottom: var(--space-2); border-bottom: 1px solid var(--hairline); }
  .picker-steps select { flex: 1; }
  .picker-steps .btn[aria-pressed=true] { border-color: var(--accent); background: var(--accent-soft); }
  .picker-steps .btn { white-space: normal; }
  .source { display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: var(--space-2); align-items: center; }
  .labels { gap: var(--space-1); }
  ul { padding-left: 1.2em; margin: 0; font-size: .78rem; }
  label { display: grid; gap: 4px; }
  .check { display: flex; align-items: baseline; }
  input:not([type=checkbox]), select, textarea { min-width: 0; width: 100%; }
  .warning { color: var(--warning); }
  .details { border: 1px solid var(--hairline); border-radius: var(--radius-sm); padding: var(--space-2); }
  /* Closed details must not leave offscreen form boxes in either engine. */
  .details:not([open]) > :not(summary) { display: none; }
  .details[open] summary { margin-bottom: var(--space-2); }
  .spike-form { gap: var(--space-2); }
  .weighing { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(145px, 100%), 1fr)); align-items: stretch; gap: var(--space-2); }
  .start-weight { display: grid; align-content: center; gap: 4px; padding: var(--space-2); background: var(--accent-soft); border-radius: var(--radius-sm); }
</style>
