<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import { identity } from '../../lib/identity.svelte';
  import { timsRights } from '../../lib/tims-rights.svelte';
  import { type PickNotePlan, type PickNoteRequest, type FractionStatus, type CapsuleOut, type RecipeOut } from '../../lib/tims-api';
  import { OnlineAction, ReplyScope } from '../../lib/tims-requests';
  import { planSummary, planSentence, fractionStatuses } from '../../lib/tims-model';
  import { onlineOnlyReason } from '../../lib/outbox.svelte';
  import { WriteError } from '../../lib/oversight.svelte';
  import { shell } from '../../lib/shell.svelte';
  import { plural } from '../../lib/plural';
  import { resolvedReferences, pickNoteResult, planBatchName, planRecipeName } from '../../lib/tims-display';
  import Confirm from './Confirm.svelte';
  let { lab, active = true, sets = [], recipes = [] }: { lab: string; active?: boolean; sets?: CapsuleOut[]; recipes?: RecipeOut[] } = $props();
  let text = $state(''), filename = $state(''), first = $state<number | undefined>(), last = $state<number | undefined>(), date = $state(''), status = $state<FractionStatus>('picked'), filter = $state('all');
  let plan = $state.raw<PickNotePlan | null>(null), request = $state.raw<PickNoteRequest | null>(null), busy = $state(false), error = $state(''), confirming = $state(false), imported = $state.raw<{ id: string; label: string }[]>([]);
  const preview = new OnlineAction<PickNotePlan>(); const importing = new OnlineAction<{ plan: PickNotePlan; created: Record<string, string[]> }>();
  let generation = 0;
  const replies = new ReplyScope(() => [lab, text, filename, first, last, date, status]);
  onDestroy(() => replies.invalidate());
  const editable = $derived(timsRights.canEdit(lab));
  const signature = $derived(JSON.stringify([text, filename, first, last, date, lab, status, identity.revision]));
  const summary = $derived(plan ? planSummary(plan) : null);
  const lines = $derived(plan?.lines.filter(l => filter === 'all' || l.status === filter).sort((a, b) => Number(b.status === 'refused') - Number(a.status === 'refused') || a.number - b.number) ?? []);
  $effect(() => { void signature; untrack(() => { generation++; plan = null; request = null; confirming = false; imported = []; error = ''; busy = false; }); });
  async function file(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0]; if (!file) return;
    const gen = ++generation, current = replies.capture(); try { const content = await file.text(); if (gen !== generation || !current()) return; text = content; filename = file.name; } catch (e) { if (gen === generation && current()) error = String(e); }
  }
  async function makePreview() {
    const gen = ++generation, current = replies.capture(); busy = true; error = ''; imported = [];
    const body: PickNoteRequest = { text, filename, lab_id: lab, ...(first ? { first_line: first } : {}), ...(last ? { last_line: last } : {}), ...(date ? { started_on: date } : {}) };
    try { const result = await preview.send('/v1/tims/pick-notes/preview', 'POST', body); if (gen !== generation || !current()) return; plan = result; request = body; }
    catch (e) { if (gen === generation && current()) error = String(e); } finally { if (gen === generation && current()) busy = false; }
  }
  async function apply() {
    if (!request || !plan || summary?.refused) return;
    const gen = generation, current = replies.capture(); busy = true; error = '';
    try { const result = await importing.send('/v1/tims/pick-notes/import', 'POST', { ...request, status }); if (gen !== generation || !current()) return; plan = result.plan; const created = result.created.batches ?? [], planned = result.plan.batches.filter(b => b.action === 'create');
      imported = [...new Set([...created, ...result.plan.batches.flatMap(b => b.id ? [b.id] : [])])].map(id => {
        const batch = result.plan.batches.find(b => b.id === id) ?? planned[created.indexOf(id)];
        return { id, label: batch ? planBatchName(batch, sets, result.plan, false) : 'from this import' };
      }); confirming = false; }
    catch (e) { if (gen !== generation || !current()) return; if (e instanceof WriteError && e.code === 'pick_notes_refused') { const returned = (e.body as { plan?: PickNotePlan }).plan; if (returned) plan = returned; } error = String(e); confirming = false; }
    finally { if (gen === generation && current()) busy = false; }
  }
</script>
<section class="stack" aria-label="Import pick notes"><h2>Import pick notes</h2><p class="small muted">Preview resolves the selected lines without writing. Import is a separate confirmed operation.</p>
<form class="panel stack" onsubmit={e => { e.preventDefault(); void makePreview(); }}>
  <label>Open pick notes (.md or .txt) <input type="file" accept=".md,.txt,text/plain,text/markdown" onchange={e => void file(e)} disabled={busy || !editable} /></label>
  <label>Pick-note text <textarea rows="9" required maxlength="1000000" bind:value={text} disabled={busy || !editable}></textarea></label>
  <div class="row"><label>First line <input type="number" min="1" step="1" bind:value={first} disabled={busy || !editable} /></label><label>Last line <input type="number" min={first ?? 1} step="1" bind:value={last} disabled={busy || !editable} /></label><label>Fallback start date <input type="date" bind:value={date} disabled={busy || !editable} /></label><label>Imported fraction status <select bind:value={status} disabled={busy || !editable}>{#each fractionStatuses as s}<option value={s}>{s.replaceAll('_', ' ')}</option>{/each}</select></label></div>
  <button class="btn primary" disabled={!editable || busy || !!onlineOnlyReason()} title={onlineOnlyReason()}>Preview pick notes</button>
</form>
{#if error}<p class="error" role="status">{error}</p>{/if}
{#if plan}
<section class="panel stack" aria-label="Pick-note plan"><h3>Preview plan</h3><p>{Object.entries(plan.summary).map(([k, v]) => plural(v, k === 'batches' ? 'batch' : k.replace(/s$/, ''), k)).join(' · ')}</p><p>Would create {planSentence(plan)}.</p>
<label>Show lines <select bind:value={filter}>{#each ['all', 'refused', 'ok', 'skipped', 'ignored'] as f}<option value={f}>{f}</option>{/each}</select></label>
<div class="line-table"><table><thead><tr><th>Line and original text</th><th>Result</th><th>Resolved references and normalisations</th></tr></thead><tbody>
{#each lines as line}<tr class:refused={line.status === 'refused'}><td>{line.number}. {line.text}</td><td><strong>{pickNoteResult(line)}</strong><br />{line.message}{#each line.refusals as refusal}<p>{refusal.code}: {refusal.message}</p>{/each}</td><td><p title={JSON.stringify(line.resolved)}>{resolvedReferences(line.resolved)}</p>{#each line.normalisations as n}<p>{n}</p>{/each}</td></tr>{/each}
</tbody></table></div>
<h3>Batches to create or reuse</h3>{#each plan.batches as b}<p>{b.action} · {planBatchName(b, sets, plan)} · Recipe: {planRecipeName(b.recipe, recipes)} · {b.explanation ?? ''}</p>{/each}
<button class="btn primary" disabled={!editable || busy || !!onlineOnlyReason() || !!summary?.refused || imported.length > 0} onclick={() => confirming = true}>Import confirmed plan</button>
{#if summary?.refused}<p class="error">Import is disabled because selected lines were refused. Correct the text or line range and preview again.</p>{/if}
</section>{/if}
{#if imported.length}<section class="panel stack" aria-label="Imported batches"><h3>Import completed</h3>{#each imported as batch}<button class="btn" onclick={() => void shell.openTimsBatch(batch.id)}>Open batch {batch.label}</button>{/each}</section>{/if}
{#if confirming && plan && active}<Confirm title="Import pick notes" text={`Create ${planSentence(plan)}. The server rechecks the complete plan and writes nothing if any selected line is refused.`} {busy} confirm={() => void apply()} cancel={() => confirming = false} />{/if}
</section>
<style>h2,h3,p{margin:0}.row{flex-wrap:wrap}.panel{padding:10px;min-width:0}label{display:grid;gap:4px;min-width:0}textarea,select,input{min-width:0;max-width:100%;width:100%}section{overflow-wrap:anywhere;min-width:0}table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:.8rem}td,th{padding:6px;text-align:left;vertical-align:top;border-bottom:1px solid var(--hairline);overflow-wrap:anywhere}.line-table{max-height:420px;overflow:auto}.refused{background:color-mix(in srgb,var(--danger) 10%,transparent)}</style>
