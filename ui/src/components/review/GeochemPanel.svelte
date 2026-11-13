<script lang="ts">
  import Plot from './Plot.svelte';
  import { axisLabel, normalized, REE, quantityValue, resolveQuantity, type AvailableQuantity } from '../../lib/geochem';
  import { CI_LEGEND, type Point } from '../../lib/concordia';
  import type { Panel } from '../../lib/geochem-board';
  import type { ReviewSpot } from '../../lib/review-data';
  import type { Mark } from './plot-data';
  let { panel, rows, quantities, selected, maximized, onchange, onmaximize, onremove, onselect, onchoose, pickerAxis }: {
    onchoose: (axis: 'x' | 'y', anchor: HTMLElement) => void; pickerAxis?: 'x' | 'y';
    panel: Panel; rows: ReviewSpot[]; quantities: AvailableQuantity[]; selected: string | null; maximized: boolean;
    onchange: (panel: Panel) => void; onmaximize: () => void; onremove: () => void; onselect: (s: ReviewSpot) => void;
  } = $props();
  const x = $derived(resolveQuantity(panel.x, quantities)), y = $derived(resolveQuantity(panel.y, quantities));
  const title = $derived(panel.type === 'ree' ? 'REE pattern' : `${y.label} vs ${x.label}`);
  const missing = $derived(panel.type === 'biplot' ? [x,y].filter(q=>q.group==='Thermometers'&&!q.available) : []);
  const marks = $derived(rows.flatMap<Mark>(spot => {
    if (panel.type === 'ree') {
      const path = REE.map((e,i) => { const v = normalized(spot,e); return v !== null && v > 0 ? [i,v] as Point : null; });
      return path.some(Boolean) ? [{spot,path}] : [];
    }
    const a = quantityValue(x,spot), b = quantityValue(y,spot);
    return a === null || b === null || panel.logX && a <= 0 || panel.logY && b <= 0 ? [] : [{spot,point:[a,b]}];
  }));
</script>
<article class="card" data-testid="geochem-panel" data-panel-id={panel.id} data-panel-type={panel.type} data-maximized={maximized}>
  <header><h3 title={title}>{title}</h3><button class="icon" aria-label={maximized?'Restore panel':'Maximize panel'} onclick={onmaximize}><svg viewBox="0 0 20 20" aria-hidden="true"><path d={maximized?'M7 3v4H3m14 6h-4v4M7 7 3 3m10 10 4 4':'M3 8V3h5m4 0h5v5M3 12v5h5m4 0h5v-5'} /></svg></button><button class="icon" aria-label="Remove panel" onclick={onremove}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button></header>
  <div class="axes">
    {#each ['x','y'] as a}
      {@const axis = a as 'x'|'y'}
      <div class="axis"><button class="axis-button chip" aria-label={`Choose ${a.toUpperCase()} axis`} title={axisLabel(a==='x'?x:y)} aria-expanded={pickerAxis===axis} aria-controls="geochem-quantity-picker" onclick={e=>onchoose(axis,e.currentTarget)}>{a.toUpperCase()} <span>{panel.type==='ree'?(a==='x'?'Element':'Stored ppm / CI'):(a==='x'?axisLabel(x):axisLabel(y))}</span></button><button class="chip log" aria-label={`Log ${a.toUpperCase()} axis`} aria-pressed={panel.type==='ree'?a==='y':a==='x'?panel.logX:panel.logY} disabled={panel.type==='ree'} onclick={()=>onchange({...panel,[a==='x'?'logX':'logY']:a==='x'?!panel.logX:!panel.logY})}>log</button></div>
    {/each}
  </div>
  {#if missing.length}<div class="empty muted" role="status">{#each missing as q}<p>{q.label} is not stored for this run</p>{/each}</div>
  {:else}<Plot {marks} {selected} {onselect} legend={false} xLabel={panel.type==='ree'?'Element':axisLabel(x)} yLabel={panel.type==='ree'?'Stored ppm / CI':axisLabel(y)} logX={panel.type!=='ree'&&panel.logX} logY={panel.type==='ree'||panel.logY} xTicks={panel.type==='ree'?REE:[]} />{/if}
  {#if panel.type==='ree'}<p class="small muted citation">{CI_LEGEND}</p>{/if}
</article>
<style>
  .card {display:flex;flex-direction:column;min-width:0;min-height:0;gap:6px;padding:8px;background:var(--plot-bg);border-radius:var(--radius-sm);overflow:hidden;}
  header {display:flex;align-items:center;gap:4px;min-width:0;} h3 {font-size:0.78rem;flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
  .icon {display:grid;place-items:center;flex:none;width:24px;height:24px;padding:3px;border:0;border-radius:var(--radius-sm);background:transparent;cursor:pointer;}.icon:hover {background:var(--accent-soft);}
  svg {width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;}
  .axes {display:flex;flex-direction:column;gap:4px;min-width:0;} .axis {display:flex;min-width:0;gap:4px;}.axis-button {min-width:0;flex:1;justify-content:flex-start;border:0;background:var(--glass);padding:2px 6px;font-size:0.7rem;}.axis-button span {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.log {padding:1px 5px;font-size:0.65rem;}.log:disabled {opacity:0.65;}
  .empty {display:flex;flex:1;align-items:center;justify-content:center;text-align:center;padding:12px;font-size:0.82rem;}.empty p {margin:0;}.citation {margin:0;font-size:0.65rem;}
</style>
