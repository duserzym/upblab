<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import { tims, parameterSummary, type StepOut, type VersionOut } from '../../lib/tims-api';
  import { OnlineAction, ReplyScope } from '../../lib/tims-requests';
  import { parameterDefinitions, parameterKey, validateParameters } from '../../lib/tims-model';
  import { onlineOnlyReason } from '../../lib/outbox.svelte';
  import ParameterFields from './ParameterFields.svelte';
  let { step, batch, lab, editable, index, total, move, refresh, knownVersions = {} }: { step: StepOut; batch: string; lab: string; editable: boolean; index: number; total: number; move: (index: number, direction: number) => void; refresh: () => Promise<void>; knownVersions?: Record<string, VersionOut> } = $props();
  let editing = $state(false), parameters = $state.raw(untrack(() => ({ ...step.parameters }))), performed = $state(untrack(() => step.performed_on ?? '')), notes = $state(untrack(() => step.notes)), error = $state(''), busy = $state(false);
  const deletion = new OnlineAction<{ deleted: boolean }>();
  const replies = new ReplyScope(() => [lab, batch, step.id]);
  let formGeneration = 0;
  onDestroy(() => replies.invalidate());
  async function save() {
    error = ''; const errors = validateParameters(parameterDefinitions(step.parameter_definitions), parameters, true);
    if (errors.length) { error = errors.join(' '); return; }
    const settled = replies.capture(() => formGeneration), current = replies.capture(() => [formGeneration, parameters, performed, notes]); busy = true;
    try { await tims.patchStep(batch, step.id, { parameters, performed_on: performed || null, notes }); if (current()) editing = false; }
    catch (e) { if (current()) error = String(e); } finally { if (settled()) busy = false; }
  }
  async function remove() { const current = replies.capture(); busy = true; error = ''; try { await deletion.send(`/v1/tims/batches/${encodeURIComponent(batch)}/steps/${encodeURIComponent(step.id)}`, 'DELETE', undefined, `batch:${batch}`); if (current()) await refresh(); } catch (e) { if (current()) error = String(e); } finally { if (current()) busy = false; } }
</script>
<article class="panel stack" aria-label={step.method_name}>
  <div class="row"><h3>{index + 1}. {step.method_name}</h3><button class="btn" type="button" disabled={!editable || index === 0 || busy} onclick={() => move(index, -1)} aria-label={`Move ${step.method_name} up`}>↑</button><button class="btn" type="button" disabled={!editable || index === total - 1 || busy} onclick={() => move(index, 1)} aria-label={`Move ${step.method_name} down`}>↓</button></div>
  <p class="small">{parameterDefinitions(step.parameter_definitions).map(d => parameterSummary(d, step.parameters[parameterKey(d)], knownVersions)).join(' · ')}</p>
  <p class="small">Performed on: {step.performed_on ?? 'Not recorded'}{step.notes ? ` · ${step.notes}` : ''}</p>
  <div class="row"><button type="button" class="btn" disabled={!editable} onclick={() => { formGeneration++; busy = false; error = ""; editing = !editing; parameters = { ...step.parameters }; performed = step.performed_on ?? ''; notes = step.notes; }}>Edit step</button><button type="button" class="btn" disabled={!editable || !!onlineOnlyReason() || busy} title={onlineOnlyReason()} onclick={() => void remove()}>Delete step</button></div>
  {#if editing}<form class="stack" onsubmit={e => { e.preventDefault(); void save(); }}>
    <ParameterFields definitions={step.parameter_definitions} values={parameters} onchange={v => parameters = v} disabled={!editable} {lab} {knownVersions} />
    <label>Performed on <input type="date" bind:value={performed} disabled={!editable} /></label><label>Step notes <textarea bind:value={notes} disabled={!editable}></textarea></label>
    <button class="btn primary" disabled={!editable || busy}>Save step here</button>
  </form>{/if}
  {#if error}<p class="error" role="status">{error}</p>{/if}
</article>
<style>article{padding:10px;min-width:0;overflow-wrap:anywhere}h3,p{margin:0}.row{flex-wrap:wrap}label{display:grid;gap:4px}textarea{width:100%}</style>
