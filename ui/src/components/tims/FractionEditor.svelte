<script lang="ts">
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import { untrack, onDestroy } from 'svelte';
  import { tims, statusWords, parameterSummary, type BatchDetail, type FractionOut, type FractionStatus, type StepOut, type Parameters, type SourceOut, type SpikeInput, type SpikeAddition } from '../../lib/tims-api';
  import { choices, effectiveParameters, parameterDefinitions, parameterKey, validateParameters } from '../../lib/tims-model';
  import { isDesktop } from '../../lib/platform';
  import { shell } from '../../lib/shell.svelte';
  import { isLooseGrain, sourceNames, type MountGeometry } from '../../lib/tims-geometry';
  import { OnlineAction, ReplyScope } from '../../lib/tims-requests';
  import { columnProtocol, readCapsuleNotes, readColumnNotes, writeCapsuleNotes, writeColumnNotes } from '../../lib/tims-protocol';
  import { laterWeighing, latestBottleReading, readSpikingSession, spikingSessionId } from '../../lib/tims-spiking';
  import { outbox, onlineOnlyReason } from '../../lib/outbox.svelte';
  import { readCapsulePreparation, writeCapsulePreparation } from '../../lib/tims-capsule-intake';
  import GrainImage from './GrainImage.svelte';
  import ParameterFields from './ParameterFields.svelte';
  import { stableScroll } from '../../lib/tims-scroll';
  import RequiredSpike from './RequiredSpike.svelte';
  import { fractionStatusReadiness, timsError } from '../../lib/tims-readiness';
  import { labProtocol, labProtocols, useLabProtocols } from '../../lib/tims-lab-protocols.svelte';
  import ColumnProtocol from './ColumnProtocol.svelte';

  let { batch, fraction, editable, geometry, geometryError = '', activeStep, onstep, onbatchstep, onpick, onreplace, onrefine, createSpikeStep, onspike }: {
    batch: BatchDetail; fraction: FractionOut; editable: boolean; geometry: Record<string, MountGeometry>; geometryError?: string;
    activeStep: string; onstep: (id: string) => void; onbatchstep: (id: string) => void; onpick: () => void;
    onreplace: (source: SourceOut) => void; onrefine: (source: SourceOut) => Promise<void>;
    onspike: (row: SpikeAddition) => void;
    createSpikeStep: (session: StepOut) => Promise<StepOut>;
  } = $props();
  const uid = $props.id();
  const looseReplaceReason = 'Loose grains cannot be replaced here yet.';
  let statusOpen = $state(false), recordOpen = $state(false), replaceSourceId = $state('');
  const replaceSource = $derived(fraction.sources.find(s => !s.retired_at && s.id === replaceSourceId) ?? fraction.sources.find(s => !s.retired_at));
  useLabProtocols(() => batch.lab_id);
  let status = $state<FractionStatus>(untrack(() => fraction.status)), notes = $state(untrack(() => readCapsulePreparation(fraction.notes).notes));
  const statusReadiness = $derived(fractionStatusReadiness(batch.spikes, fraction.id));
  const rejected = $derived(outbox.entries.find(entry => entry.stopped && (entry.objectKey === `fraction:${fraction.id}` || entry.objectKey === `batch:${batch.id}`) && ['spike_required', 'batch_completed'].includes(entry.errorCode ?? '')));
  const preparation = $derived(readCapsulePreparation(fraction.notes).preparation);
  const isBlank = $derived(preparation === 'lab-blank');
  let error = $state(''), busy = $state(false), feedback = $state('');
  let overrides = $state.raw<Parameters>({}), skipped = $state(false), outcome = $state(''), outcomeNote = $state('');
  let performedAt = $state('');
  let date = $state(''), recordOperator = $state(''), protocolDraft = $state('');
  let bottleChoice = $state('');
  let spikeCanSave = $state(false);
  let repeatDraft = $state(false);
  const replies = new ReplyScope(() => [batch.id, fraction.id]);
  let formGeneration = 0;
  const spikeSave = new OnlineAction<SpikeAddition>();
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
      const key = source.loose_grain_id ?? source.grain_id ?? source.atlas_grain_id ?? source.id;
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
  const bottle = $derived(session?.bottles.find(row => addition
    ? row.versionId === addition.spike_version_id || row.bottleId === additionVersion?.subfraction_id
    : row.bottleId === bottleChoice) ?? (!addition && !bottleChoice && session?.bottles.length === 1 ? session.bottles[0] : undefined));
  const latest = $derived(step && (bottle || addition) ? latestBottleReading(batch.spikes, sessionStepIds, bottle ?? {
    bottleId: additionVersion?.subfraction_id ?? '', versionId: addition!.spike_version_id, label: '', before: '',
  }, batch.spike_versions) : undefined);
  const historicalSpike = $derived(!!addition && !!latest && laterWeighing(latest, addition));
  const startWeight = $derived(addition?.bottle_before_g ?? (addition ? '' : latest?.bottle_after_g ?? bottle?.before ?? ''));
  const spikeKeys = ['spike_weight_g', 'bottle_before_g', 'bottle_after_g'];

  $effect(() => {
    const id = activeStep; void fraction.id;
    untrack(() => {
      status = fraction.status; notes = readCapsulePreparation(fraction.notes).notes;
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
      date = record && Object.hasOwn(record, 'performed_on') ? record.performed_on ?? '' : capsule.date;
      recordOperator = record?.operator_name ?? '';
      performedAt = record?.performed_at?.slice(0,19) ?? '';
      protocolDraft = columnRecord.protocol;
      resetSpikeForm(false);
    });
  });

  function resetSpikeForm(repeat: boolean) {
    repeatDraft = repeat;
    bottleChoice = session?.bottles.find(row => row.versionId === addition?.spike_version_id)?.bottleId ?? '';
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
      if (settled()) error = timsError(e);
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
      performed_on: date || null, performed_at: performedAt ? new Date(performedAt + 'Z').toISOString() : null, operator_name: recordOperator, parameters: overrides, skipped, outcome, outcome_note: column ? writeColumnNotes(plainNotes, protocolDraft) : plainNotes,
    }));
  }

  async function saveSpike(body: SpikeInput): Promise<SpikeAddition> {
    if (!step || !sessionStep) throw new Error('Choose a spiking step first.');
    const current = replies.capture(() => [activeStep, repeatDraft]);
    const batchId = batch.id, fractionId = fraction.id;
    const target = repeatDraft ? (emptyRepeat ?? await createSpikeStep(sessionStep)).id : step.id;
    const row = await spikeSave.send(`/v1/tims/batches/${encodeURIComponent(batchId)}/fractions/${encodeURIComponent(fractionId)}/steps/${encodeURIComponent(target)}/spike`, 'PUT', body, `batch:${batchId}`);
    if (repeatDraft && current()) { onspike(row); onstep(target); }
    return row;
  }

</script>

<div class="stack fraction-editor">
  <div class="fraction-scroll stack" use:stableScroll={`${batch.id}:capsule`}>
  <SegmentedControl label="Capsule navigation" size="small" wrap
    value={sessionStep?.id ?? step?.id ?? ''} onchange={onstep}
    options={[{value:'',label:preparation ? 'Capsule record' : 'Sources'}, ...chemistrySteps.map(s => ({value:s.id,label:`${repeats.has(s.method_code) ? `${s.ordinal}. ` : ''}${s.method_name}${recordSteps.has(s.id) ? ' · recorded' : ''}`}))]} />
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
          {#if names.loose}
            <div id={`${uid}-${source.id}-image`} class="loose-image small muted">Loose grain · No GrainAtlas image.</div>
          {:else}<GrainImage {source} {mount} size={104} {geometryError} />{/if}
          <div class="stack labels">
            {#if sources.some(s => s.spot_id || s.atlas_spot_id)}
              <ul aria-label="Linked LA spots">{#each sources.filter(s => s.spot_id || s.atlas_spot_id) as linked (linked.id)}<li><strong>{sourceNames(linked, mount).spot}</strong></li>{/each}</ul>
            {:else}<span class="small muted">No linked LA spots</span>{/if}
            <p class="small muted">{names.loose ? 'Loose grain' : `Mount: ${names.mount}`} · Grain: {names.grain}</p>
            {#each [...new Set(sources.filter(s => s.is_fragment).map(s => s.fragment_note))] as fragmentNote}<p class="small warning">Fragment · {fragmentNote}</p>{/each}
            {#each [...new Set(sources.map(s => s.note).filter(Boolean))] as note}<p class="small">{note}</p>{/each}
            {#each sources as linked (linked.id)}
              {@const loose = isLooseGrain(linked)}
              <div class="row" aria-label={`Source ${loose ? `Loose grain ${sourceNames(linked).grain}` : sourceNames(linked, mount).spot}`}>
                <button type="button" class="btn small" disabled={!editable || loose} title={loose ? looseReplaceReason : undefined}
                  aria-describedby={loose ? `${uid}-${linked.id}-replace` : undefined} onclick={() => onreplace(linked)}>Replace grain</button>
                {#if isDesktop || shell.homeUrl('images')}<button type="button" class="btn small" disabled={!editable || loose || !mount?.current_project_uuid}
                  title={loose ? 'Loose grains have no GrainAtlas project.' : !mount?.current_project_uuid ? 'No GrainAtlas project is recorded for this source.' : undefined}
                  aria-describedby={loose ? `${uid}-${source.id}-image` : undefined}
                  onclick={() => void onrefine(linked)}>Refine in GrainAtlas</button>{/if}
              </div>
              {#if loose}<p id={`${uid}-${linked.id}-replace`} class="small muted">{looseReplaceReason}</p>{/if}
            {/each}
          </div>
        </article>
      {:else}<p class="muted">No grain linked to this fraction.</p>{/each}
      {/if}
      {#each fraction.replaced_sources ?? [] as retired (retired.id)}
        {@const names = sourceNames(retired)}
        <p class="small muted">Replaced {names.loose ? 'Loose grain · Grain: ' : ''}{names.grain}{names.spot !== 'Not recorded' ? ` (spot ${names.spot})` : ''} · {retired.retired_by_name ?? 'Unknown viewer'} · {retired.retired_at ? new Date(retired.retired_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Date unrecorded'}{retired.reason ? ` · ${retired.reason}` : ''}</p>
      {/each}
      {#if fraction.replaces}
        <p class="small muted">Replaces {fraction.replaces.name} · {fraction.replaces.sample_name} · {fraction.replaces.retired_by_name ?? 'Unknown viewer'} · {fraction.replaces.retired_at ? new Date(fraction.replaces.retired_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Date unrecorded'}{fraction.replaces.source_labels?.length ? ` · ${fraction.replaces.source_labels.join(', ')}` : ''}</p>
        {#each fraction.replaces.sources ?? [] as retired}
          {@const names = sourceNames(retired)}
          <p class="small muted">Replaced {names.loose ? `Loose grain · Grain: ${names.grain}` : `${names.grain} (spot ${names.spot})`}</p>
        {/each}
      {/if}
    </section>
    <details class="details" ontoggle={event => statusOpen = event.currentTarget.open}>
      <summary>Fraction status and notes</summary>
      {#if statusOpen}<form id={`${uid}-status`} class="stack" onsubmit={e => { e.preventDefault(); void run(() => { if (statusReadiness.options.some(option => option.value === status && option.disabled)) throw new Error(statusReadiness.message); return tims.patchFraction(fraction.id, { status, notes: writeCapsulePreparation(preparation, notes) }); }); }}>
        <label>Status <select aria-label="Status" aria-describedby={statusReadiness.message ? `${uid}-spike-required` : undefined} bind:value={status} disabled={!editable || busy}>{#each statusReadiness.options as option (option.value)}<option value={option.value} disabled={option.disabled}>{statusWords(option.value)}</option>{/each}</select></label>
        {#if statusReadiness.message}<p id={`${uid}-spike-required`} class="small muted">{statusReadiness.message}</p>{/if}
        <label>Fraction notes <textarea rows="3" bind:value={notes} disabled={!editable || busy}></textarea></label>
      </form>{/if}
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
          <div class="row">
            <SegmentedControl label="Spike entries for this capsule" size="small" wrap disabled={busy}
              options={entrySteps.map((entry,index) => ({value:entry.id,label:`Entry ${index+1}`}))}
              value={repeatDraft ? '' : activeStep} onchange={id => { if (id === activeStep) resetSpikeForm(false); else onstep(id); }} />
            {#if repeatDraft}<strong class="small">New spike entry</strong>{/if}
          </div>
        {/if}
        {#key `${fraction.id}:${activeStep}:${repeatDraft}`}
          <RequiredSpike {batch} {addition} pending={repeatDraft ? {} : { spike_version_id: String(batch.steps.find(s => s.id === activeStep)?.parameters.spike_version ?? batch.default_spike_version_id ?? ''), ...batch.fraction_step_records.find(r => r.fraction_id === fraction.id && r.step_id === activeStep)?.spike_metadata, expected_updated_at: batch.fraction_step_records.find(r => r.fraction_id === fraction.id && r.step_id === activeStep)?.updated_at }} bottles={(session?.bottles ?? []).map(bottle => ({ ...bottle, before: latestBottleReading(batch.spikes, sessionStepIds, bottle, batch.spike_versions)?.bottle_after_g ?? bottle.before }))} {startWeight} historical={historicalSpike} {editable} formId={`${uid}-spike`} onstate={canSave => spikeCanSave = canSave} onsave={saveSpike} onaccept={onspike} />
        {/key}
        {#if repeatDraft}<button class="btn small" type="button" onclick={() => resetSpikeForm(false)}>Cancel entry</button>
        {:else if addition && editable}<button class="btn small" type="button" disabled={busy || !emptyRepeat && !!onlineOnlyReason()} onclick={() => resetSpikeForm(true)}>Add another spike entry</button>{/if}
        {#if step.id === sessionStep?.id && !repeatDraft}<details class="details" ontoggle={event => recordOpen = event.currentTarget.open}>
          <summary>Spiking step record{skipped ? ' · skipped' : ''}</summary>
          <form id={`${uid}-record`} class="stack" onsubmit={e => { e.preventDefault(); void saveRecord(); }}>
            <ParameterFields definitions={step.parameter_definitions} values={overrides} onchange={v => overrides = v} inherited={step.parameters} knownVersions={batch.spike_versions} fraction disabled={!editable || busy} lab={batch.lab_id} />
            <label class="check"><input type="checkbox" bind:checked={skipped} disabled={!editable || busy} /> Skipped</label>
            <label>Step note <textarea rows="2" bind:value={outcomeNote} disabled={!editable || busy}></textarea></label>
          </form>
        </details>{/if}
      {:else}
        {@const values = effectiveParameters(step.parameters, { parameters: overrides })}
        {@const outcomes = choices(step.parameter_definitions.find(d => d.role === 'outcome') ?? { name: 'outcome' })}
        <form id={`${uid}-record`} class="stack" onsubmit={e => { e.preventDefault(); void saveRecord(); }}>
          {#if values.length}<p class="small muted">{values.map(p => `${parameterSummary(step.parameter_definitions.find(d => parameterKey(d) === p.key) ?? { name: p.key }, p.value, batch.spike_versions)}${p.overridden ? ' (overridden)' : ''}`).join(' · ')}</p>{/if}
          <label>Capsule date <input type="date" bind:value={date} disabled={!editable || busy} /></label>
          <label>Capsule performed at (UTC, optional) <input type="datetime-local" bind:value={performedAt} disabled={!editable || busy} /></label>
          <label>Capsule operator <input bind:value={recordOperator} placeholder={batch.operator_name || "Batch operator"} disabled={!editable || busy} /></label>
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
        </form>
      {/if}
    {/key}
  {/if}
  <p class="status-line small" class:error={!!error} role="status">{error || (rejected ? timsError({ code: rejected.errorCode, status: rejected.lastStatus }) : feedback)}</p>
  </div>
  <div class="actions row" role="group" aria-label="Capsule actions">
    {#if !step}
      {#if !isBlank}<button class="btn small" type="button" disabled={!editable} onclick={onpick}>Add source</button>{/if}
      {#if replaceSource}
        {#if fraction.sources.filter(s => !s.retired_at).length > 1}
          <select aria-label="Source to replace" bind:value={replaceSourceId}>
            {#each fraction.sources.filter(s => !s.retired_at) as source (source.id)}
              {@const names = sourceNames(source, source.mount_id ? geometry[source.mount_id] : undefined)}
              <option value={source.id}>{names.loose ? `Loose grain · Grain: ${names.grain}` : names.spot}</option>
            {/each}
          </select>
        {/if}
        <button class="btn small" type="button" disabled={!editable || isLooseGrain(replaceSource)}
          title={isLooseGrain(replaceSource) ? looseReplaceReason : undefined}
          aria-describedby={isLooseGrain(replaceSource) ? `${uid}-${replaceSource.id}-replace` : undefined}
          onclick={() => onreplace(replaceSource!)}>Replace grain</button>
      {/if}
      {#if statusOpen}<button class="btn small" form={`${uid}-status`} disabled={!editable || busy}>Save fraction here</button>{/if}
    {:else if spiking}
      <button class="btn primary small" form={`${uid}-spike`} disabled={!spikeCanSave}>Save spike here</button>
      {#if recordOpen}<button class="btn small" form={`${uid}-record`} disabled={!editable || busy}>Save capsule record here</button>{/if}
    {:else}<button class="btn primary small" form={`${uid}-record`} disabled={!editable || busy}>Save capsule record here</button>{/if}
  </div>
</div>

<style>
  .fraction-editor { gap: 0; }
  .loose-image { width: 104px; height: 104px; flex-shrink: 0; display: grid; place-items: center; padding: var(--space-2); box-sizing: border-box; text-align: center; border: 1px solid var(--hairline); border-radius: var(--radius-sm); background: var(--row-hover); }
  .fraction-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; overflow-anchor: none; padding: 2px; gap: var(--space-2); }
  .fraction-scroll > :global(*) { flex-shrink: 0; }
  .status-line { height: 42px; overflow: auto; }
  .actions { min-height: 56px; align-content: start; flex-shrink: 0; border-top: 1px solid var(--hairline); padding-top: var(--space-2); gap: 4px; background: var(--bg); }
  .actions select { max-width: 10rem; }
  h4, p { margin: 0; }
  .row { flex-wrap: wrap; }
  .heading { justify-content: space-between; }
  .source { display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: var(--space-2); align-items: center; }
  .labels { min-width: 0; gap: var(--space-1); overflow-wrap: anywhere; }
  .labels strong { font-size: 13px; font-weight: 600; }
  ul { padding-left: 1.2em; margin: 0; font-size: .78rem; }
  label { display: grid; gap: 4px; }
  .check { display: flex; align-items: baseline; }
  input:not([type=checkbox]), select, textarea { min-width: 0; width: 100%; }
  .warning { color: var(--warning); }
  .details { border: 1px solid var(--hairline); border-radius: var(--radius-sm); padding: var(--space-2); }
  /* Closed details must not leave offscreen form boxes in either engine. */
  .details:not([open]) > :not(summary) { display: none; }
  .details[open] summary { margin-bottom: var(--space-2); }
</style>
