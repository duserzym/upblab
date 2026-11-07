<script lang="ts">
  import Plot from './Plot.svelte';
  import { ratioMarks } from './plot-data';
  import { clusterBounds, contains, type Bounds } from './plot-viewport';
  import { ageRange, ageTicks, concordia, curve, EARTH_AGE, twAgeAtX, type ConcordiaMode } from '../../lib/concordia';
  import type { ReviewSpot } from '../../lib/review-data';
  let { rows, selected, hidden, onhide, onrestore, onselect }: {
    rows: ReviewSpot[];
    selected: string | null;
    hidden: Set<string>;
    onhide: (keys: string[]) => void;
    onrestore: () => void;
    onselect: (s: ReviewSpot) => void;
  } = $props();
  let mode = $state<ConcordiaMode>('wetherill');
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
  // The inverse U/Pb axis tends to infinity as age approaches zero.
  const overviewYoungAge = 100e6;
  const youngestCurveAge = 1e5;
  const [youngX] = concordia(overviewYoungAge, 'tw');
  const [, oldY] = concordia(EARTH_AGE, 'tw');
  const earthView: Bounds = { x: [0, youngX * 1.08], y: [0, oldY * 1.1] };
  const twCurve = curve([youngestCurveAge, EARTH_AGE], 'tw');
  const twOverviewCurve = curve([overviewYoungAge, EARTH_AGE], 'tw');
  const range = $derived(ageRange(points, mode));
  const guides = $derived.by(() => {
    let path = mode === 'tw' ? twCurve : curve(range, mode);
    let ticks = ageTicks(range);
    if (mode === 'tw') {
      if (viewport) {
        const [left, right] = viewport.x;
        const start = right > 0 ? Math.max(youngestCurveAge, twAgeAtX(right)) : EARTH_AGE;
        const end = left > 0 ? Math.min(EARTH_AGE, twAgeAtX(left)) : EARTH_AGE;
        ticks = start < end ? ageTicks([start, end]) : [];
      } else {
        ticks = [...new Set([...ticks, ...ageTicks([overviewYoungAge, EARTH_AGE])])];
        if (points.length === 0) path = twOverviewCurve;
      }
      // Draw the Earth-age label first so nearby round ages cannot crowd it out.
      ticks = [EARTH_AGE, ...ticks.filter(t => t < EARTH_AGE)];
    }
    return [{ path }, ...ticks.map(t => ({ path: [], point: concordia(t, mode), label: `${t / 1e6} Ma` }))];
  });

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
<Plot {marks} {guides} {selected} {onselect} bind:viewport onbox={selectBox} ontoggle={spot => onhide([spot.key])}
  xLabel={mode === 'tw' ? '238U/206Pb' : '207Pb/235U'} yLabel={mode === 'tw' ? '207Pb/206Pb' : '206Pb/238U'} />
<style>
  .controls {gap:5px;align-items:center;}
  .controls .chip {font-size:0.74rem;padding:3px 7px;}
</style>
