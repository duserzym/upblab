<script lang="ts">
  import { untrack, setContext, type Snippet } from 'svelte';
  import ScopePicker from '../components/review/ScopePicker.svelte';
  import ReviewDock from '../components/ReviewDock.svelte';
  import type { ConcordiaMode } from '../lib/concordia';
  import { grainKey } from '../lib/review-layers';
  import ReviewLayers from '../components/review/ReviewLayers.svelte';
  import { review } from '../lib/review.svelte';
  import { groupSpots, spotGroupKey, type ReviewSpot } from '../lib/review-data';
  import { identity } from '../lib/identity.svelte';
  import { selection } from '../lib/selection.svelte';
  import { equalLayout, presetLayout, presets, readLayout } from '../lib/review-layout';
  import { settings } from '../lib/settings.svelte';
  import { color } from '../components/review/plot-data';
  import { groupUnregistered, rangeSelection } from '../lib/review-selection';
  import { allShown, filterRows, groupState, noneShown, rangeToggle, recallShown, reconcile, rememberShown, setGroup, soloSample, toggleSample } from '../lib/sample-filter';
  import { sendCommand } from '../lib/incoming';
  import { editInAtlas, openInStudio } from '../lib/apps.svelte';
  import { shell } from '../lib/shell.svelte';
  import type { ReviewSpotsCommand } from '@lab/bridge';
  import ConcordiaPlot from '../components/review/ConcordiaPlot.svelte';
  import GeochemistryPlot from '../components/review/GeochemistryPlot.svelte';
  import DepthPlot from '../components/review/DepthPlot.svelte';
  import SpotDetails from '../components/review/SpotDetails.svelte';
  let { active, split = false, imagesOnly, images }: {
    active: boolean; split?: boolean; imagesOnly: boolean; images: Snippet<[boolean, string]>;
  } = $props();
  const dockLayout = $derived(readLayout(split ? settings.reviewDockSplit : settings.reviewDockSolo, split, settings.reviewDataWidth));
  let layoutsOpen = $state(false);
  let layoutChoices = $state<HTMLDivElement>();
  function layoutEscape(event: KeyboardEvent) {
    if (active && shell.view === 'review' && review.selected && !event.defaultPrevented
      && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
      && !(event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"],[role="menu"]'))
      && !document.querySelector(':popover-open')) {
      const spot = review.selected, key = event.key.toLowerCase();
      if (key === 'e' && spot.atlasProjectId) {
        event.preventDefault(); void editInAtlas({ project: spot.atlasProjectId, mount: spot.mountId, spot: spot.atlasSpotId }, 'review');
      } else if (key === 's' && (spot.sessionId || spot.runId)) {
        event.preventDefault(); void openInStudio({ session: spot.sessionId, run: spot.runId, acquisition: spot.acquisitionId }, 'review');
      }
    }
    if (layoutsOpen && layoutChoices?.getClientRects().length && event.key === 'Escape' && !event.defaultPrevented && !document.querySelector(':popover-open')) { layoutsOpen = false; event.preventDefault(); }
  }
  let dock = $state<ReturnType<typeof ReviewDock>>();
  // Release canvases while hidden, retaining each plot's axis and diagram choices.
  setContext('upbstudio.review-visible', () => active && review.state === 'ready');
  let filter = $state(''), plot = $state('Concordia');
  let samplesShown = $state<string[]>([]);
  let sampleAnchor = $state<string | null>(null), grainAnchor = $state<string | null>(null);
  let groupUnknown = $state(true);
  let concordiaMode = $state<ConcordiaMode>('wetherill');
  let hiddenSpots = $state.raw(new Set<string>());
  let atlasFocus = $state<ReviewSpot | null>(null);
  const scopeRows = $derived(groupUnknown ? groupUnregistered(review.rows) : review.rows);
  const scopeGroups = $derived(groupSpots(scopeRows));
  const samples = $derived(scopeGroups.map(group => ({
    key: group.key, name: group.name, reference: group.reference, count: group.grains.reduce((n, g) => n + g.spots.length, 0),
  })));
  const sampleOrder = $derived(samples.map(sample => sample.key));
  const scopeValue = $derived(review.scope ? `${review.scope.kind}:${review.scope.id}` : '');
  const filterScope = $derived(`${scopeValue}|${groupUnknown ? 'grouped' : 'ungrouped'}`);
  const material = $derived(review.sessions.find(s=>s.id===(review.scope?.kind==='session'?review.scope.id:review.rows.find(r=>r.sessionId)?.sessionId))?.material);
  $effect(() => {
    void scopeValue;
    untrack(() => { clearSelection(); filter = ''; });
  });
  $effect(() => {
    if (review.state !== 'ready') return;
    const key = filterScope, ordered = sampleOrder, entries = samples;
    untrack(() => {
      samplesShown = reconcile(recallShown(key), ordered, entries);
      rememberShown(key, samplesShown);
      clearSelection();
    });
  });
  $effect(() => {
    void runContext;
    hiddenSpots = new Set();
  });
  function hideSpots(keys: string[]) {
    setVisibility(keys, false);
  }
  function setVisibility(keys: string[], show: boolean) {
    const next = new Set(hiddenSpots);
    for (const key of keys) {
      if (show) next.delete(key);
      else next.add(key);
    }
    hiddenSpots = next;
    if (review.hoveredKey && next.has(review.hoveredKey)) review.hoveredKey = null;
  }
  function setShown(next: string[]) {
    samplesShown = next;
    rememberShown(filterScope, next);
  }
  function clearSelection() {
    sampleAnchor = grainAnchor = null;
    review.hoveredKey = null;
  }
  function showAll() { setShown(allShown(sampleOrder)); clearSelection(); }
  function showNone() { setShown(noneShown()); clearSelection(); }
  function showGroup(reference: boolean) {
    setShown(setGroup(samplesShown, samples, reference, groupState(samplesShown, samples, reference) !== 'all'));
    clearSelection();
  }
  function solo(key: string) {
    setShown(soloSample(key));
    sampleAnchor = key;
    grainAnchor = null;
    review.hoveredKey = null;
    const rows = scopeRows.filter(row => spotGroupKey(row) === key);
    const mapped = split ? rows.find(row => row.atlasSpotId) : null;
    const next = mapped ?? rows[0];
    if (next) review.select(next, false);
    if (mapped) atlasFocus = mapped;
  }
  function showSample(key: string, event: MouseEvent) {
    if (event.altKey) { solo(key); return; }
    setShown(event.shiftKey ? rangeToggle(samplesShown, sampleOrder, sampleAnchor, key) : toggleSample(samplesShown, sampleOrder, key));
    if (!event.shiftKey) sampleAnchor = key;
    grainAnchor = null;
    review.hoveredKey = null;
  }
  function sampleKeydown(key: string, event: KeyboardEvent) {
    if (event.altKey && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      solo(key);
    }
  }
  function showGrain(key: string, rows: ReviewSpot[], event: MouseEvent, order: string[]) {
    const byKey = new Map(groups.flatMap(sample => sample.grains.map(grain => [grainKey(sample.key, grain.key), grain.spots] as const)));
    const visibleGrains = order.filter(id => byKey.get(id)?.some(spot => !hiddenSpots.has(spot.key)));
    const selected = rangeSelection(visibleGrains, order, key, grainAnchor, event) ?? order;
    const plain = !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const nextHidden = new Set(hiddenSpots);
    for (const [id, spots] of byKey) {
      if (!selected.includes(id)) for (const spot of spots) nextHidden.add(spot.key);
      else if (!visibleGrains.includes(id) || plain) for (const spot of spots) nextHidden.delete(spot.key);
    }
    hiddenSpots = nextHidden;
    if (!event.shiftKey) grainAnchor = key;
    review.hoveredKey = null;
    if (plain) {
      const next = rows[0];
      if (next) {
        review.select(next, false);
        if (split) atlasFocus = rows.find(row => row.atlasSpotId) ?? null;
        else void review.focusGrain(rows);
      }
    }
  }
  $effect(()=>{void plot;void active;untrack(()=>review.hoveredKey=null);});
  let seenEvent: unknown = null;
  let loadedContext = '';
  const sampleRows = $derived(filterRows(scopeRows, samplesShown));
  const groups = $derived(groupSpots(sampleRows, filter));
  const plotted = $derived(groups.flatMap(sample => sample.grains.flatMap(grain => grain.spots)));
  const shown = $derived(plotted.filter(row => !hiddenSpots.has(row.key)));
  const shownKeys = $derived(new Set(shown.map(row => row.key)));
  const visibility = $derived.by(() => {
    const projects = new Map<string, Set<string>>();
    for (const row of review.rows)
      if (row.atlasProjectId && !projects.has(row.atlasProjectId)) projects.set(row.atlasProjectId, new Set());
    for (const row of shown)
      if (row.atlasProjectId && row.atlasSpotId) projects.get(row.atlasProjectId)?.add(row.atlasSpotId);
    return Object.fromEntries([...projects].sort(([a], [b]) => a.localeCompare(b)).map(([id, spots]) => [id, [...spots].sort()]));
  });
  const visibleColors = $derived.by(() => {
    const projects = new Map<string, Map<string, string>>();
    for (const row of shown) {
      if (!row.atlasProjectId || !row.atlasSpotId) continue;
      let spots = projects.get(row.atlasProjectId);
      if (!spots) projects.set(row.atlasProjectId, spots = new Map());
      spots.set(row.atlasSpotId, color(row.sampleName));
    }
    return Object.fromEntries([...projects].sort(([a], [b]) => a.localeCompare(b)).map(([id, spots]) => [id, Object.fromEntries([...spots].sort(([a], [b]) => a.localeCompare(b)))]));
  });
  let lastVisibility = '';
  let displayedContext = '';
  $effect(() => {
    const inReview = active && split && review.state === 'ready';
    const projects = inReview ? visibility : {};
    const colors = inReview ? visibleColors : {};
    const focus = atlasFocus;
    const context = runContext;
    const signature = JSON.stringify({ projects, colors });
    untrack(() => {
      const opening = inReview && displayedContext !== context;
      displayedContext = inReview ? context : '';
      if (!opening && !focus && (signature === lastVisibility || (!lastVisibility && !inReview))) return;
      const target = inReview ? (focus ?? (opening ? shown.find(row => row.atlasProjectId && row.atlasSpotId) : null)) : null;
      atlasFocus = null;
      lastVisibility = signature;
      const message: ReviewSpotsCommand = { type: 'review-spots', projects, colors };
      if (target?.atlasProjectId && target.atlasSpotId) {
        message.focus = { project: target.atlasProjectId, spot: target.atlasSpotId, server: shell.serverUrl, via: 'review', flash: false };
      }
      void sendCommand('images', message).catch(err => console.warn('Could not sync image overlays', err));
    });
  });
  const runContext = $derived(JSON.stringify(review.scope));
  $effect(() => {
    if (!active || !settings.loaded || identity.checking)
      return;
    const context = `${identity.target?.server}:${identity.revision}:${identity.signedIn}`;
    untrack(() => {
      if (context !== loadedContext || review.state === 'idle') {
        loadedContext = context;
        void review.load();
      }
    });
  });
  $effect(() => {
    const event = selection.fromImages;
    if (!active || !event || review.state !== 'ready' || event === seenEvent)
      return;
    seenEvent = event;
    untrack(() => {
      const spot = scopeRows.find(row => row.atlasSpotId === event.spot && (!row.atlasProjectId || row.atlasProjectId === event.project));
      if (spot && event.via !== 'shell') {
        if (!plotted.some(row => row.key === spot.key)) filter = '';
        const key = spotGroupKey(spot);
        if (!samplesShown.includes(key)) setShown(toggleSample(samplesShown, sampleOrder, key));
      }
      void review.fromImages(event);
    });
  });
  function selectSpot(spot: ReviewSpot) {
    if (!plotted.some(row => row.key === spot.key)) filter = '';
    review.select(spot);
  }
</script>
<svelte:window onkeydown={layoutEscape} />
{#snippet layoutButtons()}
  {#each presets.filter(name => split || name !== 'Image focus') as name}
    <button class="chip" aria-pressed={equalLayout(dockLayout, presetLayout(name, split))} title={name === 'Balanced' ? 'Reset layout to the default panel positions and sizes' : name} onclick={() => { dock?.applyPreset(name); layoutsOpen = false; }}>{name}</button>
  {/each}
{/snippet}
<section id="review-data-pane" class="view review" class:hidden={!active && !imagesOnly} aria-label="Review results" data-testid="review-view">
  <div class="toolbar glass" hidden={imagesOnly}>
    <ScopePicker active={active && !imagesOnly}>
      {#snippet actions()}
        <div class="layout-presets" role="group" aria-label="Layout">{@render layoutButtons()}</div>
        <button class="chip layout-toggle" aria-expanded={layoutsOpen} aria-controls="review-layout-presets" onclick={() => layoutsOpen = !layoutsOpen}>Layout</button>
        <label class="split-toggle"><input type="checkbox" checked={settings.reviewSplit} onchange={e=>void settings.update({reviewSplit:e.currentTarget.checked})} /> SEM images</label>
      {/snippet}
    </ScopePicker>
    {#if layoutsOpen}
      <div id="review-layout-presets" class="layout-drawer" role="group" aria-label="Layout presets" bind:this={layoutChoices}>{@render layoutButtons()}</div>
    {/if}
    {#if review.state==='ready'}
      <div class="selection-bar" aria-label="Shown samples and standards">
        <div class="selection-actions">
          <button class="chip" aria-pressed={sampleOrder.every(key=>samplesShown.includes(key))} onclick={showAll}>All</button>
          <button class="chip" aria-pressed={samplesShown.length===0} onclick={showNone}>None</button>
        </div>
        {#each [false, true] as reference}
          {@const entries = samples.filter(sample => sample.reference === reference)}
          {@const state = groupState(samplesShown, samples, reference)}
          {#if entries.length}
            <div class="sample-bar" aria-label={reference ? 'Standards' : 'Samples'}>
              <button class="chip section-label" aria-label={reference ? 'All standards' : 'All samples'}
                aria-pressed={state==='some'?'mixed':state==='all'} onclick={()=>showGroup(reference)}>{reference ? 'Standards' : 'Samples'}</button>
              {#each entries as sample (sample.key)}
                <div class="sample-toggle">
                <button class="chip sample-chip" aria-label={`${reference ? 'Standard' : 'Sample'} ${sample.name}`}
                  aria-pressed={samplesShown.includes(sample.key)}
                  title="Click to toggle · Shift-click to toggle a range · Alt/Option-click or Alt+Enter/Space to show only this sample"
                  onclick={e=>showSample(sample.key,e)} onkeydown={e=>sampleKeydown(sample.key,e)}>
                  <i style:background={color(sample.name)}></i><span>{sample.name}</span><small>{sample.count}</small>
                </button>
                <button class="chip sample-only" aria-label={`Show only ${sample.name}`} tabindex="-1" onclick={()=>solo(sample.key)}>only</button>
                </div>
              {/each}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
  {#if !imagesOnly}
  {#if review.state==='signed-out'}
    <div class="panel stack"><p class="muted">{review.error||'Sign in to read stored results from laicpmsdb.'}</p><button class="btn" onclick={()=>identity.dialog=true}>Sign in</button></div>
  {:else if review.state==='idle'}<p class="panel muted">No laicpmsdb server configured. Set a server in Settings to read results.</p>
  {:else if review.state==='loading'}<p class="panel muted" role="status">Loading results from laicpmsdb…</p>
  {:else if review.state==='error'}<div class="panel stack"><p class="error">Could not read results: {review.error}</p><button class="btn" onclick={()=>void review.load()}>Retry</button></div>
  {:else}
    {#if review.error}<p class="error small notice" role="status">{review.error}</p>{/if}
  {/if}
  {/if}
  <ReviewDock {active} {split} {imagesOnly} ready={review.state==='ready'} {images} bind:this={dock}>
    {#snippet spots()}
      <aside class="tree stack" aria-label="Samples and grains">
        <input type="search" aria-label="Filter spots" placeholder="Filter spots…" bind:value={filter} />
        <label class="group-option"><input type="checkbox" bind:checked={groupUnknown} /> Group unregistered by spot name</label>
        {#key scopeValue}
          <ReviewLayers scope={scopeValue} {groups} allGroups={scopeGroups} hidden={hiddenSpots} searching={!!filter.trim()} {active}
            onvisibility={setVisibility} ongrain={showGrain} onall={showAll} onclear={clearSelection} />
        {/key}
        {#if !plotted.length}<p class="small faint">{samplesShown.length===0?'No samples shown':'No spots match this view.'}</p>{/if}
      </aside>
    {/snippet}
    {#snippet plots()}
      <div class="plots stack">
        <div class="view-switch" role="tablist" aria-label="Review plots">{#each ['Concordia','Geochemistry','Depth profile'] as tab}<button role="tab" class="chip" aria-selected={plot===tab} onclick={()=>plot=tab}><svg viewBox="0 0 20 20" aria-hidden="true"><path d={tab==='Concordia'?'M3 17V3m0 14h14M5 15c2-7 5-9 11-11':tab==='Geochemistry'?'M2 2h6v6H2zm10 0h6v6h-6zM2 12h6v6H2zm10 0h6v6h-6z':'M3 3v14h14M5 12l3-6 3 8 5-5'} /></svg><span>{tab}</span></button>{/each}</div>
        {#if plot==='Concordia'}{#if samplesShown.length===0}<p class="muted small">No samples shown</p>{/if}{#key runContext}<ConcordiaPlot bind:mode={concordiaMode} rows={plotted} selected={review.selectedKey} onselect={selectSpot}
          hidden={hiddenSpots} onhide={hideSpots} onrestore={() => hiddenSpots = new Set()} />{/key}
        {:else if plot==='Geochemistry'}<GeochemistryPlot {material} catalogueRows={scopeRows} rows={shown} selected={review.selectedKey} onselect={selectSpot} />
        {:else if samplesShown.length===0}<p class="muted small">No samples shown</p>
        {:else if review.selected && shownKeys.has(review.selected.key)}<DepthPlot />
        {:else}<p class="muted small">Select a visible spot to view its depth profile.</p>{/if}
      </div>
    {/snippet}
    {#snippet details()}
      <aside class="details stack" aria-label="Spot details" data-testid="review-details"><SpotDetails /></aside>
    {/snippet}
  </ReviewDock>
</section>
<style>
  .review {overflow:hidden;}
  .layout-presets {display:flex;align-items:center;gap:4px;flex-wrap:wrap;}
  .layout-toggle,.layout-drawer {display:none;}
  .layout-presets .chip {font-size:0.72rem;padding:3px 7px;}
  .toolbar[hidden] {display:none;}
  .toolbar {display:flex;flex-direction:column;gap:8px;padding:8px 12px;border-radius:0;flex:none;min-width:0;border:0;box-shadow:none;}
  label {display:flex;align-items:center;gap:4px;font-size:0.75rem;min-width:0;}
  .selection-bar {display:flex;align-items:flex-start;gap:5px 12px;flex-wrap:wrap;max-height:86px;overflow:auto;min-width:0;padding:4px;}
  .sample-bar,.selection-actions {display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-width:0;}
  .selection-bar .chip {padding:2px 7px;font-size:0.75rem;}
  .sample-toggle {position:relative;min-width:0;max-width:100%;}
  .selection-bar .sample-chip {max-width:240px;width:100%;padding-right:42px;}.sample-chip span {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.sample-chip i {width:9px;height:9px;border-radius:50%;flex:none;}.sample-chip small {color:var(--text-muted);}
  .selection-bar .sample-only {position:absolute;right:3px;top:50%;transform:translateY(-50%);padding:0 4px;font-size:0.65rem;opacity:0;pointer-events:none;}
  .sample-toggle:hover .sample-only,.sample-toggle:focus-within .sample-only {opacity:1;pointer-events:auto;}
  .sample-chip:focus-visible,.sample-only:focus-visible,.section-label:focus-visible {outline:2px solid var(--accent);outline-offset:2px;}
  .section-label {font-size:0.67rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);}
  .section-label[aria-pressed='mixed'] {background:var(--accent-soft);border-style:dashed;}
  .tree,.plots,.details {flex:1;padding:8px;min-height:0;min-width:0;gap:8px;}
  .group-option {font-size:0.68rem;align-items:flex-start;}
  .tree>input {width:100%;min-width:0;font-size:0.78rem;}
  .plots {overflow:auto;background:var(--glass);}.details {overflow-y:auto;overflow-x:hidden;overflow-wrap:anywhere;}
  .notice {margin:0;padding:4px 12px;}.view-switch {display:flex;align-items:center;gap:4px;flex:none;min-width:0;flex-wrap:wrap;}.view-switch button {border:0;background:transparent;gap:5px;font-size:0.78rem;padding:5px 8px;}.view-switch svg {width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.4;flex:none;}.view-switch button[aria-selected='true'] {background:var(--accent-soft);color:var(--accent);}
  :global(.review .wrap) {flex-wrap:wrap;}
  :global(.review .plots label) {display:inline-flex;align-items:center;gap:4px;font-size:0.8rem;min-width:0;max-width:100%;}
  :global(.review .plots select) {max-width:175px;min-width:0;}
  :global(.review .plots p) {margin:0;}
  @container (max-width:500px) {.view-switch {gap:1px;}.view-switch button {font-size:0.69rem;padding:5px 3px;gap:2px;}.view-switch svg {display:none;}}
  @media (max-width:1100px) {
    .layout-presets {display:none;}
    .layout-toggle {display:inline-flex;}
    .layout-drawer {display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:6px;border:1px solid var(--hairline);border-radius:var(--radius-sm);background:var(--accent-soft);}
  }
</style>
