<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import { type BatchDetail, type FractionOut, type Parameters, type SpikeInput } from '../../lib/tims-api';
  import { groupValue, multiBulkPayload, combinedPreview, groupSections, undoPayload, lost, type BulkInput, type BulkResult, type UndoEdit } from '../../lib/tims-group';
  import { OnlineAction } from '../../lib/tims-requests';
  import { onlineOnlyReason } from '../../lib/outbox.svelte';
  import { timsError } from '../../lib/tims-readiness';
  import { WriteError } from '../../lib/oversight.svelte';
  import GroupSection from './GroupSection.svelte';
  let { batch, fractions, editable, undo, onbegin, onresult, onundo, onweight }: {
    batch: BatchDetail; fractions: FractionOut[]; editable: boolean; undo: UndoEdit | null;
    onbegin: () => () => boolean;
    onresult: (input: BulkInput, result: BulkResult) => void; onundo: (result: BulkResult) => void;
    onweight: (row: import('../../lib/tims-api').SpikeAddition) => void;
  } = $props();
  let choice = $state(''), drafts = $state.raw<Record<string, Parameters>>({}), defaults = $state.raw<Record<string, boolean>>({}), preview = $state.raw<BulkInput | null>(null);
  let busy = $state(false), error = $state(''), message = $state(''), stale = $state(false);
  let versionNames = $state.raw<Record<string, string>>({});
  let expanded = $state.raw<Record<string, boolean>>({ fraction: true });
  let weightIndex = $state<number | null>(null), weight = $state(''), weightInput = $state<HTMLInputElement>();
  const groupAction = new OnlineAction<BulkResult>(), weightAction = new OnlineAction<import('../../lib/tims-api').SpikeAddition>();
  let alive = true;
  onDestroy(() => { alive = false; });
  const step = $derived(batch.steps.find(s => s.id === choice));
  const sections = $derived(groupSections(batch));
  const active = $derived(fractions.filter(f => !lost(f)));
  const disabled = $derived(!editable || busy || !!onlineOnlyReason() || stale);
  const hasDraft = $derived(Object.values(drafts).some(v => Object.keys(v).length > 0));
  const invalidDefault = $derived(Object.entries(defaults).some(([key, value]) => value && Object.keys(drafts[key] ?? {}).length > 0 && !('parameters' in drafts[key] || 'performed_on' in drafts[key])));
  const summary = $derived(combinedPreview(batch, fractions, drafts, { ...Object.fromEntries(Object.values(batch.spike_versions).map(v => [v.id, `${v.solution_name} ${v.version}`])), ...versionNames }, defaults));
  const weightFraction = $derived(weightIndex === null ? undefined : active[weightIndex]);
  function set(section: string, key: string, value: unknown) {
    drafts = { ...drafts, [section]: { ...drafts[section], [key]: value } }; preview = null;
  }
  function prepare() { preview = multiBulkPayload(batch, fractions, drafts, defaults); }
  async function confirm(isUndo = false) {
    if (disabled || !isUndo && !preview || isUndo && !undo) return;
    const input = isUndo ? undoPayload(undo!, batch) : preview!;
    const current = onbegin();
    busy = true; error = '';
    try {
      const result = await groupAction.send(`/v1/tims/batches/${encodeURIComponent(batch.id)}/bulk`, 'POST', input, `batch:${batch.id}`);
      if (!current()) return;
      if (isUndo) onundo(result); else onresult(input, result);
      if (!alive) return;
      drafts = {}; defaults = {}; preview = null; message = isUndo ? 'Last group edit undone.' : 'Group edit saved.';
    } catch (e) {
      if (!alive || !current()) return;
      error = timsError(e);
      if (e instanceof WriteError && e.code === 'bulk_changed') { stale = true; preview = null; error = 'A selected capsule changed. Refresh the batch and review your selection before applying again.'; }
    } finally { if (alive) busy = false; }
  }
  async function startWeights(index = 0) {
    weightIndex = index; error = ''; message = '';
    const fraction = active[index];
    weight = batch.spikes.find(r => r.fraction_id === fraction?.id && r.step_id === step?.id)?.spike_weight_g ?? '';
    await tick(); weightInput?.focus(); weightInput?.select();
  }
  async function saveWeight(direction = 1) {
    if (!weightFraction || !step || disabled) return;
    if (!Number.isFinite(Number(weight)) || Number(weight) <= 0) { error = 'Enter a positive weight in grams.'; return; }
    const addition = batch.spikes.find(r => r.fraction_id === weightFraction.id && r.step_id === step.id);
    const metadata = groupValue(batch, weightFraction, 'spike', step);
    const version = metadata.spike_version_id || step.parameters.spike_version;
    if (!version) { error = 'Set a registered spike version for this capsule first.'; return; }
    const body: SpikeInput = { spike_version_id: String(version), spike_weight_g: weight,
      weighed_at: metadata.weighed_at as string | undefined, weighed_by_id: metadata.weighed_by_id as string | undefined,
      weighed_by_name: metadata.weighed_by_name as string | undefined,
      balance_readability_g: metadata.balance_readability_g as string | undefined,
      bottle_before_g: addition?.bottle_before_g ?? null, bottle_after_g: addition?.bottle_after_g ?? null,
      notes: addition?.notes ?? '', expected_updated_at: addition?.updated_at ?? batch.fraction_step_records.find(r => r.fraction_id === weightFraction!.id && r.step_id === step!.id)?.updated_at ?? null, expected_absent: !addition };
    const current = onbegin();
    busy = true; error = '';
    try {
      const row = await weightAction.send(`/v1/tims/batches/${encodeURIComponent(batch.id)}/fractions/${encodeURIComponent(weightFraction.id)}/steps/${encodeURIComponent(step.id)}/spike`, 'PUT', body, `batch:${batch.id}`);
      if (!current()) return;
      onweight(row);
      if (!alive) return;
      busy = false;
      const next = weightIndex! + direction;
      if (next >= active.length) { weightIndex = null; message = 'Selected capsule weights saved.'; }
      else await startWeights(Math.max(0, next));
    } catch (e) { if (alive && current()) error = timsError(e); }
    finally { if (alive) busy = false; }
  }
</script>
<section class="stack group-editor" aria-label="Group editor">
  <div class="group-heading stack"><h3>Group editor</h3><p class="small">{fractions.length} assigned capsules · {active.length} remaining</p><p class="small muted">Only edited fields apply. Mixed fields stay unchanged.</p></div>
  <div class="group-content stack">
    {#if batch.completed_at}<p class="small">Completed batch · read only. Reopen it before editing.</p>{/if}
    {#if weightFraction}
      <section class="panel stack" aria-label="Selected capsule weight entry">
        <h4>{weightFraction.capsule_label} · {weightFraction.name} · {weightIndex! + 1} of {active.length}</h4>
        <label>Spike weight (g) <input bind:this={weightInput} bind:value={weight} inputmode="decimal" disabled={disabled} onkeydown={e => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (e.shiftKey && e.key === 'Tab') void startWeights(Math.max(0, weightIndex! - 1)); else void saveWeight(); } }} /></label>
        <p class="small muted">Tab or Enter saves and advances. Shift+Tab goes back.</p>
        <button class="btn primary" type="button" disabled={disabled} onclick={() => void saveWeight()}>Save weight and next</button>
        <button class="btn" type="button" disabled={busy} onclick={() => weightIndex = null}>Close weight entry</button>
      </section>
    {:else}
      {#each sections as section (section.key)}
        <details class="panel group-section" open={expanded[section.key] ?? false}>
          <!-- Native toggle events are queued: a draft render can otherwise restore stale open state first. -->
          <summary onclick={event => { event.preventDefault(); expanded = { ...expanded, [section.key]: !(expanded[section.key] ?? false) }; }}>{section.label}{Object.keys(drafts[section.key] ?? {}).length ? ' · edited' : ''}</summary>
          <div class="stack section-fields" role="group" aria-label={section.label}>
            <GroupSection {batch} {fractions} {section} touched={drafts[section.key] ?? {}} defaultChoice={defaults[section.key] ?? false} {disabled} draftPending={hasDraft || !!preview}
              onfield={(key, value) => set(section.key, key, value)} ondefault={value => { defaults = { ...defaults, [section.key]: value }; preview = null; }}
              onversion={(id, name) => versionNames = { ...versionNames, [id]: name }} onweights={() => { choice = section.key; void startWeights(); }} />
          </div>
        </details>
      {/each}
    {/if}
    {#if preview}<section class="panel stack" aria-label="Group edit preview"><p class="small combined-preview">{summary}</p><div class="row"><button class="btn primary" disabled={disabled} onclick={() => void confirm()}>Confirm group edit</button><button class="btn" disabled={busy} onclick={() => preview = null}>Cancel</button></div></section>
    {:else if weightIndex === null}<button class="btn primary" disabled={disabled || !active.length || !hasDraft || invalidDefault} onclick={prepare}>Preview group edit</button>{/if}
    <button class="btn" disabled={disabled || !undo} onclick={() => void confirm(true)}>Undo last group edit</button>
    <p class="small group-status" role="status" class:error={!!error}>{error || message || onlineOnlyReason()}</p>
  </div>
</section>
<style>
  .group-editor { height:100%;min-height:0;min-width:0;gap:4px; }
  .group-heading { height:88px;flex:none;border-bottom:1px solid var(--hairline);overflow:hidden; }
  .group-content { flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;padding:2px; }
  label { display:grid;gap:4px; }
  input { width:100%;min-width:0; } p { margin:0;overflow-wrap:anywhere; }
  .combined-preview { white-space:pre-line; } .group-section { flex:none; } .section-fields { padding-top:8px; }
  .group-status { min-height:40px; } section.panel { padding:8px; }
</style>
