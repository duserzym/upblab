<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import { identity } from '../../lib/identity.svelte';
  import { tims, type BatchDetail, type SpikeAddition, type SpikeInput, type VersionOut, type HistoryRow, type ListPage } from '../../lib/tims-api';
  import { type SessionBottle } from '../../lib/tims-spiking';
  import { loadReadability, saveReadability } from '../../lib/tims-guidance';
  import { weighedMass, spikeWarnings } from '../../lib/tims-tracer';
  import { formatSpikeValue, isotopeLabel } from '../../lib/spike-format';
  import { historyChanges } from '../../lib/tims-model';
  import { timsError } from '../../lib/tims-readiness';
  import { WriteError } from '../../lib/oversight.svelte';
  import { onlineOnlyReason } from '../../lib/outbox.svelte';
  import { ReplyScope } from '../../lib/tims-requests';
  import SpikePicker from './SpikePicker.svelte';
  let { batch, addition, pending = {}, bottles = [], startWeight = '', historical = false, editable, formId, onstate, onsave, onaccept }: {
    batch: BatchDetail; addition?: SpikeAddition; pending?: Partial<SpikeInput>; bottles?: SessionBottle[]; startWeight?: string; historical?: boolean; editable: boolean; formId: string; onstate: (canSave: boolean) => void;
    onsave: (body: SpikeInput) => Promise<SpikeAddition>; onaccept: (row: SpikeAddition) => void;
  } = $props();
  const viewer = () => ({ server: identity.target?.server ?? '', account: identity.account?.id ?? identity.account?.username ?? '' });
  let olderBottles = $state(false);
  const bottleChoices = $derived(bottles.filter(b => batch.spike_versions[b.versionId]?.status !== 'withdrawn' && (olderBottles || batch.spike_versions[b.versionId]?.status !== 'superseded')));
  let saved = $state.raw(untrack(() => addition));
  let version = $state(untrack(() => addition?.spike_version_id ?? pending.spike_version_id ?? (bottleChoices.length === 1 ? bottleChoices[0].versionId : '')));
  let detail = $state.raw<VersionOut>();
  let bottleId = $state(untrack(() => bottles.find(b => b.versionId === version)?.bottleId ?? ''));
  let bottleMode = $state(untrack(() => !!addition?.bottle_before_g || !addition && bottles.length > 0));
  let weight = $state(untrack(() => addition?.spike_weight_g ?? ''));
  let before = $state(untrack(() => addition?.bottle_before_g ?? startWeight));
  let after = $state(untrack(() => addition?.bottle_after_g ?? ''));
  let readability = $state(untrack(() => addition?.balance_readability_g ?? pending.balance_readability_g ?? loadReadability(viewer())));
  let byAccount = $state(untrack(() => !(addition?.weighed_by_name ?? pending.weighed_by_name) || (addition?.weighed_by_id ?? pending.weighed_by_id) === identity.account?.id));
  let byName = $state(untrack(() => addition?.weighed_by_name ?? pending.weighed_by_name ?? identity.account?.display_name ?? identity.account?.username ?? ''));
  let at = $state(untrack(() => (addition?.weighed_at ?? pending.weighed_at ?? new Date().toISOString()).slice(0, 19)));
  let notes = $state(untrack(() => addition?.notes ?? ''));
  let full = $state(false), busy = $state(false), error = $state(''), message = $state('');
  let conflict = $state.raw<SpikeAddition>();
  let historyPage = $state.raw<ListPage<HistoryRow> | null>(null), history = $state.raw<HistoryRow[]>([]), historyHidden = $state(false), historyBusy = $state(false), historyError = $state('');
  const replies = new ReplyScope(() => batch.id);
  onDestroy(() => replies.invalidate());
  const pinned = $derived(detail?.id === version ? detail : batch.spike_versions[version]);
  const used = $derived(weighedMass(weight, before, after, bottleMode));
  const valid = $derived(!!version && (pinned?.status !== 'withdrawn' || saved?.spike_version_id === version) && Number.isFinite(Number(used)) && Number(used) > 0 && !!readability && Number.isFinite(Number(readability)) && Number(readability) > 0 && Number.isFinite(Date.parse(at + 'Z')) && (!byAccount ? !!byName.trim() : !!identity.account));
  const canSave = $derived(editable && !busy && valid && !conflict && !onlineOnlyReason());
  $effect(() => onstate(!!canSave));
  const unchanged = $derived(!!saved && version === saved.spike_version_id && used === saved.spike_weight_g && readability === (saved.balance_readability_g ?? loadReadability(viewer())) && bottleMode === !!saved.bottle_before_g && (!bottleMode || before === saved.bottle_before_g && after === saved.bottle_after_g));
  const tracer = $derived(unchanged ? saved?.tracer ?? [] : []);
  function display(mol: number, u: number | null) {
    const scale = Math.abs(mol) >= 1e-9 ? 1e9 : 1e12;
    const formatted = formatSpikeValue({ value: mol * scale, ...(u === null ? {} : { uncertainty: u * scale, uncertainty_type: '1sd_abs' }) }, full);
    return `${formatted.value} ${u === null ? '± not given' : '± ' + formatted.uncertainty} ${scale === 1e9 ? 'nmol' : 'pmol'}`;
  }
  function chooseVersion(id: string, row: VersionOut) {
    version = id; detail = row;
    if (bottleMode) { const bottle = bottles.find(b => b.versionId === id); bottleId = bottle?.bottleId ?? ''; before = bottle?.before ?? ''; after = ''; }
  }
  function take(row: SpikeAddition) {
    saved = row; version = row.spike_version_id; weight = row.spike_weight_g; before = row.bottle_before_g ?? ''; after = row.bottle_after_g ?? '';
    bottleMode = !!row.bottle_before_g; readability = row.balance_readability_g ?? loadReadability(viewer());
    byAccount = row.weighed_by_id === identity.account?.id; byName = row.weighed_by_name ?? ''; at = (row.weighed_at ?? at).slice(0, 19); notes = row.notes;
    conflict = undefined; onaccept(row);
  }
  async function save() {
    if (!valid || !editable || busy || conflict) return;
    const current = replies.capture(); busy = true; error = ''; message = '';
    try {
      const row = await onsave({ spike_version_id: version, spike_weight_g: used, bottle_before_g: bottleMode ? before : null, bottle_after_g: bottleMode ? after : null,
        balance_readability_g: readability, weighed_by_id: byAccount ? identity.account?.id : null,
        weighed_by_name: byAccount ? identity.account?.display_name || identity.account?.username : byName.trim(), weighed_at: new Date(at + 'Z').toISOString(), notes,
        expected_updated_at: saved?.updated_at ?? pending.expected_updated_at ?? null, expected_absent: !saved });
      if (current()) { saved = row; saveReadability(viewer(), readability); onaccept(row); message = 'Spike saved.'; }
    } catch (e) {
      if (!current()) return;
      if (e instanceof WriteError && e.status === 409 && e.code === 'spike_changed') {
        const body = e.body as { current?: SpikeAddition; current_row?: SpikeAddition; spike?: SpikeAddition; addition?: SpikeAddition };
        conflict = body.current ?? body.current_row ?? body.spike ?? body.addition;
        error = conflict ? 'This spike was changed by another analyst. Compare both entries before saving.' : 'This spike changed. Refresh the batch before editing; your draft is still shown.';
      } else error = timsError(e);
    } finally { if (current()) busy = false; }
  }
  async function loadHistory(more = false) {
    if (!saved || historyBusy) return;
    const current = replies.capture(); historyBusy = true; historyError = '';
    try { const page = more ? await historyPage?.more() : await tims.spikeHistory(saved.fraction_id); if (current()) { historyHidden = page === null; historyPage = page ?? null; if (page) history = more ? [...history, ...page.items] : page.items; } }
    catch (e) { if (current()) historyError = String(e); }
    finally { if (current()) historyBusy = false; }
  }
</script>
<section class="panel stack required-spike" aria-label="Required capsule spike">
  <div class="row"><h4>Spike assignment and weighing</h4><span class="badge">Required</span></div>
  <p class="small muted">Pin the registered version, record the weighed mass, and check the tracer calculation for this capsule.</p>
  <form id={formId} class="stack" onsubmit={event => { event.preventDefault(); void save(); }}>
    <SpikePicker value={version} knownVersions={batch.spike_versions} lab={batch.lab_id} showComposition disabled={!editable || busy || historical}
      onchange={chooseVersion} ondetail={row => detail = row} />
    {#if saved?.warnings.includes('spike_version_not_current')}<p class="small warning">{spikeWarnings.spike_version_not_current}</p>{/if}
    <label class="check"><input type="checkbox" bind:checked={bottleMode} disabled={!editable || busy || historical} /> Use bottle before and after</label>
    {#if bottleMode}
      {#if bottles.some(b => batch.spike_versions[b.versionId]?.status === 'superseded') && !saved}<label class="check"><input type="checkbox" bind:checked={olderBottles} /> Show older session bottles</label>
      {#if olderBottles}<p class="small warning">These session bottles include superseded spike versions. Check their calibration before weighing.</p>{/if}{/if}
      {#if bottles.length}<label>Spike bottle <select bind:value={bottleId} disabled={!editable || busy || historical} onchange={() => { const bottle = bottles.find(b => b.bottleId === bottleId); if (bottle) { version = bottle.versionId; before = bottle.versionId === addition?.spike_version_id ? addition.bottle_before_g ?? bottle.before : bottle.before; after = ''; } }}>
        <option value="">Choose a session bottle</option>{#each bottleChoices as bottle}<option value={bottle.bottleId}>{bottle.label}</option>{/each}
      </select></label>{/if}
      <label>Bottle before this capsule (g) <input type="text" inputmode="decimal" bind:value={before} disabled={!editable || busy || historical} /></label>
      <label>Bottle after this capsule (g) <input type="text" inputmode="decimal" bind:value={after} disabled={!editable || busy || historical} /></label>
      <p>Spike used from bottle · <output>{used || '—'} g</output></p>
      {#if historical}<p class="small muted">A later capsule uses this reading. Only weighing metadata and the comment can be edited.</p>{/if}
    {:else}
      <label>Recorded spike weight (g) <input type="text" inputmode="decimal" bind:value={weight} required disabled={!editable || busy || historical} /></label>
    {/if}
    {#each (saved?.warnings ?? []).filter(w => ['spike_weight_unusual', 'bottle_difference_mismatch'].includes(w)) as warning}<p class="small warning">{spikeWarnings[warning]}</p>{/each}
    <label>Balance readability (g) <input type="text" inputmode="decimal" bind:value={readability} required disabled={!editable || busy} /></label>
    {#if saved?.warnings.includes('readability_missing')}<p class="small warning">{spikeWarnings.readability_missing}</p>{/if}
    <label class="check"><input type="checkbox" bind:checked={byAccount} disabled={!editable || busy} /> Weighed by my signed-in account</label>
    <label>Weighed by <input type="text" bind:value={byName} required disabled={!editable || busy || byAccount} /></label>
    <label>Weighed at (UTC) <input type="datetime-local" step="1" bind:value={at} required disabled={!editable || busy} /></label>
    <section class="panel stack calculation" aria-label="Tracer calculation">
      <h4>Tracer calculation · ± 1σ</h4>
      <label class="check"><input type="checkbox" bind:checked={full} /> Full precision</label>
      {#each tracer as row (row.isotope)}<p title={`${row.mol} mol; ± ${row.mol_u1s ?? 'not given'} mol (1σ)`}><strong>{isotopeLabel(row.isotope)}</strong> · {display(row.mol, row.uncertainty_incomplete ? null : row.mol_u1s)}<span class="small muted"> · {row.basis}{row.ratio ? ' ' + row.ratio : ''}</span></p>
      {:else}<p class="small muted">Save the weighing to see the server's tracer calculation.</p>{/each}
      {#if tracer.length}<p class="small muted">Stored server calculation. Exact mol values are in each row’s title.</p>{/if}
    </section>
    {#each (saved?.warnings ?? []).filter(w => !Object.hasOwn(spikeWarnings, w)) as warning}<p class="small warning">{spikeWarnings[warning] ?? warning.replaceAll('_', ' ')}</p>{/each}
    <label>Spike comment <textarea rows="2" bind:value={notes} disabled={!editable || busy}></textarea></label>
    {#if conflict}
      <section class="panel stack" aria-label="Spike conflict">
        <p>Your entry: {used} g · {version} · {byName} · {at}</p>
        <p>Server entry: {conflict.spike_weight_g} g · {conflict.spike_version_id} · {conflict.weighed_by_display_name || conflict.weighed_by_name || 'not recorded'} · {conflict.updated_at}</p>
        <details><summary>Compare all spike fields</summary><pre>{JSON.stringify({ yours: { version, weight_g: used, before, after, readability_g: readability, weighed_by_id: byAccount ? identity.account?.id : null, weighed_by_name: byName, weighed_at: at, notes }, server: conflict }, null, 2)}</pre></details>
        <div class="row"><button class="btn" type="button" onclick={() => { saved = conflict; conflict = undefined; error = ''; message = 'Your draft is kept. Save to replace the compared server entry.'; }}>Keep mine</button>
        <button class="btn" type="button" onclick={() => { take(conflict!); error = ''; message = 'Server entry loaded.'; }}>Take server’s</button></div>
      </section>
    {/if}
    <div class="status small" role="status" class:error={!!error}>{error || message || onlineOnlyReason() || (!valid ? 'A spike version, positive weight, readability and analyst are required.' : '')}</div>
  </form>
  <p class="small muted">{saved ? `Weighed by ${saved.weighed_by_display_name || saved.weighed_by_name || 'not recorded'} · ${saved.weighed_at || 'time not recorded'}` : 'Spike pending for this capsule.'}</p>
  {#if saved && !historyHidden}<details ontoggle={event => { if (event.currentTarget.open) void loadHistory(); }}><summary>Spike edit history</summary>
    {#each history as row (row.id)}<article class="small"><p>{String(row.actor_name ?? row.actor ?? row.who ?? 'Unknown account')} · {String(row.at ?? row.created_at ?? '')}</p>{#each historyChanges(row) as line}<p>{line}</p>{/each}</article>{:else}<p class="small">{historyBusy ? 'Loading history…' : 'No history returned.'}</p>{/each}
    {#if historyError}<p class="error small">{historyError}</p>{/if}
    {#if historyPage?.nextCursor}<button type="button" class="btn" disabled={historyBusy} onclick={() => void loadHistory(true)}>Load more history</button>{/if}
  </details>{/if}
</section>
<style>
  .required-spike { border: 1px solid var(--hairline); border-left: 2px solid var(--accent); border-radius: var(--radius-sm); padding: var(--space-2); min-width: 0; background: var(--glass); }
  .badge { display: inline-block; width: 66px; height: 22px; text-align: center; background: var(--accent-soft); color: var(--accent); border-radius: var(--radius-sm); font-size: .75rem; }
  h4, p { margin: 0; } .row { flex-wrap: wrap; } label { display: grid; gap: 4px; } .check { display: flex; align-items: baseline; }
  input:not([type=checkbox]), select, textarea { width: 100%; min-width: 0; } .calculation { min-height: 130px; padding: var(--space-2); overflow-wrap: anywhere; }
  input[type=datetime-local] { padding: .45rem .7rem; border: 1px solid var(--hairline); border-radius: var(--radius-sm); background: var(--glass-strong); color: var(--text); }
  .warning { color: var(--warning); } .status { height: 54px; overflow: auto; scrollbar-gutter: stable; } pre { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
