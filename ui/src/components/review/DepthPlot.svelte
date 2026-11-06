<script lang="ts">
  import Plot from './Plot.svelte';
  import { color } from './plot-data';
  import { review } from '../../lib/review.svelte';
  import { number, profileColumns } from '../../lib/review-data';
  import type { Point } from '../../lib/concordia';
  let chosen = $state<string[]>(['206Pb/238U_age', '207Pb/206Pb_age']);
  let x = $state('signal_relative_time');
  const profile = $derived(review.depth);
  const columns = $derived(profile ? profileColumns(profile) : []);
  const axes = $derived(profile ? profile.columns.filter(k => /time|depth/i.test(k) && profile.data[k]?.some(v => number(v) !== null)) : []);
  const xKey = $derived(axes.includes(x) ? x : axes.includes('signal_relative_time') ? 'signal_relative_time' : axes.includes('Time') ? 'Time' : axes[0]);
  const visible = $derived(chosen.filter(c => columns.includes(c)));
  const marks = $derived(profile && review.selected && xKey ? visible.map(c => ({
    spot: { ...review.selected!, sampleName: c },
    path: profile.data[xKey].map((v, i) => { const a = number(v), b = number(profile.data[c]?.[i]); return a === null || b === null ? null : [a, b] as Point; })
  })) : []);
  const bands = $derived(profile && xKey ? visible.flatMap(c => {
    const uncertainty = ['_2e', '_2s', '_95CI'].map(s => c + s).find(k => profile.data[k]);
    if (!uncertainty)
      return [];
    const bound = (sign: number) => profile.data[xKey].map((v, i) => { const a = number(v), b = number(profile.data[c]?.[i]), e = number(profile.data[uncertainty]?.[i]); return a === null || b === null || e === null ? null : [a, b + sign * e] as Point; });
    return [{ upper: bound(1), lower: bound(-1), color: color(c) }];
  }) : []);
  function toggle(column: string, checked: boolean) { chosen = checked ? [...chosen, column] : chosen.filter(c => c !== column); }
</script>
{#if review.depthState==='loading'}<p class="muted">Loading stored depth profile…</p>
{:else if review.depthState==='error'}<p class="error">Could not read the depth profile: {review.depthError}</p>
{:else if !profile?.columns.length}<p class="muted">This run has no stored depth profile for the selected spot.</p>
{:else if !xKey}<p class="muted">This profile has no stored time or depth axis.</p>
{:else}
  <div class="row wrap"><label>Against <select aria-label="Depth profile axis" value={xKey} onchange={e => x = e.currentTarget.value}>{#each axes as c}<option>{c}</option>{/each}</select></label>
    <details><summary>Columns ({visible.length})</summary><div class="column-list">{#each columns as c}<label><input type="checkbox" checked={chosen.includes(c)} onchange={e=>toggle(c,e.currentTarget.checked)} /> {c}</label>{/each}</div></details>
  </div>
  <p class="faint small">Stored sweep values and uncertainty bands (2se where available). Select columns with compatible units.</p>
  <Plot {marks} {bands} selected={null} onselect={()=>{}} xLabel={/time/i.test(xKey)?`${xKey} (s)`:xKey} yLabel="Stored values" />
{/if}
<style>
  details {position:relative;min-width:0;} summary {cursor:pointer;}
  .column-list {position:absolute;z-index:2;top:100%;right:0;width:min(330px,55vw);max-height:240px;overflow:auto;background:var(--plot-bg);border:1px solid var(--hairline);padding:8px;}
  .column-list label {display:flex;align-items:center;gap:4px;overflow-wrap:anywhere;font-size:0.8rem;}
</style>
