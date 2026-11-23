<script lang="ts">
  import OperatorName from './OperatorName.svelte';
  import { untrack, onMount, onDestroy } from 'svelte';
  import { identity } from '../../lib/identity.svelte';
  import { timsRights } from '../../lib/tims-rights.svelte';
  import { tims, read, statusWords, parameterSummary, type BatchDetail, type RecipeOut, type FractionOut, type SourceOut, type StepOut } from '../../lib/tims-api';
  import { outbox, onlineOnlyReason, type OutboxEntry } from '../../lib/outbox.svelte';
  import { overlayBatch, batchAffected } from '../../lib/tims-overlay';
  import { batchGeometry, OnlineAction, ReplyScope } from '../../lib/tims-requests';
  import { type MountGeometry } from '../../lib/tims-geometry';
  import { reorder, snapshotName, effectiveParameters, type MethodCode, withDefaults } from '../../lib/tims-model';
  import { oversight, READ_ONLY_REASON } from '../../lib/oversight.svelte';
  import { spikingSessionId, spikingSessionLink } from '../../lib/tims-spiking';
  import { capsulePreparations, readCapsulePreparation, type CapsulePreparation } from '../../lib/tims-capsule-intake';
  import FractionEditor from './FractionEditor.svelte';
  import AtlasPicker from './AtlasPicker.svelte';
  import SampleCapsule from './SampleCapsule.svelte';
  import PuckSet from './PuckSet.svelte';
  import StepEditor from './StepEditor.svelte';
  import ParameterFields from './ParameterFields.svelte';
  import History from './History.svelte';
  let { id, methods, recipes, onlab }: { id: string; methods: MethodCode[]; recipes: RecipeOut[]; onlab: (lab: string) => void } = $props();
  let base = $state.raw<BatchDetail | null>(null), geometry = $state.raw<Record<string, MountGeometry>>({}), error = $state(''), geometryError = $state(''), busy = $state(false);
  let delivered = $state.raw<OutboxEntry[]>([]);
  const views = ['Capsules', 'Batch steps', 'Step × capsule matrix'] as const;
  let view = $state<typeof views[number]>('Capsules');
  let selectedStep = $state(''), batchStep = $state(''), selected = $state<number | null>(null);
  let picking = $state(false), pickerOpened = $state(false), imported = $state(''), editing = $state(false), started = $state(''), operator = $state(''), operatorAccount = $state(false), notes = $state('');
  let manualPreparation = $state<CapsulePreparation | null>(null);
  let add = $state(false), method = $state(''), parameters = $state.raw<Record<string, unknown>>({});
  let generation = 0, geometryGeneration = 0;
  const creation = new OnlineAction<unknown>();
  const extraSpikeStep = new OnlineAction<StepOut>();
  const replies = new ReplyScope(() => id);
  let formGeneration = 0;
  let destroyed = false;
  onDestroy(() => { destroyed = true; replies.invalidate(); });
  const batch = $derived(base ? overlayBatch(base, [...delivered, ...outbox.entries]).batch : null);
  const editable = $derived(!!batch && timsRights.canEdit(batch.lab_id, `batch:${batch.id}`));
  const fraction = $derived(selected === null ? undefined : batch?.fractions.find(f => f.id === batch?.capsule_map[String(selected)]));
  const preparation = $derived(fraction ? readCapsulePreparation(fraction.notes).preparation : null);
  const defaultMineral = $derived(recipes.find(recipe => recipe.id === batch?.recipe_id)?.mineral ?? 'zircon');
  const label = $derived(selected === null || !batch ? '' : batch.capsule_set.capsule_labels[selected - 1] ?? batch.capsule_set.code + selected);
  const fractionEditable = $derived(editable && (!fraction || timsRights.canEdit(fraction.lab_id, `fraction:${fraction.id}`)));
  const visibleSteps = $derived(batch?.steps.filter(s => spikingSessionId(s) === s.id || !batch?.steps.some(root => root.id === spikingSessionId(s))) ?? []);
  const currentStep = $derived(visibleSteps.find(s => s.id === batchStep) ?? visibleSteps[0]);
  const currentStepIndex = $derived(batch?.steps.findIndex(s => s.id === currentStep?.id) ?? -1);
  const currentCapsuleStep = $derived(batch?.steps.find(s => s.id === selectedStep));
  const selectedMethod = $derived(methods.find(m => m.code === method));
  const source = () => `${identity.target?.server}:${identity.revision}`;
  $effect(() => { void id; void identity.revision; void identity.target?.server; untrack(() => { generation++; geometryGeneration++; base = null; delivered = []; geometry = {}; selected = null; picking = false; pickerOpened = false; manualPreparation = null; imported = ''; editing = false; add = false; void load(true); }); });
  onMount(() => {
    const unsubscribe = outbox.subscribe(entry => {
      if (!base || !batchAffected(base, entry.objectKey)) return;
      if (entry.path.endsWith('/spike') || base.steps.some(s => s.method_code === 'SP-TIMS-SPIKE' && entry.path.endsWith(`/steps/${s.id}`))) {
        // Keep the current reading visible until the server's batch reply includes it.
        delivered = [...delivered, entry];
      }
      void load();
    });
    return () => { generation++; geometryGeneration++; unsubscribe(); };
  });
  async function load(outlines = false, revalidateGeometry = false) {
    const gen = ++generation, owner = source(), current = replies.capture(); busy = true; error = '';
    try {
      const result = await tims.batch(id); if (gen !== generation || !current()) return; base = result; delivered = []; onlab(result.lab_id);
      if (outlines) loadGeometry(result, revalidateGeometry);
    } catch (e) { if (gen === generation && owner === source() && current()) error = String(e); } finally { if (gen === generation && current()) busy = false; }
  }
  function loadGeometry(result: BatchDetail, revalidate = false) {
    const gen = ++geometryGeneration, current = replies.capture();
    geometryError = '';
    void batchGeometry(result, (mount, value) => {
      if (gen === geometryGeneration && current()) geometry = { ...geometry, [mount]: value };
    }, error => {
      if (gen === geometryGeneration && current()) geometryError = String(error);
    }, revalidate);
  }

  function choose(position: number, step = '') {
    selected = position;
    selectedStep = step;
    imported = '';
    manualPreparation = null;
    picking = false;
    view = 'Capsules';
  }

  function acceptFraction(value: FractionOut) {
    if (destroyed || !base || value.batch_id !== base.id || value.capsule_number === null) return;
    generation++;
    busy = false;
    const position = value.capsule_number;
    base = {
      ...base,
      fractions: [...base.fractions.filter(f => f.id !== value.id), value],
      capsule_map: { ...base.capsule_map, [position]: value.id },
    };
    if (value.sources.some(source => !source.retired_at && source.mount_id)) loadGeometry(base);
    if (selected === position) {
      const kind = readCapsulePreparation(value.notes).preparation;
      const capsule = value.capsule_label ?? label;
      imported = kind === 'lab-blank' ? `${capsule} is ready for blank chemistry.` : `Loaded ${value.name} into ${capsule}.`;
      if (kind === 'lab-blank' && currentCapsuleStep?.method_code !== 'SP-TIMS-SPIKE') {
        selectedStep = base.steps.find(step => step.method_code === 'SP-TIMS-SPIKE' && spikingSessionId(step) === step.id)?.id ?? '';
      }
      picking = false;
      manualPreparation = null;
    }
  }

  function acceptSource(id: string, source: SourceOut) {
    if (destroyed || !base) return;
    const target = base.fractions.find(f => f.id === id);
    if (!target) return;
    generation++;
    busy = false;
    const updated = { ...target, sources: [...target.sources.filter(s => s.id !== source.id), source] };
    base = { ...base, fractions: base.fractions.map(f => f.id === id ? updated : f) };
    loadGeometry(base);
    if (target.capsule_number === selected) {
      imported = 'Grain source linked.';
      picking = false;
    }
  }

  async function run(action: () => Promise<unknown>, success?: () => void) {
    const current = replies.capture(() => [formGeneration, editing, add, started, operator, operatorAccount, notes, method, parameters]);
    error = ''; try { await action(); if (current()) success?.(); } catch (e) { if (current()) error = String(e); }
  }
  async function createStep() {
    if (!selectedMethod) return;
    await run(() => creation.send(`/v1/tims/batches/${encodeURIComponent(id)}/steps`, 'POST', { method_code: method, parameters }, `batch:${id}`), () => {
      add = false;
      void load().then(() => { batchStep = batch?.steps.at(-1)?.id ?? ''; });
    });
  }

  async function createSpikeStep(session: StepOut) {
    const current = replies.capture();
    const created = await extraSpikeStep.send(`/v1/tims/batches/${encodeURIComponent(id)}/steps`, 'POST', {
      method_code: session.method_code, parameters: session.parameters, performed_on: session.performed_on, notes: spikingSessionLink(session.id),
    }, `batch:${id}`);
    if (current() && base) {
      base = { ...base, steps: [...base.steps.filter(s => s.id !== created.id), created] };
      if (busy) void load();
    }
    return created;
  }

  function moveStep(index: number, direction: number) {
    if (!batch) return;
    const destination = batch.steps.indexOf(visibleSteps[visibleSteps.indexOf(batch.steps[index]) + direction]);
    if (destination < 0) return;
    void run(() => tims.orderSteps(id, reorder(batch!.steps, index, destination - index).map(s => s.id)));
  }
</script>

<section class="stack batch" aria-label="Chemistry batch">
  {#if error}<p class="error" role="status">{error}</p>{/if}
  {#if !batch}
    <p>{busy ? 'Loading batch…' : 'Batch unavailable.'}</p>
  {:else}
    <header class="panel stack">
      <div class="row heading">
        <div class="stack title"><h2>{batch.capsule_set.name} ({batch.capsule_set.code}) · {batch.started_on}</h2>
          <p class="small muted"><OperatorName {batch} /> · {snapshotName(batch, recipes)}</p>
        </div>
        <div class="row">
          <button type="button" class="btn small" onclick={() => void load(true, true)} disabled={busy}>Refresh batch</button>
          <button type="button" class="btn small" disabled={!editable} onclick={() => {
            if (!batch) return;
            formGeneration++;
            started = batch.started_on;
            operator = batch.operator_name;
            operatorAccount = batch.operator_id === identity.account?.id;
            notes = batch.notes;
            editing = !editing;
          }}>{editing ? 'Cancel edit' : 'Edit batch'}</button>
          <History kind="batch" {id} />
        </div>
      </div>
      {#if batch.notes && !editing}<p class="small">{batch.notes}</p>{/if}
      {#if outbox.entries.some(e => batch && batchAffected(batch, e.objectKey))}<p class="small" role="status">Saved here, not sent yet</p>{/if}
      {#if !editable}<p class="small muted">{oversight.viewAs ? READ_ONLY_REASON : timsRights.recordReason(`batch:${id}`) || 'Lab membership is required to edit this batch.'}</p>{/if}
      {#if editing}
        <form class="stack" onsubmit={e => {
          e.preventDefault();
          void run(() => tims.patchBatch(id, { started_on: started, operator_id: operatorAccount ? identity.account!.id : null, operator_name: operatorAccount ? identity.account?.display_name || identity.account?.username || '' : operator, notes }), () => editing = false);
        }}>
          <label>Started date <input type="date" required bind:value={started} disabled={!editable} /></label>
          <label class="check"><input type="checkbox" bind:checked={operatorAccount} disabled={!editable} /> Use my account as operator</label>
          <label>Operator name <input bind:value={operator} disabled={!editable || operatorAccount} /></label>
          <label>Batch notes <textarea rows="3" bind:value={notes} disabled={!editable}></textarea></label>
          <button class="btn" disabled={!editable}>Save batch here</button>
        </form>
      {/if}
    </header>

    <div class="row views" role="group" aria-label="Batch views">
      {#each views as tab}
        <button class="btn" type="button" aria-pressed={view === tab} onclick={() => view = tab}>{tab}</button>
      {/each}
    </div>

    <div class="bench" class:inspecting={selected !== null} class:inactive={view !== 'Capsules'}>
        <section class="panel stack board" aria-label="Capsule grid">
          <div class="row heading">
            <h3>Capsule pucks</h3>
            <span class="small muted">{Object.values(batch.capsule_map).filter(Boolean).length} of {batch.capsule_set.positions} assigned</span>
          </div>
          <PuckSet {batch} {geometry} {geometryError} {selected}
            onselect={position => {
              if (selected !== position) choose(position, currentCapsuleStep?.method_code === 'SP-TIMS-SPIKE' ? spikingSessionId(currentCapsuleStep) : '');
            }} />
          <div class="row legend small muted"><span><i></i> Assigned</span><span><i class="empty"></i> Empty</span>{#if batch.capsule_set.positions_per_puck === 5}<span>Clockwise from front left</span>{/if}</div>
          {#if selected === null}<p class="small muted">Select a capsule to prepare it or view its chemistry.</p>{/if}
          {#if geometryError}<p class="error small">Grain outlines unavailable: {geometryError}</p>{/if}
        </section>

        {#if selected !== null}
          <section class="panel stack inspector" aria-label="Capsule details">
            <div class="row heading inspector-head">
              <div class="stack title"><h3>{label}{fraction ? ` · ${fraction.name}` : ''}</h3>
                <p class="muted small">{fraction ? [preparation && capsulePreparations[preparation], fraction.sample.name, statusWords(fraction.status)].filter(Boolean).join(' · ') : 'Empty capsule'}</p>
              </div>
              <button class="btn small" type="button" onclick={() => { selected = null; picking = false; }}>Close capsule</button>
            </div>

            {#if imported}<p class="small success" role="status">{imported}</p>{/if}
            {#if !fraction && editable}
              <div class="row intake" role="group" aria-label="Prepare empty capsule">
                <button class="btn small" type="button" aria-pressed={picking && !manualPreparation} onclick={() => { manualPreparation = null; picking = true; pickerOpened = true; }}>GrainAtlas</button>
                <button class="btn small" type="button" aria-pressed={manualPreparation === 'tims-only'} onclick={() => { picking = false; manualPreparation = 'tims-only'; }}>TIMS only</button>
                <button class="btn small" type="button" aria-pressed={manualPreparation === 'lab-blank'} onclick={() => { picking = false; manualPreparation = 'lab-blank'; }}>Lab blank</button>
              </div>
            {/if}
            {#if pickerOpened}
              <div class:inactive={!picking}>
              <AtlasPicker batch={id} lab={batch.lab_id} position={selected} {label} {fraction} editable={fractionEditable}
                {defaultMineral} oncreated={acceptFraction}
                onlinked={acceptSource} close={() => picking = false} />
              </div>
            {/if}
            {#if !fraction && manualPreparation && editable}
              {#key `${selected}:${manualPreparation}`}
                <SampleCapsule preparation={manualPreparation} batch={id} lab={batch.lab_id} position={selected} {label} {defaultMineral} {editable} oncreated={acceptFraction} />
              {/key}
            {:else if !picking && fraction}
              {#key fraction.id}
                <FractionEditor {batch} {fraction} editable={fractionEditable} {geometry} {geometryError}
                  activeStep={selectedStep} onstep={step => selectedStep = step}
                  onbatchstep={step => { batchStep = step; view = 'Batch steps'; }} {createSpikeStep}
                  onpick={() => { picking = true; pickerOpened = true; imported = ''; }} />
              {/key}
            {:else if !picking}
              <p class="muted">{editable ? 'Choose how to prepare this capsule.' : 'This capsule is available.'}</p>
            {/if}
          </section>
        {/if}
      </div>
    {#if view === 'Batch steps'}
      <section class="panel stack steps" aria-label="Step timeline">
        <div class="row heading"><h3>Batch steps</h3><button type="button" class="btn small" disabled={!editable || !!onlineOnlyReason()} title={onlineOnlyReason()} onclick={() => { formGeneration++; add = !add; }}>{add ? 'Cancel add' : 'Add step'}</button></div>
        {#if add}
          <form class="panel stack" onsubmit={e => { e.preventDefault(); void createStep(); }}>
            <label>Step method <select required bind:value={method} onchange={() => parameters = withDefaults(selectedMethod?.parameters ?? [])}><option value="">Choose method</option>{#each methods as m}<option value={m.code}>{m.name}</option>{/each}</select></label>
            {#if selectedMethod}{#key method}<ParameterFields definitions={selectedMethod.parameters} values={parameters} onchange={v => parameters = v} lab={batch.lab_id} />{/key}{/if}
            <button class="btn primary" disabled={!editable || !!onlineOnlyReason()}>Create step</button>
          </form>
        {/if}
        {#if currentStep}
          <div class="step-columns">
            <div class="step-list" role="group" aria-label="Choose a batch step">
              {#each visibleSteps as step (step.id)}
                <button class="btn" type="button" aria-pressed={currentStep.id === step.id} onclick={() => batchStep = step.id}>
                  <span class="muted small">{visibleSteps.indexOf(step) + 1}</span><span>{step.method_name}</span>
                </button>
              {/each}
            </div>
            {#key currentStep.id}
              <StepEditor step={currentStep} knownVersions={batch.spike_versions} batch={id} lab={batch.lab_id} {editable} index={visibleSteps.indexOf(currentStep)}
                sessionStepIds={new Set(batch.steps.filter(s => spikingSessionId(s) === currentStep?.id).map(s => s.id))} spikes={batch.spikes}
                total={visibleSteps.length} move={(_, direction) => moveStep(currentStepIndex, direction)} refresh={() => load()} />
            {/key}
          </div>
        {:else}<p class="muted">No steps recorded.</p>{/if}
      </section>
    {:else if view === 'Step × capsule matrix'}
      <section class="panel stack matrix" aria-label="Capsule record matrix">
        <h3>Step × capsule matrix</h3>
        {#each batch.steps as step (step.id)}
          <section class="stack"><h4>{step.method_name}{spikingSessionId(step) !== step.id ? ' · additional entry' : ''}</h4><div class="row">
            {#each batch.fractions.filter(f => f.capsule_number !== null) as f (f.id)}
              {@const record = batch.fraction_step_records.find(r => r.step_id === step.id && r.fraction_id === f.id)}
              {@const spike = batch.spikes.find(r => r.step_id === step.id && r.fraction_id === f.id)}
              {@const kind = readCapsulePreparation(f.notes).preparation}
              <button type="button" class="btn small matrix-cell" onclick={() => choose(f.capsule_number!, step.id)}>
                <strong>{f.capsule_label}</strong> · {spike ? `${spike.spike_weight_g} g` : record?.skipped ? 'skipped' : record?.outcome ? statusWords(record.outcome) : 'no outcome'}
                {#if kind}<span class="small muted">{capsulePreparations[kind]}</span>{/if}
                {#if Object.keys(record?.parameters ?? {}).length}<span class="small muted">Overridden</span>{/if}
                <span class="small">{effectiveParameters(step.parameters, record).map(p => `${parameterSummary(step.parameter_definitions.find(d => (d.config_key ?? d.name) === p.key) ?? { name: p.key }, p.value, batch.spike_versions)}${p.overridden ? ' (overridden)' : ''}`).join(' · ')}</span>
              </button>
            {/each}
          </div></section>
        {:else}<p class="muted">No steps recorded.</p>{/each}
      </section>
    {/if}
  {/if}
</section>

<style>
  .batch, section, header { min-width: 0; }
  h2,h3,h4,p { margin: 0; }
  h2 { font-size: 1.25rem; }
  h3 { font-size: 1rem; }
  .panel { padding: var(--space-3); }
  .row { flex-wrap: wrap; }
  .heading { justify-content: space-between; }
  .title { gap: 3px; }
  .views { gap: 4px; }
  .views .btn[aria-pressed=true], .step-list .btn[aria-pressed=true], .intake .btn[aria-pressed=true] { border-color: var(--accent); background: var(--accent-soft); }
  .inactive { display: none !important; }
  .bench { display: grid; gap: var(--space-3); align-items: start; }
  .bench.inspecting { grid-template-columns: minmax(0, 1.55fr) minmax(320px, 1fr); }
  .board { background: linear-gradient(150deg, var(--glass-strong), var(--glass)); }
  .board, .inspector { padding: var(--space-4); gap: var(--space-4); }
  .legend { gap: var(--space-4); }
  .legend span { display: flex; gap: var(--space-1); align-items: center; }
  .legend i { width: 10px; height: 10px; border: 1px solid var(--accent); background: var(--accent-soft); border-radius: 50%; }
  .legend .empty { border-color: var(--hairline); background: var(--glass-edge); }
  /* Keep scrolled controls inside the padding, away from fractional clip edges. */
  .bench .inspector { margin: 0; max-height: min(620px, 68vh); overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; scroll-padding-block: var(--space-4); }
  /* Scroll the full forms instead of shrinking their wrappers below the content. */
  .inspector > :global(*) { flex-shrink: 0; }
  .inspector-head { padding-bottom: var(--space-2); border-bottom: 1px solid var(--hairline); }
  .success { color: var(--ok); }
  .step-columns { display: grid; grid-template-columns: minmax(155px, 220px) minmax(0, 1fr); gap: var(--space-3); align-items: start; }
  .step-list { display: grid; gap: 4px; max-height: 62vh; overflow: auto; }
  .step-list .btn { display: flex; width: 100%; gap: var(--space-2); text-align: left; white-space: normal; }
  .matrix-cell { display: grid; text-align: left; white-space: normal; }
  label { display: grid; gap: 4px; }
  .check { display: flex; }
  textarea, select, input:not([type=checkbox]) { width: 100%; min-width: 0; }
  @media (max-width: 860px) {
    .bench.inspecting { grid-template-columns: minmax(0, 1fr); }
    .bench .inspector { max-height: none; }
  }
  @media (max-width: 640px) {
    .step-columns { grid-template-columns: minmax(0, 1fr); }
    .step-list { max-height: 180px; }
  }
</style>
