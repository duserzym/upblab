<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { firstPage, mineralWords, type ReplaceSourceInput, type FractionOut, type ListPage, type Mineral, type SourceOut } from '../../lib/tims-api';
  import { grainSources, missingSpotSources } from '../../lib/tims-capsule-import';
  import { fractionNamePattern } from '../../lib/tims-capsule-intake';
  import { minerals } from '../../lib/tims-model';
  import { mountElements, OnlineAction, ReplyScope } from '../../lib/tims-requests';
  import { onlineOnlyReason } from '../../lib/outbox.svelte';
  import type { MountGeometry } from '../../lib/tims-geometry';
  import { plural } from '../../lib/plural';
  import { identity } from '../../lib/identity.svelte';
  import { WriteError } from '../../lib/oversight.svelte';
  import { sourceNames } from '../../lib/tims-geometry';
  import { loadPickerContext, savePickerContext, loadRecentMounts, rememberMount } from '../../lib/tims-picker-context';
  import MountPicker from './MountPicker.svelte';
  import GrainImage from './GrainImage.svelte';

  import { grainChoiceLabel, searchSpots, spotMountQuery, type GrainChoice as Choice } from '../../lib/tims-spot-search';
  import { findSpotMounts, mountSpotIndex, type PickerMount as Mount, type FoundMount, type SpotMountSearch } from '../../lib/tims-spot-finder';
  let { batch, lab, position, label, fraction, editable, defaultMineral = 'zircon', oncreated, onlinked, replacing, onreplaced, refreshRevision = 0, close }: {
    batch: string; lab: string; position: number; label: string; fraction?: FractionOut; editable: boolean;
    replacing?: SourceOut; onreplaced: (value: FractionOut) => void; refreshRevision?: number;
    defaultMineral?: Mineral; oncreated: (value: FractionOut) => void;
    onlinked: (id: string, source: SourceOut) => void; close: () => void;
  } = $props();

  const pageSize = 24;
  let mounts = $state.raw<Mount[]>([]), mountsPage = $state.raw<ListPage<Mount> | null>(null);
  let recent = $state.raw<Mount[]>([]);
  let reason = $state('');
  const viewer = () => ({ server: identity.target?.server ?? '', account: identity.account?.id ?? identity.account?.username ?? '' });
  let restored = false;
  let restoredScope = '';
  let findBusy = $state(false), sampleFilter = $state('');
  let findResult = $state.raw<SpotMountSearch>(), findError = $state('');
  let findGeneration = 0;
  let grainQuery = $state(''), mountId = $state(''), count = $state(pageSize);
  let geometry = $state.raw<MountGeometry>(), choice = $state.raw<Choice>(), mineral = $state<Mineral>('zircon');
  let fractionName = $state(''), selectedSpots = $state.raw<string[]>([]), singleSpot = $state('');
  let fragment = $state(false), fragmentNote = $state(''), mountBusy = $state(false), grainBusy = $state(false), saving = $state(false);
  let mountError = $state(''), grainError = $state(''), saveError = $state('');
  let appliedMountQuery = '';
  let mountGeneration = 0;
  const replies = new ReplyScope(() => [batch, lab]);
  const createAction = new OnlineAction<FractionOut>();
  const replaceAction = new OnlineAction<FractionOut>();
  const sourceAction = new OnlineAction<SourceOut>();
  onDestroy(() => replies.invalidate());

  const index = $derived(geometry ? mountSpotIndex(geometry) : undefined);
  const matches = $derived(index ? searchSpots(index, grainQuery, sampleFilter).map(match => match.choice) : []);
  const available = $derived(choice ? missingSpotSources(fraction?.sources ?? [], choice.grain, choice.spots) : null);
  const writeReason = $derived(onlineOnlyReason());
  const needsSample = $derived(!fraction && choice?.grain.sample === null);

  $effect(() => {
    // Parent batch updates can invalidate these prop getters without changing their values.
    const scope = JSON.stringify([batch, lab]);
    if (scope === restoredScope) return;
    untrack(() => {
      restoredScope = scope;
      const context = loadPickerContext(viewer(), batch);
      recent = loadRecentMounts(viewer());
      if (context.mount) mounts = [context.mount];
      void loadMounts();
      if (context.mount) void openMount(context.mount.id, false, true);
      sampleFilter = context.sample; grainQuery = context.search; restored = true;
    });
  });
  $effect(() => {
    const mount = mounts.find(m => m.id === mountId), sample = sampleFilter, search = grainQuery;
    if (restored) untrack(() => savePickerContext(viewer(), batch, { mount, sample, search }));
  });
  $effect(() => { const revision = refreshRevision; if (revision > 0) untrack(() => { if (mountId) void openMount(mountId, false, true); }); });
  $effect(() => {
    void position; void replacing?.id;
    untrack(() => {
      choice = undefined;
      mineral = defaultMineral;
      fractionName = '';
      saveError = ''; reason = '';
    });
  });

  async function loadMounts(more = false, query = '') {
    if (mountBusy) return;
    const current = replies.capture();
    mountBusy = true;
    mountError = '';
    if (!more) appliedMountQuery = query.trim();
    try {
      const next = more ? await mountsPage?.more() : await firstPage<Mount>('/v1/mounts', { limit: '50', q: appliedMountQuery });
      if (!current() || !next) return;
      mounts = more ? [...mounts, ...next.items.filter(row => !mounts.some(existing => existing.id === row.id))] : [...next.items, ...mounts.filter(row => row.id === mountId && !next.items.some(m => m.id === row.id))];
      mountsPage = next;
    } catch (error) {
      if (current()) mountError = String(error);
    } finally {
      if (current()) mountBusy = false;
    }
  }

  function cancelSpotSearch() {
    findGeneration++;
    findBusy = false;
    findResult = undefined;
    findError = '';
  }

  async function openMount(id: string, revalidate = false, preserve = false) {
    cancelSpotSearch();
    if (!preserve) sampleFilter = '';
    mountGeneration++;
    mountId = id;
    choice = undefined;
    geometry = undefined;
    if (!preserve) grainQuery = '';
    count = pageSize;
    grainError = '';
    saveError = '';
    grainBusy = !!id;
    if (!id) return;
    const mount = mounts.find(m => m.id === id);
    if (mount) recent = rememberMount(viewer(), mount);
    const current = replies.capture(() => [mountId, mountGeneration]);
    try {
      const value = await mountElements(id, revalidate);
      if (current()) geometry = value;
    } catch (error) {
      if (current()) grainError = String(error);
    } finally {
      if (current()) grainBusy = false;
    }
  }

  function chooseFound(found: FoundMount, query: string) {
    findGeneration++;
    mountGeneration++;
    findBusy = false;
    findResult = undefined;
    mountId = found.mount.id;
    geometry = found.geometry;
    recent = rememberMount(viewer(), found.mount);
    if (!mounts.some(mount => mount.id === found.mount.id)) mounts = [...mounts, found.mount];
    const samples = [...new Set(found.matches.map(match => match.choice.grain.sample).filter(Boolean))];
    sampleFilter = samples.length === 1 ? samples[0]! : '';
    grainQuery = query;
    choice = undefined;
    grainBusy = false;
    grainError = '';
    saveError = '';
    count = pageSize;
  }

  async function findSpot() {
    const query = grainQuery.trim();
    if (!query || findBusy) return;
    choice = undefined;
    count = pageSize;
    findError = '';
    findResult = undefined;
    const sampleQuery = spotMountQuery(query, !!geometry);
    if (!sampleQuery) return;
    // A matching grain label without a sample prefix stays within this mount.
    if (index && matches.length && !index.samples.some(sample =>
      sample.toLowerCase().startsWith(sampleQuery.toLowerCase()))) return;
    findGeneration++;
    const generation = findGeneration;
    const current = replies.capture(() => [findGeneration, mountGeneration, grainQuery, position]);
    findBusy = true;
    try {
      const result = await findSpotMounts(query, sampleQuery, value => { if (current()) findResult = value; }, current);
      if (!current()) return;
      findResult = result;
      if (result.matches.length === 1 && !result.errors.length && !result.hasMore) chooseFound(result.matches[0], query);
    } catch (error) {
      if (current()) findError = String(error);
    } finally {
      // Typing invalidates a reply, but must also release this search's busy state.
      if (findGeneration === generation) findBusy = false;
    }
  }

  function select(next: Choice) {
    cancelSpotSearch();
    choice = next;
    selectedSpots = next.spots.map(spot => spot.server_id!);
    singleSpot = replacing ? next.spots[0]?.server_id ?? '' : missingSpotSources(fraction?.sources ?? [], next.grain, next.spots).spots[0]?.server_id ?? '';
    fragment = false;
    fragmentNote = '';
    saveError = '';
  }

  async function save() {
    if (!choice?.grain.server_id || !editable || writeReason || saving) return;
    const current = replies.capture();
    const savedInScope = new ReplyScope(() => [batch, lab]).capture();
    const isTarget = replies.capture(() => [position, mountId, choice?.grain.server_id]);
    const target = fraction?.id;
    const sources = grainSources(choice.grain.server_id, target ? singleSpot ? [singleSpot] : [] : selectedSpots, fragment ? fragmentNote : '');
    function finishAssignment() {
      if (!isTarget()) return;
      grainQuery = '';
      choice = undefined;
      // Save before the callback can hide or rebuild this picker.
      savePickerContext(viewer(), batch, { mount: mounts.find(m => m.id === mountId), sample: sampleFilter, search: '' });
    }
    saving = true;
    saveError = '';
    try {
      if (target && replacing) {
        const result = await replaceAction.send(`/v1/fractions/${encodeURIComponent(target)}/sources/${encodeURIComponent(replacing.id)}/replace`, 'POST', {
          grain_id: choice.grain.server_id, ...(singleSpot ? { spot_id: singleSpot } : {}),
          is_fragment: fragment, fragment_note: fragment ? fragmentNote.trim() : '', note: '', reason: reason.trim(),
        } satisfies ReplaceSourceInput, `fraction:${target}`);
        finishAssignment();
        if (savedInScope()) onreplaced(result);
      } else if (target) {
        const source = await sourceAction.send(`/v1/fractions/${encodeURIComponent(target)}/sources`, 'POST', sources[0], `fraction:${target}`);
        finishAssignment();
        if (savedInScope()) onlinked(target, source);
      } else {
        const result = await createAction.send('/v1/fractions', 'POST', {
          lab_id: lab, batch_id: batch, capsule_number: position, mineral,
          ...(fractionName.trim() ? { name: fractionName.trim() } : {}), sources,
        }, `batch:${batch}`);
        finishAssignment();
        if (savedInScope()) oncreated(result);
      }
    } catch (error) {
      if (isTarget()) saveError = replacing && error instanceof WriteError && [404, 405].includes(error.status) ? 'This server does not support Replace grain yet.' : String(error);
    } finally {
      if (current()) saving = false;
    }
  }
</script>

<section class="stack atlas-picker" aria-label="GrainAtlas picker">
  <div class="picker-scroll stack">
  <div class="row heading"><h3>GrainAtlas</h3><button class="btn small" type="button" onclick={close}>Back to capsule</button></div>
  {#if replacing}{@const names = sourceNames(replacing)}<p class="small">Replacing {names.grain} · spot {names.spot}</p>{/if}
  <MountPicker {mounts} {recent} selected={mounts.find(m => m.id === mountId)} busy={mountBusy} hasMore={!!mountsPage?.nextCursor}
    onchoose={mount => { if (!mounts.some(m => m.id === mount.id)) mounts = [...mounts, mount]; void openMount(mount.id); }}
    onmore={() => void loadMounts(true)} onsearch={query => void loadMounts(false, query)} />
  {#if mountBusy}<p class="muted small" role="status">Loading mounts…</p>{/if}
  {#if mountError}<p class="error small" role="status">{mountError}</p>{/if}
  {#if grainBusy}<p class="muted" role="status">Loading registered grains…</p>{/if}
  {#if grainError}<p class="error small" role="status">{grainError}</p><button class="btn" onclick={() => void openMount(mountId, true, true)}>Retry mount</button>{/if}

  <form class="row search" onsubmit={e => { e.preventDefault(); void findSpot(); }}>
    <input type="search" aria-label="Filter grains" placeholder="Spot, grain or sample" value={grainQuery} oninput={e => { grainQuery = e.currentTarget.value; count = pageSize; choice = undefined; findResult = undefined; findError = ''; }} />
    <button class="btn small" type="submit" disabled={findBusy || !grainQuery.trim()}>Find spot</button>
    {#if geometry}<button class="btn small" type="button" onclick={() => void openMount(mountId, true, true)}>Refresh</button>{/if}
  </form>
  {#if findBusy}<p class="small muted" role="status">Finding spots across up to 5 mounts…</p>{/if}
  {#if findError}<p class="small error" role="status">{findError}</p>{/if}
  {#if findResult}
    <div class="stack" aria-label="Matching mounts">
      {#each findResult.matches as found (found.mount.id)}
        {@const names = [...new Set(found.matches.flatMap(match => match.spotNames))]}
        <button class="btn mount-match" type="button" onclick={() => chooseFound(found, grainQuery.trim())} title={names.join(', ')}>
          {found.mount.label} · {names.slice(0, 5).join(', ')}{names.length > 5 ? ` · and ${names.length - 5} more` : ''}
        </button>
      {/each}
      {#if !findBusy && !findResult.matches.length}<p class="small muted" role="status">No matching spots in the checked mounts. Include the sample name, or choose a mount.</p>{/if}
      {#if findResult.hasMore}<p class="small muted">Checked up to 5 candidate mounts. Use Find mount to narrow the mount filter.</p>{/if}
      {#each findResult.errors as error}<p class="small error" role="status">{error}</p>{/each}
    </div>
  {/if}
  {#if geometry}
    <label>Sample <select value={sampleFilter} onchange={e => { cancelSpotSearch(); sampleFilter = e.currentTarget.value; choice = undefined; count = pageSize; }}>
      <option value="">All samples</option>
      {#each index?.samples ?? [] as sample}<option value={sample}>{sample}</option>{/each}
    </select></label>
    {#if choice}
      <form id="tims-grain-import" class="glass selection stack" aria-label="Grain import" onsubmit={e => { e.preventDefault(); void save(); }}>
        <div class="row heading"><strong>{grainChoiceLabel(choice)}</strong><button class="btn small" type="button" onclick={() => choice = undefined}>Choose another</button></div>
        <div class="row">
          {@render thumbnail(choice, 82)}
          {#if choice.grain.sample}<p class="small muted">{choice.grain.sample}</p>{/if}
        </div>
        {#if !fraction}
          <div class="fraction-fields">
            <label>Mineral <select bind:value={mineral} disabled={saving}>{#each minerals as item}<option value={item}>{mineralWords(item)}</option>{/each}</select></label>
            <label>Fraction name <input type="text" bind:value={fractionName} placeholder="Assign automatically" pattern={fractionNamePattern} disabled={saving} /></label>
          </div>
          {#if choice.spots.length}
            <fieldset><legend>Associated LA spots</legend>
              {#each choice.spots as spot (spot.server_id)}
                <label class="check"><input type="checkbox" checked={selectedSpots.includes(spot.server_id!)} disabled={saving} onchange={e => selectedSpots = e.currentTarget.checked ? [...selectedSpots, spot.server_id!] : selectedSpots.filter(id => id !== spot.server_id)} /> {spot.label || spot.name || 'Unnamed spot'}</label>
              {/each}
            </fieldset>
          {:else}<p class="small muted">No registered spots are linked to this grain.</p>{/if}
        {:else if replacing}
          <label>Source <select bind:value={singleSpot} disabled={saving}>
            <option value="">Grain only</option>
            {#each choice.spots as spot (spot.server_id)}<option value={spot.server_id}>{spot.label || spot.name || 'Unnamed spot'}</option>{/each}
          </select></label>
        {:else if available?.grainOnly || available?.spots.length}
          <label>Source <select bind:value={singleSpot} disabled={saving}>
            {#if available.grainOnly}<option value="">Grain only</option>{/if}
            {#each available.spots as spot (spot.server_id)}<option value={spot.server_id}>{spot.label || spot.name || 'Unnamed spot'}</option>{/each}
          </select></label>
          {#if available.spots.length > 1}<p class="small muted">Add one spot at a time to an existing fraction.</p>{/if}
        {:else}<p class="small muted">This grain and its associated spots are already linked.</p>{/if}
        <label class="check"><input type="checkbox" bind:checked={fragment} disabled={saving} /> Grain fragment</label>
        {#if fragment}<label>Fragment description <input type="text" bind:value={fragmentNote} disabled={saving} required /></label>{/if}
        {#if needsSample}<p class="small warning">Assign the grain to a sample in GrainAtlas before creating a fraction.</p>{/if}
        {#if selectedSpots.length > 500 && !fraction}<p class="small warning">Select 500 or fewer spots.</p>{/if}
        {#if writeReason}<p class="small muted">{writeReason}</p>{/if}
        {#if replacing && fraction}
          <label>Reason (optional) <input bind:value={reason} disabled={saving} /></label>
        {/if}
      </form>
    {:else}
      <p class="small muted">{plural(matches.length, 'grain')}</p>
      <div class="gallery" role="group" aria-label="Registered grains">
        {#each matches.slice(0, count) as item (item.grain.server_id)}
          <button class="btn grain" type="button" onclick={() => select(item)}>
            {@render thumbnail(item, 62)}
            <strong>{grainChoiceLabel(item)}</strong><span class="small muted">{plural(item.spots.length, 'spot')}</span>
          </button>
        {:else}<p class="small muted">No registered grains match.</p>{/each}
      </div>
      {#if matches.length > count}<button class="btn small" onclick={() => count += pageSize}>Show more grains</button>{/if}
    {/if}
  {/if}
  </div>
  <div class="save-row" role="group" aria-label="Picker actions">
    {#if replacing && fraction && choice}
          <p class="small action-note" role="status">{choice.grain.sample && choice.grain.sample !== fraction.sample.name
            ? `This grain is from ${choice.grain.sample}, not ${fraction.sample.name}. ${label} will hold a new ${choice.grain.sample} fraction; ${fraction.name} is kept as a replaced record.`
            : 'The old grain stays recorded as replaced.'}</p>
    {/if}
    {#if saveError}<p class="error small action-note" role="status">{saveError}</p>{/if}
    {#if choice}
      <button class="btn primary" form="tims-grain-import" disabled={!editable || !!writeReason || saving || needsSample || fragment && !fragmentNote.trim() || (!replacing && (fraction ? !singleSpot && !available?.grainOnly : selectedSpots.length > 500))}>{saving ? 'Saving…' : replacing ? 'Replace' : fraction ? 'Add source' : `Load into ${label}`}</button>
    {:else}<span class="small muted">Choose a grain to {replacing ? 'replace' : 'link'}.</span>{/if}
    <button class="btn small" type="button" onclick={close}>Close picker</button>
  </div>
</section>

{#snippet thumbnail(item: Choice, size: number)}
  <GrainImage source={{ mount_id: mountId, grain_id: item.grain.server_id!, atlas_grain_id: null, spot_id: item.spots[0]?.server_id ?? null, atlas_spot_id: null }}
    mount={{ current_project_uuid: geometry?.current_project_uuid ?? null, grains: [item.grain], spots: item.spots.slice(0, 1) }} {size} lazy />
{/snippet}

<style>
  section, form { min-width: 0; overflow-wrap: anywhere; }
  h3, p { margin: 0; }
  .heading { justify-content: space-between; flex-wrap: wrap; }
  .search { flex-wrap: wrap; }
  .search input { flex: 1; min-width: min(150px, 100%); }
  .mount-match { white-space: normal; overflow-wrap: anywhere; text-align: left; }
  .selection strong { overflow-wrap: anywhere; }
  label { display: grid; gap: 4px; }
  .check { display: flex; align-items: baseline; }
  input:not([type=checkbox]), select { width: 100%; min-width: 0; }
  .selection { padding: var(--space-3); border-radius: var(--radius-sm); }
  .fraction-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: var(--space-2); }
  .atlas-picker { height: 100%; min-height: 0; gap: 0; }
  .picker-scroll { min-height: 0; overflow-y: auto; overflow-x: hidden; padding: var(--space-2); }
  .picker-scroll > :global(*) { flex-shrink: 0; }
  .action-note { flex-basis: 100%; }
  .save-row { margin-top: auto; flex-shrink: 0; display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center; justify-content: end; padding: var(--space-2); border-top: 1px solid var(--hairline); background: var(--bg); }
  .gallery { max-height: min(300px, 32vh); min-height: 90px; overflow-y: auto; overflow-x: hidden; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-1); }
  .gallery .grain { display: grid; justify-items: center; align-content: start; gap: 2px; width: 100%; padding: 5px; border-radius: var(--radius-sm); white-space: normal; font-size: .78rem; overflow-wrap: anywhere; }
  fieldset { min-width: 0; border: 1px solid var(--hairline); border-radius: var(--radius-sm); }
  .warning { color: var(--warning); }
</style>
