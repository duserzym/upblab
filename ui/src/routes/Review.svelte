<script lang="ts">
  import { untrack, tick } from 'svelte';
  import { review } from '../lib/review.svelte';
  import { groupSpots, dateLabel, type ReviewSpot } from '../lib/review-data';
  import { identity } from '../lib/identity.svelte';
  import { selection } from '../lib/selection.svelte';
  import { settings } from '../lib/settings.svelte';
  import { color } from '../components/review/plot-data';
  import { sampleSelection } from '../lib/geochem-board';
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
  let scopePopup = $state<HTMLDivElement>();
  let samplesShown = $state<string[] | null>(null);
  let treeClosed = $state(false), detailsClosed = $state(false);
  const scopeRows = $derived(review.rows.filter(r=>review.references || !r.isReference));
  const samples = $derived([...new Set(scopeRows.map(r=>r.sampleName))].map(name=>({name,count:scopeRows.filter(r=>r.sampleName===name).length})));
  const material = $derived(review.sessions.find(s=>s.id===(review.scope?.kind==='session'?review.scope.id:review.rows.find(r=>r.sessionId)?.sessionId))?.material);
  const scopeName = $derived(review.scope?.kind==='session'?review.sessions.find(s=>s.id===review.scope?.id)?.session_key:review.mounts.find(m=>m.id===review.scope?.id)?.label);
  $effect(()=>{void scopeValue; untrack(()=>{samplesShown=null;filter='';});});
  $effect(()=>{
    const key=review.selectedKey;
    void review.scrollVersion;
    untrack(()=>{const spot=review.rows.find(r=>r.key===key);if(spot&&samplesShown&&!samplesShown.includes(spot.sampleName)) samplesShown=[...samplesShown,spot.sampleName];});
  });
  function sampleAction(action: 'all'|'clear'|'click', name='', modifier=false) {
    samplesShown=sampleSelection(samplesShown,samples.map(s=>s.name),action,name,modifier);
    review.hoveredKey=null;
  }
  $effect(()=>{void plot;void active;untrack(()=>review.hoveredKey=null);});
  let seenEvent: unknown = null;
  let loadedContext = '';
  const plotted = $derived(scopeRows.filter(r=>samplesShown===null||samplesShown.includes(r.sampleName)));
  const groups = $derived(groupSpots(plotted, filter, review.references));
  const visible = $derived(groups.flatMap(s => s.grains.flatMap(g => g.spots)));
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
      <button class="chip" aria-label="Reference materials" aria-pressed={review.references} onclick={()=>review.references=!review.references}>Reference materials</button>
      {#if wide}<label class="split-toggle"><input type="checkbox" checked={settings.reviewSplit} onchange={e=>void settings.update({reviewSplit:e.currentTarget.checked})} /> Side by side</label>{/if}
    </div>
    {#if review.state==='ready'}<div class="sample-bar" aria-label="Shown samples"><span class="section-label">Samples</span><button class="chip" aria-pressed={samplesShown===null} onclick={()=>sampleAction('all')}>All</button><button class="chip" aria-pressed={samplesShown?.length===0} onclick={()=>sampleAction('clear')}>Clear</button>
      {#each samples as sample}<button class="chip sample-chip" aria-label={`Sample ${sample.name}`} aria-pressed={samplesShown===null||samplesShown.includes(sample.name)} title="Click to show only this sample; Cmd/Ctrl-click to toggle" onclick={e=>sampleAction('click',sample.name,e.metaKey||e.ctrlKey)}><i style:background={color(sample.name)}></i><span>{sample.name}</span><small>{sample.count}</small></button>{/each}
    </div>{/if}
  </div>
  {#if review.state==='signed-out'}
    <div class="panel stack"><p class="muted">{review.error||'Sign in to read stored results from laicpmsdb.'}</p><button class="btn" onclick={()=>identity.dialog=true}>Sign in</button></div>
  {:else if review.state==='idle'}<p class="panel muted">No laicpmsdb server configured. Set a server in Settings to read results.</p>
  {:else if review.state==='loading'}<p class="panel muted" role="status">Loading results from laicpmsdb…</p>
  {:else if review.state==='error'}<div class="panel stack"><p class="error">Could not read results: {review.error}</p><button class="btn" onclick={()=>void review.load()}>Retry</button></div>
  {:else}
    {#if review.error}<p class="error small notice" role="status">{review.error}</p>{/if}
    <div class="workspace" class:tree-closed={treeClosed} class:details-closed={detailsClosed}>
      <aside class="tree stack" aria-label="Samples and grains">
        <div class="column-heading"><span class="section-label">Spots</span><button class="rail-toggle" aria-label={treeClosed?'Expand spot list':'Collapse spot list'} aria-expanded={!treeClosed} onclick={()=>treeClosed=!treeClosed}>{treeClosed?'›':'‹'}</button></div>
        {#if !treeClosed}<input type="search" aria-label="Filter spots" placeholder="Filter spots…" bind:value={filter} />
        <div class="tree-scroll" role="tree" aria-label="Result spots" tabindex="0" onkeydown={keydown} bind:this={tree}>
          {#each groups as sample (sample.key)}
            <div class="sample"><h3>{sample.name}{sample.reference?' · reference materials':''}</h3>
              {#each sample.grains as grain (grain.key)}
                <button class="grain" onclick={()=>void review.focusGrain(grain.spots)}>{grain.name}</button>
                {#each grain.spots as spot (spot.key)}
                  <button class="spot" role="treeitem" aria-selected={review.selectedKey===spot.key} tabindex={review.selectedKey===spot.key?0:-1} data-spot-key={spot.key} class:hovered={review.hoveredKey===spot.key} onclick={()=>review.select(spot)} ondblclick={()=>void review.focus(spot,true)}>
                    <span>{spot.label}</span><span class="badge" style:color={badgeColor(spot)} title="Preferred date ± 2σ (Ma)">{dateLabel(spot)}</span>
                  </button>
                {/each}
              {/each}
            </div>
          {/each}
          {#if !visible.length}<p class="small faint">{samplesShown?.length===0?'No samples shown':'No spots match this view.'}</p>{/if}
        </div>{/if}
      </aside>
      <div class="plots stack">
        <div class="view-switch" role="tablist" aria-label="Review plots">{#each ['Concordia','Geochemistry','Depth profile'] as tab}<button role="tab" class="chip" aria-selected={plot===tab} onclick={()=>plot=tab}><svg viewBox="0 0 20 20" aria-hidden="true"><path d={tab==='Concordia'?'M3 17V3m0 14h14M5 15c2-7 5-9 11-11':tab==='Geochemistry'?'M2 2h6v6H2zm10 0h6v6h-6zM2 12h6v6H2zm10 0h6v6h-6z':'M3 3v14h14M5 12l3-6 3 8 5-5'} /></svg><span>{tab}</span></button>{/each}</div>
        {#if plot==='Concordia'}{#if samplesShown?.length===0}<p class="muted small">No samples shown</p>{/if}<ConcordiaPlot rows={plotted} selected={review.selectedKey} onselect={selectSpot} />
        {:else if plot==='Geochemistry'}<GeochemistryPlot {material} catalogueRows={scopeRows} rows={plotted} selected={review.selectedKey} onselect={selectSpot} />
        {:else if samplesShown?.length===0}<p class="muted small">No samples shown</p>
        {:else if review.selected && (samplesShown===null||samplesShown.includes(review.selected.sampleName))}<DepthPlot />
        {:else}<p class="muted small">Select a spot from the shown samples to view its depth profile.</p>{/if}
      </div>
      <aside class="details stack" aria-label="Spot details" data-testid="review-details"><div class="column-heading"><span class="section-label">Spot details</span><button class="rail-toggle" aria-label={detailsClosed?'Expand details':'Collapse details'} aria-expanded={!detailsClosed} onclick={()=>detailsClosed=!detailsClosed}>{detailsClosed?'‹':'›'}</button></div>{#if !detailsClosed}<SpotDetails />{/if}</aside>
    </div>
  {/if}
</section>
<style>
  .review {overflow:hidden;}
  h1 {font-size:1rem;margin:0;} h3 {font-size:0.8rem;margin:8px 0 4px;overflow-wrap:anywhere;}
  .toolbar {display:flex;flex-direction:column;gap:8px;padding:8px 12px;border-radius:0;flex:none;min-width:0;border:0;box-shadow:none;}
  .scope-row {display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap;}
  .scope-button {min-width:0;max-width:420px;gap:8px;font-size:0.8rem;padding:4px 8px;}.scope-button>span:first-child {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.scope-button small {font-size:0.7rem;white-space:nowrap;}
  .scope-picker {position:fixed;top:100px;left:12px;margin:0;padding:12px;width:min(420px,calc(100vw - 24px));background:var(--plot-bg);color:var(--text);border:1px solid var(--hairline);border-radius:var(--radius);box-shadow:var(--glass-shadow);}.scope-picker input,.scope-picker select {width:100%;}.scope-picker select {margin-top:8px;font-size:0.8rem;}
  label {display:flex;align-items:center;gap:4px;font-size:0.75rem;min-width:0;}.run select {max-width:220px;font-size:0.75rem;padding:4px 6px;}.split-toggle {margin-left:auto;}
  .sample-bar {display:flex;align-items:center;gap:5px;flex-wrap:wrap;max-height:32px;overflow:auto;min-width:0;}.sample-bar .chip {padding:2px 7px;font-size:0.75rem;}.sample-chip {max-width:240px;}.sample-chip span {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.sample-chip i {width:9px;height:9px;border-radius:50%;flex:none;}.sample-chip small {color:var(--text-muted);}
  .section-label {font-size:0.67rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);}
  .workspace {--tree-width:220px;--details-width:260px;flex:1;display:grid;grid-template-columns:var(--tree-width) minmax(0,1fr) var(--details-width);min-height:0;min-width:0;}
  .tree-closed {--tree-width:32px;}.details-closed {--details-width:32px;}
  .tree,.plots,.details {padding:8px;min-height:0;min-width:0;gap:8px;}
  .tree-scroll {min-height:0;overflow-y:auto;overflow-x:hidden;}.tree>input {width:100%;min-width:0;font-size:0.78rem;}
  .plots {overflow:hidden;background:var(--glass);}.details {overflow-y:auto;overflow-x:hidden;overflow-wrap:anywhere;}
  .column-heading {display:flex;align-items:center;justify-content:space-between;gap:4px;flex:none;}.rail-toggle {background:transparent;border:0;color:var(--text-muted);font-size:1.2rem;cursor:pointer;padding:0 3px;}
  .tree-closed .tree,.details-closed .details {padding:8px 4px;}.tree-closed .tree .section-label,.details-closed .details .section-label {display:none;}
  .grain {display:block;max-width:100%;overflow-wrap:anywhere;text-align:left;color:var(--text-muted);background:transparent;border:0;padding:4px;cursor:pointer;font-size:0.75rem;}
  .spot {display:flex;align-items:center;justify-content:space-between;gap:4px;width:100%;padding:6px 4px;background:transparent;border:1px solid transparent;border-radius:var(--radius-sm);cursor:pointer;text-align:left;font-size:0.75rem;}
  .spot>span:first-child {min-width:0;overflow-wrap:anywhere;}.badge {white-space:nowrap;font-size:0.65rem;padding:2px 4px;flex:none;}
  .spot[aria-selected='true'] {background:var(--accent-soft);border-color:var(--accent);}.spot:hover,.spot.hovered {background:var(--row-hover);}.spot.hovered {outline:1px solid var(--accent);outline-offset:-1px;}
  .notice {margin:0;padding:4px 12px;}.view-switch {display:flex;align-items:center;gap:4px;flex:none;min-width:0;}.view-switch button {border:0;background:transparent;gap:5px;font-size:0.78rem;padding:5px 8px;}.view-switch svg {width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.4;flex:none;}.view-switch button[aria-selected='true'] {background:var(--accent-soft);color:var(--accent);}
  .compact .workspace {--tree-width:150px;grid-template-columns:var(--tree-width) minmax(0,1fr);grid-template-rows:minmax(250px,1fr) minmax(90px,0.35fr);}.compact .tree {grid-row:1 / 3;}.compact .details {grid-column:2;}.compact .tree-closed {--tree-width:32px;}.compact .details-closed {grid-template-rows:minmax(0,1fr) 32px;}.compact .scope-button {max-width:220px;}.compact .run select {max-width:145px;}.compact .scope-row>.chip {font-size:0.7rem;padding:3px 6px;}.compact .scope-button {display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 4px;}.compact .scope-button small {display:block;grid-row:2;grid-column:1;text-align:left;}.compact .scope-button>span:first-child {text-align:left;}.compact .scope-button>span:last-child {grid-row:1 / 3;grid-column:2;}.compact .view-switch button {font-size:0.7rem;padding:4px;}.compact .scope-row h1 {display:none;}
  @media(max-width:1100px){.workspace {--tree-width:180px;--details-width:230px;}.tree-closed {--tree-width:32px;}.details-closed {--details-width:32px;}.scope-button {max-width:350px;}}
  :global(.review .wrap) {flex-wrap:wrap;}
  :global(.review .plots label) {display:inline-flex;align-items:center;gap:4px;font-size:0.8rem;min-width:0;max-width:100%;}
  :global(.review .plots select) {max-width:175px;min-width:0;}
  :global(.review .plots p) {margin:0;}
</style>
