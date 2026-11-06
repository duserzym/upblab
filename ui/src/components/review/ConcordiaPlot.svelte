<script lang="ts">
  import Plot from './Plot.svelte';
  import { ratioMarks } from './plot-data';
  import { ageRange, ageTicks, concordia, curve, type ConcordiaMode } from '../../lib/concordia';
  import type { ReviewSpot } from '../../lib/review-data';
  let { rows, selected, onselect }: {
    rows: ReviewSpot[];
    selected: string | null;
    onselect: (s: ReviewSpot) => void;
  } = $props();
  let mode = $state<ConcordiaMode>('wetherill');
  const marks = $derived(ratioMarks(rows, mode));
  const range = $derived(ageRange(marks.map(m => m.point!), mode));
  const guides = $derived([{ path: curve(range, mode) }, ...ageTicks(range).map(t => ({ path: [], point: concordia(t, mode), label: `${t / 1e6} Ma` }))]);
</script>
<div class="row wrap"><label>Diagram <select aria-label="Concordia diagram" bind:value={mode}><option value="wetherill">Wetherill</option><option value="tw">Tera-Wasserburg</option></select></label><span class="faint small">Stored ratios · 2σ ellipses</span></div>
<Plot {marks} {guides} {selected} {onselect} xLabel={mode==='tw'?'238U/206Pb':'207Pb/235U'} yLabel={mode==='tw'?'207Pb/206Pb':'206Pb/238U'} />
