<script lang="ts">
  import { untrack, setContext, type Snippet } from 'svelte';
  import ReviewDock from '../components/ReviewDock.svelte';
  import { grainKey } from '../lib/review-layers';
  import ReviewLayers from '../components/review/ReviewLayers.svelte';
  import { review } from '../lib/review.svelte';
  import { groupSpots, spotGroupKey, type ReviewSpot } from '../lib/review-data';
  import { identity } from '../lib/identity.svelte';
  import { selection } from '../lib/selection.svelte';
  import { settings } from '../lib/settings.svelte';
  import { color } from '../components/review/plot-data';
  import { groupUnregistered, rangeSelection } from '../lib/review-selection';
  import { sendCommand } from '../lib/incoming';
  import { shell } from '../lib/shell.svelte';
  import type { ReviewSpotsCommand } from '@lab/bridge';
  import ConcordiaPlot from '../components/review/ConcordiaPlot.svelte';
  import GeochemistryPlot from '../components/review/GeochemistryPlot.svelte';
  import DepthPlot from '../components/review/DepthPlot.svelte';
  import SpotDetails from '../components/review/SpotDetails.svelte';
  let { active, split = false, imagesOnly, images }: {
    active: boolean; split?: boolean; imagesOnly: boolean; images: Snippet<[boolean, string]>;
  } = $props();
  let dock = $state<ReturnType<typeof ReviewDock>>();
  // Release canvases while hidden, retaining each plot's axis and diagram choices.
  setContext('upbstudio.review-visible', () => active && review.state === 'ready');
  let filter = $state(''), scopeFilter = $state(''), plot = $state('Concordia');
  let scopePopup = $state<HTMLDivElement>();
  let samplesShown = $state<string[] | null>(null);
  let sampleAnchor = $state<string | null>(null), grainAnchor = $state<string | null>(null);
  let groupUnknown = $state(true);
  let hiddenSpots = $state.raw(new Set<string>());
  let atlasFocus = $state<ReviewSpot | null>(null);
  const scopeRows = $derived(groupUnknown ? groupUnregistered(review.rows) : review.rows);
  const scopeGroups = $derived(groupSpots(scopeRows));
  const samples = $derived(scopeGroups.map(group => ({
    key: group.key, name: group.name, reference: group.reference, count: group.grains.reduce((n, g) => n + g.spots.length, 0),
  })));
  const material = $derived(review.sessions.find(s=>s.id===(review.scope?.kind==='session'?review.scope.id:review.rows.find(r=>r.sessionId)?.sessionId))?.material);
  const scopeName = $derived(review.scope?.kind==='session'?review.sessions.find(s=>s.id===review.scope?.id)?.session_key:review.mounts.find(m=>m.id===review.scope?.id)?.label);
  $effect(() => {
    void scopeValue;
    untrack(() => { resetSelection(); filter = ''; });
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
  function resetSelection() {
    samplesShown = sampleAnchor = grainAnchor = null;
  }
  function clearSelection() {
    resetSelection();
    samplesShown = [];
    review.hoveredKey = null;
  }
  function showSample(key: string, event: MouseEvent) {
    samplesShown = rangeSelection(samplesShown, samples.map(s => s.key), key, sampleAnchor, event);
    if (!event.shiftKey) sampleAnchor = key;
    grainAnchor = null;
    review.hoveredKey = null;
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
      const rows = scopeRows.filter(row => spotGroupKey(row) === key);
      const mapped = split ? rows.find(row => row.atlasSpotId) : null;
      const next = mapped ?? rows[0];
      if (next) review.select(next, false);
      if (mapped) atlasFocus = mapped;
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
  const sampleRows = $derived(scopeRows.filter(r => samplesShown === null || samplesShown.includes(spotGroupKey(r))));
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
    return Object.fromEntries([...projects].map(([id, spots]) => [id, [...spots]]));
  });
  let lastVisibility = '';
  let displayedContext = '';
  $effect(() => {
    const inReview = active && split && review.state === 'ready';
    const projects = inReview ? visibility : {};
    const focus = atlasFocus;
    const context = runContext;
    const signature = JSON.stringify(projects);
    untrack(() => {
      const opening = inReview && displayedContext !== context;
      displayedContext = inReview ? context : '';
      if (!opening && !focus && (signature === lastVisibility || (!lastVisibility && !inReview))) return;
      const target = inReview ? (focus ?? (opening ? shown.find(row => row.atlasProjectId && row.atlasSpotId) : null)) : null;
      atlasFocus = null;
      lastVisibility = signature;
      const message: ReviewSpotsCommand = { type: 'review-spots', projects };
      if (target?.atlasProjectId && target.atlasSpotId) {
        message.focus = { project: target.atlasProjectId, spot: target.atlasSpotId, server: shell.serverUrl, via: 'review', flash: false };
      }
      void sendCommand('images', message).catch(err => console.warn('Could not sync image overlays', err));
    });
  });
  const scopeValue = $derived(review.scope ? `${review.scope.kind}:${review.scope.id}` : '');
  const runContext = $derived(JSON.stringify(review.scope));
  const complete = $derived(review.runs.filter(r => r.status === 'completed' || r.status === 'complete').sort((a, b) => b.started_at.localeCompare(a.started_at)));
  const newest = $derived(complete[0]);
  const noPreferred = $derived(!complete.some(r => r.is_preferred_for_session));
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
        if (samplesShown && !samplesShown.includes(key)) samplesShown = [...samplesShown, key];
      }
      void review.fromImages(event);
    });
  });
  function choose(value: string) {
    const [kind, ...rest] = value.split(':');
    if (kind === 'session' || kind === 'mount') void review.open({ kind, id: rest.join(':') });
  }
  function selectSpot(spot: ReviewSpot) {
    if (!plotted.some(row => row.key === spot.key)) filter = '';
    review.select(spot);
  }
</script>
<section id="review-data-pane" class="view review" class:hidden={!active && !imagesOnly} aria-label="Review results" data-testid="review-view">
  <div class="toolbar glass" hidden={imagesOnly}>
    <div class="scope-row">
      <h1>Review</h1>
      <button class="btn scope-button" aria-label="Choose review scope" title={`${scopeName || 'Choose scope'} · ${material || 'Stored results'} · ${review.rows.length} spots`} popovertarget="review-scope-picker"><span>{review.scope?.kind==='mount'?'Mount':'Session'} · {scopeName || 'Choose scope'}</span><small class="muted">{material || 'Stored results'} · {review.rows.length} spots</small><span aria-hidden="true">⌄</span></button>
      <div class="scope-picker" id="review-scope-picker" popover="auto" bind:this={scopePopup}>
        <input type="search" aria-label="Search scopes" placeholder="Find session or mount…" bind:value={scopeFilter} />
        <select aria-label="Review scope" size="9" value={scopeValue} onchange={e=>{choose(e.currentTarget.value);scopePopup?.hidePopover();}}>
          <option value="" disabled>Choose a session or mount</option>
          <optgroup label="Sessions">{#each review.sessions.filter(s=>`${s.session_key} ${s.material}`.toLowerCase().includes(scopeFilter.toLowerCase())||scopeValue===`session:${s.id}`) as s}<option value="session:{s.id}">{s.session_key} · {s.material} · {s.acquisition_count} spots</option>{/each}</optgroup>
          <optgroup label="Mounts">{#each review.mounts.filter(m=>m.label.toLowerCase().includes(scopeFilter.toLowerCase())||scopeValue===`mount:${m.id}`) as m}<option value="mount:{m.id}">{m.label}</option>{/each}</optgroup>
        </select>
      </div>
      {#if review.scope?.kind==='session'}
        <label class="run">Run <select aria-label="Review run" value={review.scope.run} onchange={e=>review.scope?.kind==='session'&&void review.open({...review.scope,run:e.currentTarget.value})}>
          <option value="preferred">{noPreferred&&newest?'Newest run, not preferred':'Preferred run'}</option>
          {#each complete as r}<option value={r.id}>{r.id.slice(0,8)} · {r.is_preferred_for_session?'preferred':noPreferred&&r.id===newest?.id?'newest run, not preferred':r.started_at.slice(0,10)}</option>{/each}
        </select></label>
      {/if}
      <button class="chip" onclick={()=>dock?.reset()} title="Restore the default panel positions and sizes">Reset layout</button>
      <label class="split-toggle"><input type="checkbox" checked={settings.reviewSplit} onchange={e=>void settings.update({reviewSplit:e.currentTarget.checked})} /> SEM images</label>
    </div>
    {#if review.state==='ready'}
      <div class="selection-bar" aria-label="Shown samples and standards">
        <div class="selection-actions">
          <button class="chip" aria-pressed={samplesShown===null} onclick={resetSelection}>All</button>
          <button class="chip" aria-pressed={samplesShown?.length===0} onclick={clearSelection}>Clear</button>
        </div>
        {#each [false, true] as reference}
          {@const entries = samples.filter(sample => sample.reference === reference)}
          {#if entries.length}
            <div class="sample-bar" aria-label={reference ? 'Standards' : 'Samples'}>
              <span class="section-label">{reference ? 'Standards' : 'Samples'}</span>
              {#each entries as sample (sample.key)}
                <button class="chip sample-chip" aria-label={`${reference ? 'Standard' : 'Sample'} ${sample.name}`}
                  aria-pressed={samplesShown===null||samplesShown.includes(sample.key)}
                  title="Click to isolate · Ctrl/Cmd-click to toggle · Shift-click for a range" onclick={e=>showSample(sample.key,e)}>
                  <i style:background={color(sample.name)}></i><span>{sample.name}</span><small>{sample.count}</small>
                </button>
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
        <label class="group-option"><input type="checkbox" bind:checked={groupUnknown} onchange={resetSelection} /> Group unregistered by spot name</label>
        {#key scopeValue}
          <ReviewLayers scope={scopeValue} {groups} allGroups={scopeGroups} hidden={hiddenSpots} searching={!!filter.trim()} {active}
            onvisibility={setVisibility} ongrain={showGrain} onall={resetSelection} onclear={clearSelection} />
        {/key}
        {#if !plotted.length}<p class="small faint">{samplesShown?.length===0?'No samples shown':'No spots match this view.'}</p>{/if}
      </aside>
    {/snippet}
    {#snippet plots()}
      <div class="plots stack">
        <div class="view-switch" role="tablist" aria-label="Review plots">{#each ['Concordia','Geochemistry','Depth profile'] as tab}<button role="tab" class="chip" aria-selected={plot===tab} onclick={()=>plot=tab}><svg viewBox="0 0 20 20" aria-hidden="true"><path d={tab==='Concordia'?'M3 17V3m0 14h14M5 15c2-7 5-9 11-11':tab==='Geochemistry'?'M2 2h6v6H2zm10 0h6v6h-6zM2 12h6v6H2zm10 0h6v6h-6z':'M3 3v14h14M5 12l3-6 3 8 5-5'} /></svg><span>{tab}</span></button>{/each}</div>
        {#if plot==='Concordia'}{#if samplesShown?.length===0}<p class="muted small">No samples shown</p>{/if}{#key runContext}<ConcordiaPlot rows={plotted} selected={review.selectedKey} onselect={selectSpot}
          hidden={hiddenSpots} onhide={hideSpots} onrestore={() => hiddenSpots = new Set()} />{/key}
        {:else if plot==='Geochemistry'}<GeochemistryPlot {material} catalogueRows={scopeRows} rows={shown} selected={review.selectedKey} onselect={selectSpot} />
        {:else if samplesShown?.length===0}<p class="muted small">No samples shown</p>
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
  .toolbar[hidden] {display:none;}
  h1 {font-size:1rem;margin:0;}
  .toolbar {display:flex;flex-direction:column;gap:8px;padding:8px 12px;border-radius:0;flex:none;min-width:0;border:0;box-shadow:none;}
  .scope-row {display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap;}
  .scope-button {min-width:0;max-width:420px;gap:8px;font-size:0.8rem;padding:4px 8px;}.scope-button>span:first-child {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.scope-button small {font-size:0.7rem;white-space:nowrap;}
  .scope-picker {position:fixed;top:100px;left:12px;margin:0;padding:12px;width:min(420px,calc(100vw - 24px));background:var(--plot-bg);color:var(--text);border:1px solid var(--hairline);border-radius:var(--radius);box-shadow:var(--glass-shadow);}.scope-picker input,.scope-picker select {width:100%;}.scope-picker select {margin-top:8px;font-size:0.8rem;}
  label {display:flex;align-items:center;gap:4px;font-size:0.75rem;min-width:0;}.run select {max-width:220px;font-size:0.75rem;padding:4px 6px;}.split-toggle {margin-left:auto;}
  .selection-bar {display:flex;align-items:flex-start;gap:5px 12px;flex-wrap:wrap;max-height:86px;overflow:auto;min-width:0;}
  .sample-bar,.selection-actions {display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-width:0;}
  .selection-bar .chip {padding:2px 7px;font-size:0.75rem;}
  .sample-chip {max-width:240px;}.sample-chip span {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.sample-chip i {width:9px;height:9px;border-radius:50%;flex:none;}.sample-chip small {color:var(--text-muted);}
  .section-label {font-size:0.67rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);}
  .tree,.plots,.details {flex:1;padding:8px;min-height:0;min-width:0;gap:8px;}
  .group-option {font-size:0.68rem;align-items:flex-start;}
  .tree>input {width:100%;min-width:0;font-size:0.78rem;}
  .plots {overflow:auto;background:var(--glass);}.details {overflow-y:auto;overflow-x:hidden;overflow-wrap:anywhere;}
  .notice {margin:0;padding:4px 12px;}.view-switch {display:flex;align-items:center;gap:4px;flex:none;min-width:0;flex-wrap:wrap;}.view-switch button {border:0;background:transparent;gap:5px;font-size:0.78rem;padding:5px 8px;}.view-switch svg {width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.4;flex:none;}.view-switch button[aria-selected='true'] {background:var(--accent-soft);color:var(--accent);}
  :global(.review .wrap) {flex-wrap:wrap;}
  :global(.review .plots label) {display:inline-flex;align-items:center;gap:4px;font-size:0.8rem;min-width:0;max-width:100%;}
  :global(.review .plots select) {max-width:175px;min-width:0;}
  :global(.review .plots p) {margin:0;}
</style>
