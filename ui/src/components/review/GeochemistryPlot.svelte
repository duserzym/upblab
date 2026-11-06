<script lang="ts">
  import Plot from './Plot.svelte';
  import type { Mark } from './plot-data';
  import { CI, CI_LEGEND, type Point } from '../../lib/concordia';
  import { number, numericColumns, type ReviewSpot } from '../../lib/review-data';
  let { rows, selected, onselect }: {
    rows: ReviewSpot[];
    selected: string | null;
    onselect: (s: ReviewSpot) => void;
  } = $props();
  let ree = $state(false), x = $state('U'), y = $state('Th/U'), logX = $state(false), logY = $state(false);
  const columns = $derived(numericColumns(rows));
  const elements = Object.keys(CI) as (keyof typeof CI)[];
  const marks = $derived(rows.flatMap<Mark>(spot => {
    if (ree)
      return [{ spot, path: elements.map((e, i) => { const v = number(spot.values[e]); return v !== null && v > 0 ? [i, v / CI[e]] as Point : null; }) }];
    const a = number(spot.values[x]), b = number(spot.values[y]);
    return a === null || b === null ? [] : [{ spot, point: [a, b] as Point }];
  }));
</script>
<div class="row wrap">
  <label><input type="checkbox" bind:checked={ree} /> REE pattern</label>
  {#if !ree}
    <label>X <select aria-label="Geochemistry X" bind:value={x}>{#if !columns.includes(x)}<option>{x}</option>{/if}{#each columns as c}<option>{c}</option>{/each}</select></label>
    <label>Y <select aria-label="Geochemistry Y" bind:value={y}>{#if !columns.includes(y)}<option>{y}</option>{/if}{#each columns as c}<option>{c}</option>{/each}</select></label>
    <label><input type="checkbox" bind:checked={logX} /> Log X</label><label><input type="checkbox" bind:checked={logY} /> Log Y</label>
  {/if}
</div>
<Plot {marks} {selected} {onselect} xLabel={ree?'Element':x} yLabel={ree?'Stored ppm / CI':y} logX={!ree&&logX} logY={ree||logY} xTicks={ree?elements:[]} />
{#if ree}<p class="faint small">{CI_LEGEND}</p>{/if}
