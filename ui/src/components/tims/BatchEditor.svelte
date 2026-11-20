<script lang="ts">
  import OperatorName from './OperatorName.svelte';
  import GrainImage from './GrainImage.svelte';
  import { untrack, onMount, onDestroy } from 'svelte';
  import { identity } from '../../lib/identity.svelte';
  import { timsRights } from '../../lib/tims-rights.svelte';
  import { tims, read, statusWords, parameterSummary, type BatchDetail, type RecipeOut } from '../../lib/tims-api';
  import { outbox, onlineOnlyReason } from '../../lib/outbox.svelte';
  import { overlayBatch, batchAffected } from '../../lib/tims-overlay';
  import { batchGeometry, OnlineAction, ReplyScope } from '../../lib/tims-requests';
  import { capsulePucks, type MountGeometry } from '../../lib/tims-geometry';
  import { reorder, snapshotName, effectiveParameters, type MethodCode, withDefaults } from '../../lib/tims-model';
  import { oversight, READ_ONLY_REASON } from '../../lib/oversight.svelte';
  import FractionEditor from './FractionEditor.svelte';
  import StepEditor from './StepEditor.svelte';
  import ParameterFields from './ParameterFields.svelte';
  import History from './History.svelte';
  let { id, methods, recipes, onlab }: { id: string; methods: MethodCode[]; recipes: RecipeOut[]; onlab: (lab: string) => void } = $props();
  let base = $state.raw<BatchDetail | null>(null), geometry = $state.raw<Record<string, MountGeometry>>({}), error = $state(''), geometryError = $state(''), busy = $state(false);
  let selectedStep = $state('');
  let selected = $state<string | null>(null), matrix = $state(false), editing = $state(false), started = $state(''), operator = $state(''), operatorAccount = $state(false), notes = $state('');
  let add = $state(false), method = $state(''), parameters = $state.raw<Record<string, unknown>>({});
  let generation = 0, geometryGeneration = 0;
  const creation = new OnlineAction<unknown>();
  const replies = new ReplyScope(() => id);
  let formGeneration = 0;
  onDestroy(() => replies.invalidate());
  const batch = $derived(base ? overlayBatch(base, outbox.entries).batch : null);
  const editable = $derived(!!batch && timsRights.canEdit(batch.lab_id, `batch:${batch.id}`));
  const fraction = $derived(batch?.fractions.find(f => f.id === selected));
  const selectedMethod = $derived(methods.find(m => m.code === method));
  const source = () => `${identity.target?.server}:${identity.revision}`;
  $effect(() => { void id; void identity.revision; void identity.target?.server; untrack(() => { generation++; geometryGeneration++; base = null; geometry = {}; selected = null; editing = false; add = false; void load(true); }); });
  onMount(() => { const saved = (event: Event) => { const key = (event as CustomEvent<{ objectKey: string }>).detail?.objectKey; if (base && key && batchAffected(base, key)) void load(); }; window.addEventListener('tims-saved', saved); return () => { generation++; geometryGeneration++; window.removeEventListener('tims-saved', saved); }; });
  async function load(outlines = false, revalidateGeometry = false) {
    const gen = ++generation, owner = source(), current = replies.capture(); busy = true; error = '';
    try {
      const result = await tims.batch(id); if (gen !== generation || !current()) return; base = result; onlab(result.lab_id);
      if (outlines) { const geometryGen = ++geometryGeneration; geometryError = ''; void batchGeometry(result, (mount, value) => { if (geometryGen === geometryGeneration && current()) geometry = { ...geometry, [mount]: value }; }, e => { if (geometryGen === geometryGeneration && current()) geometryError = String(e); }, revalidateGeometry); }
    } catch (e) { if (gen === generation && owner === source() && current()) error = String(e); } finally { if (gen === generation && current()) busy = false; }
  }
  async function run(action: () => Promise<unknown>, success?: () => void) {
    const current = replies.capture(() => [formGeneration, editing, add, started, operator, operatorAccount, notes, method, parameters]);
    error = ''; try { await action(); if (current()) success?.(); } catch (e) { if (current()) error = String(e); }
  }
  async function createStep() { if (!selectedMethod) return; await run(() => creation.send(`/v1/tims/batches/${encodeURIComponent(id)}/steps`, 'POST', { method_code: method, parameters }), () => { add = false; void load(); }); }
</script>
<section class="stack" aria-label="Chemistry batch">
  {#if error}<p class="error" role="status">{error}</p>{/if}
  {#if !batch}<p>{busy ? 'Loading batch…' : 'Batch unavailable.'}</p>{:else}
    <header class="panel stack">
      <div class="row"><h2>{batch.capsule_set.name} ({batch.capsule_set.code}) · {batch.started_on}</h2><button type="button" class="btn" onclick={() => void load(true, true)} disabled={busy}>Refresh batch</button></div>
      <p><OperatorName {batch} /> · {snapshotName(batch, recipes)}</p><p>{batch.notes || 'No batch notes'}</p>
      <p class="small muted">The recipe snapshot is frozen; later recipe edits do not change this batch.</p>
      {#if outbox.entries.some(e => batch && batchAffected(batch, e.objectKey))}<p role="status">Saved here, not sent yet</p>{/if}
      {#if !editable}<p class="muted">{oversight.viewAs ? READ_ONLY_REASON : timsRights.recordReason(`batch:${id}`) || 'Lab membership is required to edit this batch.'}</p>{/if}
      <div class="row"><button type="button" class="btn" disabled={!editable} onclick={() => { if (batch) { formGeneration++; started = batch.started_on; operator = batch.operator_name; operatorAccount = batch.operator_id === identity.account?.id; notes = batch.notes; editing = !editing; } }}>Edit batch</button><History kind="batch" {id} /></div>
      {#if editing}<form class="stack" onsubmit={e => { e.preventDefault(); void run(() => tims.patchBatch(id, { started_on: started, operator_id: operatorAccount ? identity.account!.id : null, operator_name: operatorAccount ? identity.account?.display_name || identity.account?.username || '' : operator, notes }), () => editing = false); }}>
        <label>Started date <input type="date" required bind:value={started} disabled={!editable} /></label><label><input type="checkbox" bind:checked={operatorAccount} disabled={!editable} /> Use my account as operator</label><label>Operator name <input bind:value={operator} disabled={!editable || operatorAccount} /></label><label>Batch notes <textarea bind:value={notes} disabled={!editable}></textarea></label><button class="btn" disabled={!editable}>Save batch here</button>
      </form>{/if}
    </header>
    <section class="panel stack" aria-label="Capsule grid"><h3>Capsules</h3>
      {#if geometryError}<p class="error small">Grain outlines unavailable: {geometryError}</p>{/if}
      <div class="pucks">
      {#each capsulePucks(batch.capsule_set.positions, batch.capsule_set.positions_per_puck) as puck, p}
        <section class="puck stack" aria-label={`Puck ${p + 1}`}><h4>Puck {p + 1}</h4><div class="cells">
        {#each puck as position}
          {@const f = batch.fractions.find(f => f.id === batch?.capsule_map[String(position)])}
          {@const src = f?.sources.find(s => !s.retired_at && s.mount_id)}
          {@const records = batch.fraction_step_records.filter(r => r.fraction_id === f?.id && r.outcome)}
          <button class="btn capsule stack" type="button" data-testid="tims-capsule" aria-label={`${batch.capsule_set.code}${position}${f ? ` ${f.name}` : ' empty'}`} aria-pressed={!!f && selected === f.id} disabled={!f} onclick={() => { selected = f?.id ?? null; selectedStep = ''; }}>
            <strong>{batch.capsule_set.code}{position}</strong>
            <GrainImage source={src} mount={src?.mount_id ? geometry[src.mount_id] : undefined} size={72} lazy {geometryError} />
            {#if f}<span>{f.name}</span><span class="small">{f.sample.name}</span><span class="chip small">{statusWords(f.status)}</span>{#each records as r}<span class="warning small">{r.outcome === 'fully_dissolved' && batch?.steps.find(s => s.id === r.step_id)?.method_code === 'SP-TIMS-CA' ? 'dissolved during CA' : statusWords(r.outcome)}</span>{/each}{#if f.sources.some(s => !s.retired_at && s.is_fragment)}<span class="warning small">fragment</span>{/if}{:else}<span class="muted small">empty</span>{/if}
          </button>
        {/each}</div></section>
      {/each}</div>
      {#if fraction}{#key fraction.id}<FractionEditor {batch} {fraction} editable={editable && timsRights.canEdit(fraction.lab_id, `fraction:${fraction.id}`)} {geometry} {geometryError} initialStep={selectedStep} close={() => selected = null} />{/key}{/if}
    </section>
    <section class="panel stack" aria-label="Step timeline"><div class="row"><h3>Step timeline</h3><button type="button" class="btn" disabled={!editable || !!onlineOnlyReason()} title={onlineOnlyReason()} onclick={() => { formGeneration++; add = !add; }}>Add step</button><button type="button" class="btn" aria-pressed={matrix} onclick={() => matrix = !matrix}>Step × capsule matrix</button></div>
      {#if add}<form class="panel stack" onsubmit={e => { e.preventDefault(); void createStep(); }}><label>Step method <select required bind:value={method} onchange={() => parameters = withDefaults(selectedMethod?.parameters ?? [])}><option value="">Choose method</option>{#each methods as m}<option value={m.code}>{m.name}</option>{/each}</select></label>{#if selectedMethod}{#key method}<ParameterFields definitions={selectedMethod.parameters} values={parameters} onchange={v => parameters = v} lab={batch.lab_id} />{/key}{/if}<button class="btn" disabled={!editable || !!onlineOnlyReason()}>Create step</button></form>{/if}
      {#if matrix}<div class="matrix" aria-label="Capsule record matrix">{#each batch.steps as s}<section class="stack"><strong>{s.method_name}</strong><div class="row">{#each batch.fractions as f}{@const record = batch.fraction_step_records.find(r => r.step_id === s.id && r.fraction_id === f.id)}<button type="button" class="btn small" onclick={() => { selected = f.id; selectedStep = s.id; }}>{f.capsule_label}: {record?.skipped ? 'skipped' : record?.outcome ? statusWords(record.outcome) : 'no outcome'}{Object.keys(record?.parameters ?? {}).length ? ' · overridden' : ''}<span class="small">{effectiveParameters(s.parameters, record).map(p => `${parameterSummary(s.parameter_definitions.find(d => (d.config_key ?? d.name) === p.key) ?? { name: p.key }, p.value, batch.spike_versions)}${p.overridden ? ' (overridden)' : ''}`).join(' · ')}</span></button>{/each}</div></section>{/each}</div>{/if}
      {#each batch.steps as step, index (step.id)}<StepEditor {step} knownVersions={batch.spike_versions} batch={id} lab={batch.lab_id} {editable} {index} total={batch.steps.length} move={(i, direction) => void run(() => tims.orderSteps(id, reorder(batch!.steps, i, direction).map(s => s.id)))} refresh={() => load()} />{:else}<p class="muted">No steps recorded.</p>{/each}
    </section>
  {/if}
</section>
<style>section,header{min-width:0}header,.panel{padding:10px}h2,h3,h4,p{margin:0}.row{flex-wrap:wrap}.pucks{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:10px;min-width:0}.puck{border:1px solid var(--hairline);border-radius:var(--radius);padding:8px}.cells{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px}.capsule{min-width:0;white-space:normal;padding:5px 2px;gap:3px;overflow-wrap:anywhere;align-items:center}.capsule .chip{white-space:normal;max-width:100%;overflow-wrap:normal;word-break:normal;font-size:.62rem;padding:2px 3px}.capsule:disabled{opacity:.7}.warning{color:var(--warning)}label{display:grid;gap:4px}label:has(input[type=checkbox]){display:flex}textarea,select,input:not([type=checkbox]){width:100%;min-width:0}.matrix{display:grid;gap:8px;padding:8px;border:1px solid var(--hairline);border-radius:var(--radius-sm)}</style>
