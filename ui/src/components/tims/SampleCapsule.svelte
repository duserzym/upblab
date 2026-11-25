<script lang="ts">
  import { onDestroy } from 'svelte';
  import { identity } from '../../lib/identity.svelte';
  import { shell } from '../../lib/shell.svelte';
  import { tims, mineralWords, type FractionOut, type ListPage, type Mineral } from '../../lib/tims-api';
  import { capsulePreparations, capsuleSampleLabel, fractionNamePattern, preparationSamples, sampleCapsuleInput,
    type CapsulePreparation, type CapsuleSample } from '../../lib/tims-capsule-intake';
  import { minerals } from '../../lib/tims-model';
  import { onlineOnlyReason } from '../../lib/outbox.svelte';
  import { OnlineAction, ReplyScope } from '../../lib/tims-requests';

  let { preparation, batch, lab, position, label, defaultMineral, editable, oncreated }: {
    preparation: CapsulePreparation; batch: string; lab: string; position: number; label: string;
    defaultMineral: Mineral; editable: boolean; oncreated: (fraction: FractionOut) => void;
  } = $props();

  const uid = $props.id();
  const isBlank = $derived(preparation === 'lab-blank');
  let query = $state(''), searched = $state(false), loading = $state(false), saving = $state(false);
  let searchError = $state(''), saveError = $state('');
  let rows = $state.raw<CapsuleSample[]>([]), page = $state.raw<ListPage<CapsuleSample> | null>(null);
  let sampleId = $state(''), mineral = $state<Mineral | ''>(''), name = $state(''), notes = $state('');
  const sample = $derived(rows.find(row => row.id === sampleId));
  const writeReason = $derived(onlineOnlyReason());
  const replies = new ReplyScope(() => [batch, lab, position, preparation]);
  const create = new OnlineAction<FractionOut>();
  onDestroy(() => replies.invalidate());

  async function search(more = false) {
    if (loading || saving) return;
    const term = query.trim() || (isBlank ? 'blank' : '');
    if (!term && !more) return;
    const current = replies.capture();
    if (!more) {
      sampleId = '';
      rows = [];
      page = null;
    }
    loading = true;
    searched = true;
    searchError = '';
    try {
      const next = more ? await page?.more() : await tims.sampleChoices(term);
      if (!current() || !next) return;
      rows = [...new Map([...rows, ...preparationSamples(next.items, preparation)].map(row => [row.id, row])).values()];
      page = next;
    } catch (error) {
      if (current()) searchError = String(error);
    } finally {
      if (current()) loading = false;
    }
  }

  async function save() {
    if (!sample || !editable || writeReason || saving) return;
    const current = replies.capture();
    const savedInScope = new ReplyScope(() => [batch, lab]).capture();
    saving = true;
    saveError = '';
    try {
      const body = sampleCapsuleInput(preparation, sample, { batch, lab, position }, { mineral: mineral || defaultMineral, name, notes });
      const result = await create.send('/v1/fractions', 'POST', body, `batch:${batch}`);
      if (savedInScope()) oncreated(result);
    } catch (error) {
      if (current()) saveError = String(error);
    } finally {
      if (current()) saving = false;
    }
  }

  function openSampleRegistration() {
    if (!identity.target?.server) return;
    void shell.handleLink(new URL('/admin/samples/sample/add/', identity.target.server).href, 'tims');
  }
</script>

<section class="stack sample-capsule" aria-label={`${capsulePreparations[preparation]} setup`}>
  <div class="sample-scroll stack">
  <h4>{isBlank ? 'Set up a lab blank' : 'Assign a TIMS-only sample'}</h4>
  <form class="row search" onsubmit={e => { e.preventDefault(); void search(); }}>
    <input type="search" aria-label={isBlank ? 'Find a lab blank sample' : 'Find a sample'}
      placeholder={isBlank ? 'Search for lab blanks' : 'Sample name or IGSN'} bind:value={query} disabled={loading || saving} />
    <button type="submit" class="btn small" disabled={loading || saving || !isBlank && !query.trim()}>Search</button>
  </form>
  {#if loading}<p class="small muted" role="status">Searching samples…</p>{/if}
  {#if searchError}<p class="small error" role="status">{searchError}</p>{/if}
  {#if searched && !rows.length && !loading && !searchError}
    <p class="small muted">{isBlank ? 'No visible samples with Material set to Lab blank on this page.' : 'No matching samples on this page.'}</p>
  {/if}
  {#if rows.length}
    <form id={`${uid}-sample`} class="stack" onsubmit={e => { e.preventDefault(); void save(); }}>
      <label>{isBlank ? 'Lab blank sample' : 'Sample'}
        <select bind:value={sampleId} required disabled={loading || saving}>
          <option value="">Choose {isBlank ? 'a lab blank' : 'a sample'}</option>
          {#each rows as row (row.id)}<option value={row.id}>{capsuleSampleLabel(row)}</option>{/each}
        </select>
      </label>
      {#if sample}
        <div class="fields">
          {#if !isBlank}
            <label>Mineral <select value={mineral || defaultMineral} onchange={e => mineral = e.currentTarget.value as Mineral} disabled={saving}>
              {#each minerals as item}<option value={item}>{mineralWords(item)}</option>{/each}
            </select></label>
          {/if}
          <label>Fraction name <input type="text" bind:value={name} placeholder="Assign automatically" pattern={fractionNamePattern} disabled={saving} /></label>
        </div>
        <label>{isBlank ? 'Blank notes' : 'Fraction notes'} <textarea rows="2" bind:value={notes} disabled={saving}></textarea></label>
        {#if writeReason}<p class="small muted">{writeReason}</p>{/if}
        {#if saveError}<p class="small error" role="status">{saveError}</p>{/if}
      {/if}
    </form>
  {/if}
  {#if page?.nextCursor}<button type="button" class="btn small" disabled={loading || saving} onclick={() => void search(true)}>Load more samples</button>{/if}
  <details>
    <summary>{isBlank ? 'Register a lab blank sample' : 'Register a new sample'}</summary>
    {#if isBlank}
      <p class="small muted">Create a reusable sample for your lab or project in UPbDB. Include “blank” in its name and set Material to <strong>Lab blank</strong>.</p>
    {:else}
      <p class="small muted">Create a sample with its project and metadata in UPbDB. Use <strong>TIMS only</strong> in Purpose to categorize the sample, then return here to assign it to a capsule.</p>
    {/if}
    {#if identity.target?.server}
      <p class="small muted">Sample registration requires staff access in UPbDB.</p>
      <button type="button" class="btn small" onclick={openSampleRegistration}>Open sample registration in UPbDB</button>
    {/if}
  </details>
  </div>
  {#if sample}<div class="actions"><button type="submit" form={`${uid}-sample`} class="btn primary" disabled={!editable || loading || saving || !!writeReason}>
          {isBlank ? `Set ${label} as a lab blank` : `Assign sample to ${label}`}
        </button></div>{/if}
</section>

<style>
  .sample-capsule { flex: 1; min-height: 0; gap: 0; }
  .sample-scroll { min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; overflow-anchor: none; padding: 2px; }
  .sample-scroll > :global(*) { flex-shrink: 0; }
  .actions { flex-shrink: 0; margin-top: auto; padding-top: var(--space-2); }
  h4, p { margin: 0; }
  label { display: grid; gap: 4px; }
  .search { flex-wrap: wrap; }
  .search input { flex: 1; min-width: min(150px, 100%); }
  .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(155px, 100%), 1fr)); gap: var(--space-2); }
  input, select, textarea { width: 100%; min-width: 0; }
  details[open] p { margin: var(--space-1) 0 var(--space-2); }
</style>
