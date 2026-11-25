<script lang="ts">
  import OperatorName from './OperatorName.svelte';
  import { untrack, onMount, onDestroy } from 'svelte';
  import { identity } from '../../lib/identity.svelte';
  import { timsRights } from '../../lib/tims-rights.svelte';
  import { tims, read, statusWords, parameterSummary, type BatchDetail, type RecipeOut, type FractionOut, type SourceOut, type StepOut, type SpikeAddition, type CapsuleReadiness } from '../../lib/tims-api';
  import { outbox, onlineOnlyReason, type OutboxEntry } from '../../lib/outbox.svelte';
  import { overlayBatch, batchAffected } from '../../lib/tims-overlay';
  import { batchGeometry, OnlineAction, ReplyScope, mountElements } from '../../lib/tims-requests';
  import { type MountGeometry } from '../../lib/tims-geometry';
  import { reorder, snapshotName, effectiveParameters, type MethodCode, withDefaults } from '../../lib/tims-model';
  import { oversight, READ_ONLY_REASON } from '../../lib/oversight.svelte';
  import { spikingSessionId, spikingSessionLink } from '../../lib/tims-spiking';
  import { capsulePreparations, readCapsulePreparation, type CapsulePreparation } from '../../lib/tims-capsule-intake';
  import { apps, editInAtlas } from '../../lib/apps.svelte';
  import { grainImages } from '../../lib/tims-grain-image-cache';
  import { revisionChanged, type MountRevision } from '../../lib/tims-refine';
  import { sourceGeometry, sourceNames } from '../../lib/tims-geometry';
  import FractionEditor from './FractionEditor.svelte';
  import AtlasPicker from './AtlasPicker.svelte';
  import SampleCapsule from './SampleCapsule.svelte';
  import PuckSet from './PuckSet.svelte';
  import StepEditor from './StepEditor.svelte';
  import ParameterFields from './ParameterFields.svelte';
  import History from './History.svelte';
  import { batchReadiness, nextIncomplete, timsError } from '../../lib/tims-readiness';
  import { guidedSteps, loadGuidedStep, saveGuidedStep, type GuidedStep } from '../../lib/tims-guidance';
  import { WriteError } from '../../lib/oversight.svelte';
  import { stableScroll } from '../../lib/tims-scroll';
  let { id, methods, recipes, onlab }: { id: string; methods: MethodCode[]; recipes: RecipeOut[]; onlab: (lab: string) => void } = $props();
  let base = $state.raw<BatchDetail | null>(null), geometry = $state.raw<Record<string, MountGeometry>>({}), error = $state(''), geometryError = $state(''), busy = $state(false);
  let delivered = $state.raw<OutboxEntry[]>([]);
  const views = ['Capsules', 'Batch steps', 'Step × capsule matrix'] as const;
  let guided = $state<GuidedStep>(0), completionBusy = $state(false);
  let refused = $state.raw<CapsuleReadiness[]>([]);
  const viewer = () => ({ server: identity.target?.server ?? '', account: identity.account?.id ?? identity.account?.username ?? '' });
  let view = $state<typeof views[number]>('Capsules');
  let selectedStep = $state(''), batchStep = $state(''), selected = $state<number | null>(null);
  let picking = $state(false), pickerOpened = $state(false), imported = $state(''), editing = $state(false), started = $state(''), operator = $state(''), operatorAccount = $state(false), notes = $state('');
  let replacing = $state.raw<SourceOut>();
  let refreshRevision = $state(0), refineNote = $state('');
  const pendingRefines = new Map<string, { revision: MountRevision; until: number }>();
  let checkingRefines = false;
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
  const editable = $derived(!!batch && !batch.completed_at && timsRights.canEdit(batch.lab_id, `batch:${batch.id}`));
  const readiness = $derived(batch ? batchReadiness(batch) : null);
  const capsuleReady = $derived(readiness?.capsules.find(c => c.capsule_number === selected));
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
  $effect(() => { void id; void identity.revision; void identity.target?.server; untrack(() => { guided = loadGuidedStep(viewer(), id); refused = []; generation++; geometryGeneration++; base = null; delivered = []; geometry = {}; selected = null; picking = false; pickerOpened = false; manualPreparation = null; replacing = undefined; pendingRefines.clear(); refineNote = ''; imported = ''; editing = false; add = false; void load(true); }); });
  onMount(() => {
    const unsubscribe = outbox.subscribe(entry => {
      if (!base || !batchAffected(base, entry.objectKey)) return;
      if (entry.path.endsWith('/spike') || base.steps.some(s => s.method_code === 'SP-TIMS-SPIKE' && entry.path.endsWith(`/steps/${s.id}`))) {
        // Keep the current reading visible until the server's batch reply includes it.
        delivered = [...delivered, entry];
      }
      void load();
    });
    const check = () => void checkRefines();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    const timer = setInterval(check, 20_000);
    return () => { clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); generation++; geometryGeneration++; unsubscribe(); };
  });
  async function load(outlines = false, revalidateGeometry = false) {
    if (destroyed) return;
    const gen = ++generation, owner = source(), current = replies.capture(); busy = true; error = '';
    try {
      const result = await tims.batch(id); if (gen !== generation || !current()) return; base = result; delivered = []; if (result.readiness) refused = []; onlab(result.lab_id);
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
    selectedStep = step || (guided === 2 ? batch?.steps.find(s => s.method_code === 'SP-TIMS-SPIKE')?.id ?? '' : guided === 3 ? batch?.steps.find(s => s.method_code !== 'SP-TIMS-SPIKE')?.id ?? '' : '');
    imported = '';
    manualPreparation = null;
    replacing = undefined;
    const next = batch?.fractions.find(f => f.id === batch?.capsule_map[String(position)]);
    picking = !selectedStep && editable && (!next || !readCapsulePreparation(next.notes).preparation);
    if (picking) pickerOpened = true;
    view = 'Capsules';
  }

  function guide(index: GuidedStep) {
    guided = index; saveGuidedStep(viewer(), id, index);
    if (index === 1 || index === 2 || index === 3) choose(selected ?? 1, '');
    if (index === 3) view = 'Batch steps';
    if (index === 4) { picking = false; view = 'Capsules'; }
  }
  function incomplete() {
    if (!readiness) return;
    const next = nextIncomplete(readiness, selected, guided === 1 ? 'grain' : guided === 2 ? 'spike' : 'complete', batch?.capsule_set.positions ?? 0);
    if (next !== null) choose(next);
  }
  function acceptSpike(row: SpikeAddition) {
    if (!base || !base.fractions.some(f => f.id === row.fraction_id)) return;
    base = { ...base, readiness: undefined, spikes: [...base.spikes.filter(s => s.id !== row.id && !(s.fraction_id === row.fraction_id && s.step_id === row.step_id)), row] };
    refused = [];
    // One revalidation after an explicit save; no per-capsule reads.
    void load();
  }
  async function complete(reopen = false) {
    if (!batch || completionBusy) return;
    const current = replies.capture(); completionBusy = true; error = ''; refused = [];
    try { await (reopen ? tims.reopenBatch(id) : tims.completeBatch(id)).send(); if (current()) await load(); }
    catch (e) {
      if (current()) {
        error = e instanceof WriteError && e.status === 404 ? 'This server does not support batch completion yet.' : timsError(e);
        if (e instanceof WriteError && e.code === 'batch_incomplete') {
          const body = e.body as { capsules?: CapsuleReadiness[]; readiness?: { capsules: CapsuleReadiness[] }; missing?: CapsuleReadiness[] };
          refused = body.readiness?.capsules ?? body.capsules ?? body.missing ?? [];
        }
      }
    } finally { if (current()) completionBusy = false; }
  }

  function acceptFraction(value: FractionOut) {
    if (destroyed || !base || value.batch_id !== base.id || value.capsule_number === null) return;
    generation++;
    busy = false;
    const position = value.capsule_number;
    base = {
      ...base, readiness: undefined,
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
    base = { ...base, readiness: undefined, fractions: base.fractions.map(f => f.id === id ? updated : f) };
    loadGeometry(base);
    if (target.capsule_number === selected) {
      imported = 'Grain source linked.';
      picking = false;
    }
  }

  function startReplacement(source: SourceOut) {
    const names = sourceNames(source, source.mount_id ? geometry[source.mount_id] : undefined);
    replacing = { ...source, grain_label: String(names.grain), spot_label: names.spot };
    picking = true; pickerOpened = true;
  }

  async function acceptReplacement(value: FractionOut) {
    if (destroyed || !base || value.batch_id !== base.id) return;
    const position = selected;
    acceptFraction(value);
    if (selected === value.capsule_number) { replacing = undefined; imported = 'Grain replaced.'; }
    await load(true);
    if (selected === position && selected === value.capsule_number) picking = true;
  }

  async function refine(source: SourceOut) {
    if (!source.mount_id) return;
    const current = replies.capture();
    const mountId = source.mount_id;
    try {
      const metadata = await read<MountRevision & { atlas?: { project_id: string } | null }>(`/v1/mounts/${encodeURIComponent(mountId)}`);
      if (!current()) return;
      const mount = geometry[mountId], elements = sourceGeometry(source, mount);
      const spot = source.atlas_spot_id ?? elements.spot?.atlas_spot_id ?? elements.spot?.id;
      const grain = source.atlas_grain_id ?? elements.grain?.atlas_grain_id ?? elements.grain?.id;
      const project = metadata.atlas?.project_id ?? mount?.current_project_uuid;
      if (!project || !spot && !grain) throw new Error('No GrainAtlas project or grain is available for this source.');
      pendingRefines.set(mountId, { revision: metadata, until: Date.now() + 10 * 60_000 });
      refineNote = '';
      await editInAtlas({ project, mount: mountId, ...(spot ? { spot } : { grain }) }, 'tims');
      if (current() && (apps.atlas?.state === 'failed' || apps.atlas?.state === 'missing')) {
        pendingRefines.delete(mountId); error = apps.atlas.message;
      }
    } catch (e) { if (current()) error = String(e); }
  }
  async function checkRefines() {
    for (const [id, pending] of pendingRefines) if (Date.now() >= pending.until) pendingRefines.delete(id);
    if (checkingRefines || document.visibilityState !== 'visible' || !pendingRefines.size) return;
    const current = replies.capture(); checkingRefines = true;
    let changed = false;
    try {
      await Promise.all([...pendingRefines].map(async ([mount, pending]) => {
        try {
          const latest = await read<MountRevision>(`/v1/mounts/${encodeURIComponent(mount)}`);
          if (!current() || pendingRefines.get(mount) !== pending || Date.now() >= pending.until) return;
          if (revisionChanged(pending.revision, latest)) {
            grainImages.invalidateMount(mount);
            const snapshot = await mountElements(mount, true);
            if (!current() || pendingRefines.get(mount) !== pending) return;
            geometry = { ...geometry, [mount]: snapshot };
            pending.revision = latest;
            refreshRevision++;
            changed = true;
            refineNote = 'Updated from GrainAtlas';
          }
        } catch (e) { if (current()) error = String(e); }
      }));
      if (changed && current()) await load();
    } finally { checkingRefines = false; }
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

  async function ensureSpikeStep() {
    const current = replies.capture();
    await run(async () => {
      const row = await extraSpikeStep.send(`/v1/tims/batches/${encodeURIComponent(id)}/steps`, 'POST', { method_code: 'SP-TIMS-SPIKE', parameters: {} }, `batch:${id}`);
      if (current() && base) { base = { ...base, steps: [...base.steps, row] }; selectedStep = row.id; }
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
  <p class="batch-status small" class:error={!!error} role="status">{error || (batch?.completed_at ? `Completed ${batch.completed_at} · ${batch.completed_by_name ?? 'Analyst not supplied'}` : '')}</p>
  {#if !batch}
    <p>{busy ? 'Loading batch…' : 'Batch unavailable.'}</p>
  {:else}
    <nav class="panel stack guided-rail" aria-label="Batch setup steps">
      <div class="guide-buttons">{#each guidedSteps as name, index}<button type="button" class="btn small" aria-current={guided === index ? 'step' : undefined} onclick={() => guide(index as GuidedStep)}>{index + 1}. {name}</button>{/each}</div>
      <div class="row guide-actions"><span class="small progress">{guided === 2 ? `Spike ${readiness?.capsules.filter(c => c.spike).length} of ${readiness?.capsules.length}` : guided === 1 ? `Grains ${readiness?.capsules.filter(c => c.grain).length} of ${batch.capsule_set.positions}` : `${readiness?.capsules.filter(c => !c.missing.length).length} of ${readiness?.capsules.length} capsules complete`}</span>
      <button type="button" class="btn small" disabled={guided === 0} onclick={() => guide((guided - 1) as GuidedStep)}>Back</button>
      <button type="button" class="btn small" disabled={guided === 4} onclick={() => guide((guided + 1) as GuidedStep)}>Next</button>
      <button type="button" class="btn small" onclick={incomplete}>Next incomplete</button></div>
    </nav>
    <header class="panel stack" use:stableScroll>
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
      {#if !editable}<p class="small muted">{oversight.viewAs ? READ_ONLY_REASON : timsRights.recordReason(`batch:${id}`) || (batch.completed_at ? 'Reopen this completed batch to edit it.' : 'Lab membership is required to edit this batch.')}</p>{/if}
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

    <div class="bench">
        <section class="panel stack board" aria-label="Capsule grid" use:stableScroll>
          <div class="row heading">
            <h3>Capsule pucks</h3>
            <span class="small muted">{Object.values(batch.capsule_map).filter(Boolean).length} of {batch.capsule_set.positions} assigned</span>
          </div>
          <PuckSet compact {batch} {geometry} {geometryError} {selected}
            onselect={position => {
              if (selected !== position) choose(position, currentCapsuleStep?.method_code === 'SP-TIMS-SPIKE' ? spikingSessionId(currentCapsuleStep) : '');
            }} />
          <div class="row legend small muted"><span><i></i> Assigned</span><span><i class="empty"></i> Empty</span>{#if batch.capsule_set.positions_per_puck === 5}<span>Clockwise from front left</span>{/if}</div>
          <p class="board-status small muted" class:error={!!geometryError} class:quiet={!geometryError && selected !== null}
            title={geometryError ? `Grain outlines unavailable: ${geometryError}` : 'Select a capsule to prepare it or view its chemistry.'}>
            {geometryError ? `Grain outlines unavailable: ${geometryError}` : 'Select a capsule to prepare it or view its chemistry.'}
          </p>
        </section>

          <section class="panel stack inspector" aria-label="Capsule details">
            {#if selected !== null}
            <div class="row heading inspector-head">
              <div class="stack title"><h3 title={fraction?.name}>{label}{fraction ? ` · ${fraction.name}` : ''}</h3>
                <span class="small capsule-progress">grain {capsuleReady?.grain ? '✓' : 'pending'} · spike {capsuleReady?.spike ? '✓' : 'pending'}</span>
                <p class="muted small">{fraction ? [preparation && capsulePreparations[preparation], fraction.sample.name, statusWords(fraction.status)].filter(Boolean).join(' · ') : 'Empty capsule'}</p>
              </div>
              <div class="row">
                <button class="btn small" type="button" disabled={selected <= 1} onclick={() => choose(selected! - 1, selectedStep)} aria-label="Previous capsule">Previous</button>
                <button class="btn small" type="button" disabled={selected >= batch.capsule_set.positions} onclick={() => choose(selected! + 1, selectedStep)}>Next capsule</button>
                <button class="btn small" type="button" onclick={() => { selected = null; picking = false; replacing = undefined; }}>Close capsule</button>
              </div>
            </div>

            <p class="inspector-status small" role="status">{refineNote || imported}</p>
            {#if !fraction && editable}
              <div class="row intake" role="group" aria-label="Prepare empty capsule">
                <button class="btn small" type="button" aria-pressed={picking && !manualPreparation} onclick={() => { manualPreparation = null; picking = true; pickerOpened = true; }}>GrainAtlas</button>
                <button class="btn small" type="button" aria-pressed={manualPreparation === 'tims-only'} onclick={() => { picking = false; manualPreparation = 'tims-only'; }}>TIMS only</button>
                <button class="btn small" type="button" aria-pressed={manualPreparation === 'lab-blank'} onclick={() => { picking = false; manualPreparation = 'lab-blank'; }}>Lab blank</button>
              </div>
            {/if}
            {#if !fraction && manualPreparation && editable}
              {#key `${selected}:${manualPreparation}`}
                <SampleCapsule preparation={manualPreparation} batch={id} lab={batch.lab_id} position={selected} {label} {defaultMineral} {editable} oncreated={acceptFraction} />
              {/key}
            {:else if fraction}
                {#if guided === 2 && !batch.steps.some(s => s.method_code === 'SP-TIMS-SPIKE')}<button type="button" class="btn primary" disabled={!editable || !!onlineOnlyReason()} onclick={() => void ensureSpikeStep()}>Add required spiking step</button>{/if}
                <FractionEditor {batch} {fraction} editable={fractionEditable} {geometry} {geometryError}
                  activeStep={selectedStep} onstep={step => { selectedStep = step; if (step) picking = false; }}
                  onbatchstep={step => { batchStep = step; view = 'Batch steps'; }} {createSpikeStep}
                  onreplace={startReplacement} onrefine={refine} onspike={acceptSpike}
                  onpick={() => { replacing = undefined; picking = true; pickerOpened = true; imported = ''; }} />
            {:else if !picking}
              <p class="muted">{editable ? 'Choose how to prepare this capsule.' : 'This capsule is available.'}</p>
            {/if}
            {:else}<p class="muted">Select a capsule to see its details.</p>{/if}
          </section>
          <section class="panel picker-panel" aria-label="Grain selection" use:stableScroll>
            {#if guided === 4}
              <section class="stack review-summary" aria-label="Batch completion review">
                <h3>Review & complete</h3>
                <p class="small">Completion needs a spike for every remaining capsule; lost capsules and those dissolved during CA are exempt. Grains and chemistry are shown for checking.</p>
                {#each (refused.length ? refused : readiness?.capsules ?? []) as row}
                  <button class="btn small review-capsule" type="button" onclick={() => { guide(row.missing.length ? 2 : !row.grain ? 1 : 3); choose(row.capsule_number); }}>{batch.capsule_set.capsule_labels[row.capsule_number - 1]}: {row.missing.length ? row.missing.join(', ') + ' pending' : 'Complete'}</button>
                {/each}
                {#if batch.completed_at}<button class="btn" disabled={completionBusy || !timsRights.canEdit(batch.lab_id, `batch:${id}`)} onclick={() => void complete(true)}>Reopen batch</button>
                {:else}<button class="btn primary" disabled={!editable || completionBusy || !!onlineOnlyReason() || !!readiness?.capsules.some(c => c.missing.length) || refused.some(c => c.missing.length)} title={readiness?.capsules.some(c => c.missing.length) ? 'Finish the missing capsule items first.' : ''} onclick={() => void complete()}>Complete batch</button>{/if}
              </section>
            {:else}
              <div class="picker-content" class:inactive={!picking || selected === null}>
            {#if selected !== null && pickerOpened}
            <AtlasPicker batch={id} lab={batch.lab_id} position={selected} {label} {fraction} {replacing} {refreshRevision} editable={fractionEditable}
              {defaultMineral} oncreated={acceptFraction} onlinked={acceptSource} onreplaced={acceptReplacement}
              close={() => { picking = false; replacing = undefined; }} />
            {/if}
              </div>
              {#if !picking || selected === null}<div class="stack picker-placeholder"><h3>GrainAtlas picker</h3><p class="small muted">{guided === 2 ? 'Spike is required for every capsule. Record the weighing in Capsule details.' : guided === 3 ? 'Record batch defaults below, then each capsule’s outcome in Capsule details.' : 'Select a capsule and open GrainAtlas to choose a grain.'}</p></div>{/if}
            {/if}
          </section>
      </div>
    <div class="step-rail panel" aria-label="Chemistry step rail">
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
    {:else}<p class="small muted">{guidedSteps[guided]} · {guided === 0 ? 'Check the capsule set, batch date, operator and recipe above.' : guided === 1 ? 'Assign each capsule, then continue to Spike.' : guided === 2 ? 'Save a spike version and weighed mass for every capsule.' : 'Use Batch steps and the matrix for chemistry records.'}</p>{/if}
    </div>
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
  .views { gap: 4px; height: 32px; overflow: auto; flex-wrap: nowrap; }
  .views .btn { height: 30px; padding: 2px 8px; font-size: .8rem; }
  .views .btn[aria-pressed=true], .step-list .btn[aria-pressed=true], .intake .btn[aria-pressed=true] { border-color: var(--accent); background: var(--accent-soft); }
  .inactive { display: none !important; }
  .batch { flex: 1; min-height: 0; gap: 6px; }
  .batch > .panel, .bench > .panel { margin: 0; }
  .batch > header, .views { flex-shrink: 0; }
  .bench { display: grid; grid-template-columns: 300px calc((100% - 196px) * .48) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); gap: 8px; align-items: stretch; min-height: 0; flex: 1; overflow: hidden; }
  .board { background: linear-gradient(150deg, var(--glass-strong), var(--glass)); overflow: auto; }
  .board, .inspector, .picker-panel { padding: 8px; min-height: 0; min-width: 0; gap: 8px; }
  .bench > .board { gap: 4px; }
  .board > .heading { height: 20px; flex: none; flex-wrap: nowrap; }
  .board > .heading h3 { font-size: .8rem; white-space: nowrap; }
  .board > .heading > span { font-size: .65rem; white-space: nowrap; }
  .board-status { flex: none; height: 14px; line-height: 14px; font-size: .65rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .board-status.quiet { visibility: hidden; }
  .legend { flex: none; height: 12px; line-height: 12px; flex-wrap: nowrap; gap: 6px; font-size: .6rem; }
  .legend span { white-space: nowrap; display: flex; gap: var(--space-1); align-items: center; }
  .legend i { width: 10px; height: 10px; border: 1px solid var(--accent); background: var(--accent-soft); border-radius: 50%; }
  .legend .empty { border-color: var(--hairline); background: var(--glass-edge); }
  .inspector { overflow: hidden; }
  .inspector-head { flex-shrink: 0; padding-bottom: var(--space-2); border-bottom: 1px solid var(--hairline); }
  .picker-panel { overflow: hidden; }
  .inspector :global(.fraction-editor) { flex: 1; min-height: 0; }
  .steps, .matrix { overflow: auto; min-height: 0; }
  .step-columns { display: grid; grid-template-columns: minmax(155px, 220px) minmax(0, 1fr); gap: var(--space-3); align-items: start; }
  .step-list { display: grid; gap: 4px; max-height: 62vh; overflow: auto; }
  .step-list .btn { display: flex; width: 100%; gap: var(--space-2); text-align: left; white-space: normal; }
  .matrix-cell { display: grid; text-align: left; white-space: normal; }
  label { display: grid; gap: 4px; }
  .check { display: flex; }
  textarea, select, input:not([type=checkbox]) { width: 100%; min-width: 0; }
  .batch > header { height: 52px; overflow: auto; padding: 6px 8px; scrollbar-gutter: stable; overflow-anchor: none; }
  .batch > header > .heading { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 8px; align-items: start; }
  .batch > header .title h2 { font-size: 1rem; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .batch > header .title p { line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .batch-status { height: 20px; min-height: 20px; overflow: auto; scrollbar-gutter: stable; }
  .guided-rail { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; height: 40px; flex: none; padding: 4px; gap: 8px; }
  .guide-buttons { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, .7fr) minmax(0, .6fr) minmax(0, 1fr) minmax(0, 1.6fr); gap: 4px; }
  .guide-buttons .btn { width: 100%; max-width: 100%; min-width: 0; height: 28px; padding: 2px; font-size: .72rem; white-space: normal; line-height: 1.1; }
  .guide-buttons [aria-current=step] { background: var(--accent-soft); border-color: var(--accent); }
  .guide-actions .btn { height: 28px; padding: 2px 6px; font-size: .75rem; white-space: nowrap; }
  .guide-actions { flex-wrap: nowrap; gap: 4px; }
  .progress { width: clamp(100px, 10vw, 140px); font-size: .72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inspector-head { height: 88px; flex-direction: column; flex-wrap: nowrap; align-items: stretch; justify-content: start; gap: 4px; }
  .inspector-head .title { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; width: 100%; min-width: 0; }
  .inspector-head h3 { line-height: 20px; }
  .inspector-head p { grid-column: 1 / -1; line-height: 17px; }
  .inspector-head h3, .inspector-head p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inspector-head > .row { flex-wrap: nowrap; gap: 4px; }
  .inspector-head .btn { height: 28px; padding: 2px 6px; font-size: .75rem; white-space: nowrap; }
  .capsule-progress { display: block; height: 18px; font-size: .68rem; white-space: nowrap; }
  .inspector { gap: 4px; }
  .inspector-status { height: 20px; min-height: 20px; overflow: auto; }
  .picker-content { height: 100%; min-height: 0; }
  .picker-placeholder, .review-summary { height: 100%; overflow: auto; scrollbar-gutter: stable; padding: 2px; }
  .review-capsule { min-height: 34px; flex: none; white-space: normal; }
  .step-rail { height: clamp(56px, calc(40vh - 200px), 160px); flex: none; overflow: auto; scrollbar-gutter: stable; padding: 6px; }
  .step-rail .steps, .step-rail .matrix { overflow: visible; }
  @media (max-width: 1279px) {
    .bench { grid-template-columns: 160px calc((100% - 176px) * .5) calc((100% - 176px) * .5); }
    .board > .heading { height: 48px; overflow: hidden; flex-wrap: wrap; }
    .board .legend { display: none; }

  }
</style>
