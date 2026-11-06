<script lang="ts">
  import { untrack } from 'svelte';
  import GeochemPanel from './GeochemPanel.svelte';
  import { catalogue } from '../../lib/geochem';
  import { MINERALS, MAX_PANELS, applyPreset, gridColumns, loadBoards, saveBoards, mineralFor, preset, panel, type Mineral, type Panel } from '../../lib/geochem-board';
  import type { ReviewSpot } from '../../lib/review-data';
  let { rows, catalogueRows = rows, selected, material, onselect }: {
    rows: ReviewSpot[]; catalogueRows?: ReviewSpot[]; selected: string | null; material?: string; onselect: (s: ReviewSpot) => void;
  } = $props();
  let mineral = $state<Mineral>('Zircon');
  let boards = $state(loadBoards());
  let panels = $state<Panel[]>([]);
  let width = $state(0), host = $state<HTMLDivElement>();
  let maximized = $state<string | null>(null);
  let presetPopup = $state<HTMLDivElement>();
  const quantities = $derived(catalogue(catalogueRows));
  const columns = $derived(gridColumns(width));
  const measured = $derived(width > 0);
  const shown = $derived(maximized ? panels.filter(p=>p.id===maximized) : panels);
  $effect(() => { const m = mineralFor(material); untrack(()=>switchMineral(m)); });
  $effect(() => {
    if (!host) return;
    const ro = new ResizeObserver(([e]) => { width=Math.floor(e.contentRect.width); });
    ro.observe(host); return ()=>ro.disconnect();
  });
  $effect(() => {
    const cols = columns;
    if (!measured) return;
    untrack(()=>{if (!boards[mineral] && !maximized) panels=preset(mineral).slice(0,cols===3?6:4);});
  });
  function switchMineral(m: Mineral) {
    mineral=m; maximized=null;
    panels=boards[m] ?? preset(m).slice(0,gridColumns(width)===3?6:4);
  }
  function update(next: Panel[]) {
    panels=next; boards={...boards,[mineral]:next}; saveBoards(boards);
  }
  function replace(p: Panel) { update(panels.map(current=>current.id===p.id?p:current)); }
  function remove(id: string) { update(panels.filter(p=>p.id!==id)); if(maximized===id) maximized=null; }
</script>
<svelte:window onkeydown={e=>{if(e.key==='Escape'&&!e.defaultPrevented) maximized=null;}} />
<div class="board-toolbar row">
  <span class="section-label">Geochemistry</span>
  <label>Mineral <select aria-label="Preset mineral" value={mineral} onchange={e=>switchMineral(e.currentTarget.value as Mineral)}>{#each MINERALS as m}<option>{m}</option>{/each}</select></label>
  <button class="chip" popovertarget="review-geochem-presets" aria-label="Presets">Presets</button>
  <div class="preset-menu" popover="auto" id="review-geochem-presets" bind:this={presetPopup}>
    <h3>Replace board with a mineral preset</h3>
    {#each MINERALS as m}<button class="chip" aria-label={`Apply ${m} preset`} aria-pressed={mineral===m} onclick={()=>{mineral=m;update(applyPreset(m));maximized=null;presetPopup?.hidePopover();}}>{m}</button>{/each}
    <p class="small muted">Choose a preset to replace the current panels. You can change each axis afterwards.</p>
  </div>
  <span class="small muted">{panels.length}/{MAX_PANELS} panels · read-only</span>
</div>
<div class="board" bind:this={host} data-testid="geochem-board" data-columns={columns} data-mineral={mineral} data-panel-count={panels.length}>
  {#if !rows.length}<p class="muted empty" role="status">No samples shown</p>{/if}
  <div class="grid" class:maximized={!!maximized} style:--columns={columns}>
    {#each shown as p (p.id)}<GeochemPanel panel={p} {rows} {quantities} {selected} {onselect} maximized={maximized===p.id} onchange={replace} onmaximize={()=>maximized=maximized===p.id?null:p.id} onremove={()=>remove(p.id)} />{/each}
    {#if !maximized && panels.length<MAX_PANELS}<button class="add" onclick={()=>update([...panels,panel('Th','U')])}><span aria-hidden="true">＋</span> Add panel</button>{/if}
  </div>
</div>
<style>
  .board-toolbar {gap:8px;flex:none;min-width:0;} .section-label {font-size:0.68rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);} label {font-size:0.75rem;display:flex;align-items:center;gap:4px;}select {font-size:0.75rem;padding:3px 6px;max-width:120px;}
  .preset-menu {position:fixed;inset:150px auto auto 30%;margin:0;max-width:min(360px,calc(100vw - 24px));padding:12px;background:var(--plot-bg);color:var(--text);border:1px solid var(--hairline);border-radius:var(--radius-sm);box-shadow:var(--glass-shadow);}.preset-menu h3 {font-size:0.8rem;margin-bottom:8px;}.preset-menu .chip {margin:3px;}.preset-menu p {font-size:0.7rem;margin-top:8px;}
  .board {flex:1;min-height:0;min-width:0;overflow-y:auto;overflow-x:hidden;container-type:size;}
  .grid {display:grid;grid-template-columns:repeat(var(--columns),minmax(0,1fr));grid-auto-rows:max(275px,calc((100cqh - 8px) / 2));gap:8px;min-width:0;}
  .grid.maximized {grid-template-columns:minmax(0,1fr);grid-auto-rows:max(300px,100cqh);}
  .add {min-height:100px;display:flex;align-items:center;justify-content:center;gap:8px;color:var(--text-muted);border:1px dashed var(--hairline);border-radius:var(--radius-sm);background:var(--glass);cursor:pointer;font-size:0.82rem;}.add:hover {color:var(--accent);border-color:var(--accent);}.add span {font-size:1.3rem;}.empty {padding:12px;font-size:0.85rem;}
</style>
