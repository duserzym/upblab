<script lang="ts">
  import Plot from './Plot.svelte';
  import { ratioMarks } from './plot-data';
  import { clusterBounds, contains, type Bounds } from './plot-viewport';
  import { ageTicks, concordia, curve, EARTH_AGE, visibleConcordiaAges, type ConcordiaMode } from '../../lib/concordia';
  import type { ReviewSpot } from '../../lib/review-data';
  let { rows, selected, mode = $bindable(), hidden, onhide, onrestore, onselect }: {
    rows: ReviewSpot[];
    selected: string | null;
    mode: ConcordiaMode;
    hidden: Set<string>;
    onhide: (keys: string[]) => void;
    onrestore: () => void;
    onselect: (s: ReviewSpot) => void;
  } = $props();
  let viewport = $state<Bounds | null>(null);
  let boxed = $state.raw(new Set<string>());
  let ellipses = $state(true);
  const allMarks = $derived(ratioMarks(rows, mode));
  const shown = $derived(allMarks.filter(m => !hidden.has(m.spot.key)));
  const points = $derived(shown.map(m => m.point!));
  const cluster = $derived(clusterBounds(points));
  const outside = $derived(viewport ? points.filter(p => !contains(viewport!, p)).length : 0);
  const boxedKeys = $derived(shown.filter(m => boxed.has(m.spot.key)).map(m => m.spot.key));
  const marks = $derived(ellipses && !boxedKeys.length ? shown : shown.map(m => ({
    ...m, polygon: ellipses ? m.polygon : undefined, boxed: boxed.has(m.spot.key),
  })));
  // The inverse U/Pb coordinate is unbounded as age approaches zero.
  const [youngX] = concordia(100e6, 'tw');
  const [, oldY] = concordia(EARTH_AGE, 'tw');
  const earthView: Bounds = { x: [0, youngX * 1.08], y: [0, oldY * 1.1] };
  const [oldWetherillX, oldWetherillY] = concordia(EARTH_AGE);
  const wetherillView: Bounds = { x: [0, oldWetherillX * 1.08], y: [0, oldWetherillY * 1.08] };

  function guidesForBounds(bounds: Bounds) {
    const ages = visibleConcordiaAges(bounds.x, bounds.y, mode);
    if (!ages) return [];
    const ticks = ageTicks(ages).filter(t => t < EARTH_AGE);
    // Prioritize this label over nearby round ages when both fit the viewport.
    if (ages[1] === EARTH_AGE) ticks.unshift(EARTH_AGE);
    return [{ path: curve(ages, mode) }, ...ticks.map(t => ({
      path: [], point: concordia(t, mode), label: `${Number((t / 1e6).toPrecision(8))} Ma`,
    }))];
  }

  function setMode(next: ConcordiaMode) {
    mode = next;
    viewport = null;
    boxed = new Set();
  }
  function selectBox(bounds: Bounds) {
    boxed = new Set(shown.filter(m => contains(bounds, m.point!)).map(m => m.spot.key));
  }
  function hideBox() {
    onhide(boxedKeys);
    boxed = new Set();
  }
</script>
<div class="row wrap controls">
  <label>Diagram <select aria-label="Concordia diagram" value={mode} onchange={e => setMode(e.currentTarget.value as ConcordiaMode)}><option value="wetherill">Wetherill</option><option value="tw">Tera-Wasserburg</option></select></label>
  {#if mode === 'tw'}
    <button class="chip" title="Fit the reference curve from 100 to 4540 Ma" onclick={() => viewport = earthView}>Earth-age view</button>
  {/if}
  <button class="chip" disabled={!cluster} title="Fit the middle of the distribution, leaving extremes outside the view" onclick={() => viewport = cluster}>Fit cluster</button>
  <button class="chip" aria-pressed={ellipses} title="Show or hide the 2σ uncertainty ellipses" onclick={() => ellipses = !ellipses}>2σ ellipses</button>
  <button class="chip" disabled={!selected || !shown.some(m => m.spot.key === selected)} onclick={() => selected && onhide([selected])}>Hide selected</button>
  {#if boxedKeys.length}
    <button class="chip" onclick={hideBox}>Hide boxed ({boxedKeys.length})</button>
    <button class="chip" onclick={() => boxed = new Set()}>Clear box</button>
  {/if}
  {#if hidden.size}<button class="chip" onclick={onrestore}>Show hidden ({hidden.size})</button>{/if}
  <span class="faint small" aria-live="polite">{shown.length}/{allMarks.length} plotted{outside ? ` · ${outside} outside view` : ''}</span>
</div>
<Plot {marks} {guidesForBounds} emptyBounds={mode === 'tw' ? earthView : wetherillView} {selected} {onselect} bind:viewport onbox={selectBox} ontoggle={spot => onhide([spot.key])}
  xLabel={mode === 'tw' ? '238U/206Pb' : '207Pb/235U'} yLabel={mode === 'tw' ? '207Pb/206Pb' : '206Pb/238U'} />
<style>
  .controls {gap:5px;align-items:center;}
  .controls .chip {font-size:0.74rem;padding:3px 7px;}
</style>
