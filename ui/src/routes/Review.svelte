<script lang="ts">
  import { untrack, tick } from 'svelte';
  import { review } from '../lib/review.svelte';
  import { groupSpots, dateLabel, type ReviewSpot } from '../lib/review-data';
  import { identity } from '../lib/identity.svelte';
  import { selection } from '../lib/selection.svelte';
  import { settings } from '../lib/settings.svelte';
  import ConcordiaPlot from '../components/review/ConcordiaPlot.svelte';
  import GeochemistryPlot from '../components/review/GeochemistryPlot.svelte';
  import DepthPlot from '../components/review/DepthPlot.svelte';
  import SpotDetails from '../components/review/SpotDetails.svelte';
  let { active, split = false, wide = false }: {
    active: boolean;
    split?: boolean;
    wide?: boolean;
  } = $props();
  let filter = $state(''), scopeFilter = $state(''), plot = $state('Concordia');
  let tree = $state<HTMLDivElement>();
  let seenEvent: unknown = null;
  let loadedContext = '';
  const groups = $derived(groupSpots(review.rows, filter, review.references));
  const visible = $derived(groups.flatMap(s => s.grains.flatMap(g => g.spots)));
  const plotted = $derived(review.rows.filter(r => review.references || !r.isReference));
  const scopeValue = $derived(review.scope ? `${review.scope.kind}:${review.scope.id}` : '');
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
    if (event.via !== 'shell') filter = '';
    untrack(() => void review.fromImages(event));
  });
  $effect(() => {
    void review.scrollVersion;
    const key = review.selectedKey;
    if (!active || !tree || !key)
      return;
    void tick().then(() => tree?.querySelector<HTMLElement>(`[data-spot-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' }));
  });
  function choose(value: string) {
    const [kind, ...rest] = value.split(':');
    if (kind === 'session' || kind === 'mount') void review.open({ kind, id: rest.join(':') });
  }
  function selectSpot(spot: ReviewSpot) {
    if (!visible.some(row => row.key === spot.key)) filter = '';
    review.select(spot);
  }
  function keydown(e: KeyboardEvent) {
    if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key))
      return;
    e.preventDefault();
    if (e.key === 'Enter') {
      if (review.selected)
        void review.focus(review.selected, true);
      return;
    }
    const i = visible.findIndex(r => r.key === review.selectedKey);
    const spot = visible[Math.max(0, Math.min(visible.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (spot) {
      review.select(spot);
      void tick().then(() => tree?.querySelector<HTMLElement>(`[data-spot-key="${CSS.escape(spot.key)}"]`)?.focus());
    }
  }
  const badgeColor = (s: ReviewSpot) => !s.date ? 'var(--text-faint)' : s.flags.length || s.date.passes === false ? 'var(--warning)' : s.date.passes === true ? 'var(--ok)' : 'var(--text-muted)';
</script>
<section class="view review" class:hidden={!active} class:compact={split} aria-label="Review results" data-testid="review-view">
  <div class="toolbar glass">
    <h1>Review</h1>
    <input type="search" aria-label="Search scopes" placeholder="Find session or mount…" bind:value={scopeFilter} />
    <label class="scope">Scope <select aria-label="Review scope" value={scopeValue} onchange={e=>choose(e.currentTarget.value)}>
      <option value="" disabled>Choose a session or mount</option>
      <optgroup label="Sessions">{#each review.sessions.filter(s=>s.session_key.toLowerCase().includes(scopeFilter.toLowerCase())||scopeValue===`session:${s.id}`) as s}<option value="session:{s.id}">{s.session_key}</option>{/each}</optgroup>
      <optgroup label="Mounts">{#each review.mounts.filter(m=>m.label.toLowerCase().includes(scopeFilter.toLowerCase())||scopeValue===`mount:${m.id}`) as m}<option value="mount:{m.id}">{m.label}</option>{/each}</optgroup>
    </select></label>
    {#if review.scope?.kind==='session'}
      <label>Run <select aria-label="Review run" value={review.scope.run} onchange={e=>review.scope?.kind==='session'&&void review.open({...review.scope,run:e.currentTarget.value})}>
        <option value="preferred">{noPreferred&&newest?'Newest run, not preferred':'Preferred run'}</option>
        {#each complete as r}<option value={r.id}>{r.id.slice(0,8)} · {r.is_preferred_for_session?'preferred':noPreferred&&r.id===newest?.id?'newest run, not preferred':r.started_at.slice(0,10)}</option>{/each}
      </select></label>
    {/if}
    <label><input type="checkbox" bind:checked={review.references} /> Reference materials</label>
    {#if wide}<label><input type="checkbox" checked={settings.reviewSplit} onchange={e=>void settings.update({reviewSplit:e.currentTarget.checked})} /> Side by side</label>{/if}
  </div>
  {#if review.state==='signed-out'}
    <div class="panel stack"><p class="muted">{review.error||'Sign in to read stored results from laicpmsdb.'}</p><button class="btn" onclick={()=>identity.dialog=true}>Sign in</button></div>
  {:else if review.state==='idle'}<p class="panel muted">No laicpmsdb server configured. Set a server in Settings to read results.</p>
  {:else if review.state==='loading'}<p class="panel muted" role="status">Loading results from laicpmsdb…</p>
  {:else if review.state==='error'}<div class="panel stack"><p class="error">Could not read results: {review.error}</p><button class="btn" onclick={()=>void review.load()}>Retry</button></div>
  {:else}
    {#if review.error}<p class="error small notice" role="status">{review.error}</p>{/if}
    <div class="workspace">
      <aside class="tree stack" aria-label="Samples and grains">
        <input type="search" aria-label="Filter spots" placeholder="Filter spots…" bind:value={filter} />
        <div class="tree-scroll" role="tree" aria-label="Result spots" tabindex="0" onkeydown={keydown} bind:this={tree}>
          {#each groups as sample (sample.key)}
            <div class="sample"><h3>{sample.name}{sample.reference?' · reference materials':''}</h3>
              {#each sample.grains as grain (grain.key)}
                <button class="grain" onclick={()=>void review.focusGrain(grain.spots)}>{grain.name}</button>
                {#each grain.spots as spot (spot.key)}
                  <button class="spot" role="treeitem" aria-selected={review.selectedKey===spot.key} tabindex={review.selectedKey===spot.key?0:-1} data-spot-key={spot.key} onclick={()=>review.select(spot)} ondblclick={()=>void review.focus(spot,true)}>
                    <span>{spot.label}</span><span class="badge" style:color={badgeColor(spot)} title="Preferred date ± 2σ (Ma)">{dateLabel(spot)}</span>
                  </button>
                {/each}
              {/each}
            </div>
          {/each}
          {#if !visible.length}<p class="small faint">No spots match this view.</p>{/if}
        </div>
      </aside>
      <div class="plots stack">
        <div class="row wrap" role="tablist" aria-label="Review plots">{#each ['Concordia','Geochemistry','Depth profile'] as tab}<button role="tab" class="chip" aria-selected={plot===tab} onclick={()=>plot=tab}>{tab}</button>{/each}</div>
        {#if plot==='Concordia'}<ConcordiaPlot rows={plotted} selected={review.selectedKey} onselect={selectSpot} />
        {:else if plot==='Geochemistry'}<GeochemistryPlot rows={plotted} selected={review.selectedKey} onselect={selectSpot} />
        {:else}<DepthPlot />{/if}
      </div>
      <aside class="details stack" aria-label="Spot details" data-testid="review-details"><SpotDetails /></aside>
    </div>
  {/if}
</section>
<style>
  .review {overflow:hidden;}
  h1 {font-size:1.1rem;margin:0;} h3 {font-size:0.85rem;margin:8px 0 4px;overflow-wrap:anywhere;}
  .toolbar {display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px;border-radius:0;flex:none;}
  .toolbar>input {width:160px;} label {display:flex;align-items:center;gap:4px;font-size:0.8rem;min-width:0;}
  select {max-width:240px;min-width:0;} .scope {flex:1;min-width:180px;} .scope select {width:100%;max-width:300px;}
  .workspace {flex:1;display:grid;grid-template-columns:250px minmax(0,1fr) 280px;min-height:0;min-width:0;}
  .tree,.plots,.details {padding:12px;min-height:0;min-width:0;border-right:1px solid var(--hairline);}
  .tree-scroll {min-height:0;overflow-y:auto;overflow-x:hidden;}
  .tree>input {width:100%;min-width:0;}
  .plots,.details {overflow-y:auto;overflow-x:hidden;background:var(--plot-bg);}
  .details {border:0;overflow-wrap:anywhere;}
  .grain {display:block;max-width:100%;overflow-wrap:anywhere;text-align:left;color:var(--text-muted);background:transparent;border:0;padding:4px;cursor:pointer;font-size:0.8rem;}
  .spot {display:flex;align-items:center;justify-content:space-between;gap:4px;width:100%;padding:6px 4px;background:transparent;border:1px solid transparent;border-radius:6px;cursor:pointer;text-align:left;font-size:0.8rem;}
  .spot>span:first-child {min-width:0;overflow-wrap:anywhere;} .badge {white-space:nowrap;font-size:0.72rem;padding:2px 4px;flex:none;}
  .spot[aria-selected='true'] {background:var(--accent-soft);border-color:var(--accent);} .spot:hover {background:var(--row-hover);}
  .notice {margin:0;padding:4px 12px;}
  .compact .workspace {grid-template-columns:200px minmax(0,1fr);grid-template-rows:minmax(260px,1fr) minmax(140px,0.7fr);}
  .compact .tree {grid-row:1 / 3;} .compact .details {grid-column:2;border-top:1px solid var(--hairline);}
  .compact .toolbar>input {width:130px;} .compact select {max-width:220px;}
  @media(max-width:1100px){.workspace {grid-template-columns:210px minmax(0,1fr) 240px;}}
  :global(.review .wrap) {flex-wrap:wrap;}
  :global(.review .plots label) {display:inline-flex;align-items:center;gap:4px;font-size:0.8rem;min-width:0;max-width:100%;}
  :global(.review .plots select) {max-width:175px;min-width:0;}
  :global(.review .plots p) {margin:0;}
  :global(.review .plots .chip[aria-selected='true']) {background:var(--accent-soft);border-color:var(--accent);}
</style>
