<script lang="ts">
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import { getContext, type Snippet } from 'svelte';
  import Plot from './Plot.svelte';
  import { PLOT_VISIBILITY, plotVisibility, type PlotVisibility } from './plot-visibility';
  import { ratioMarks } from './plot-data';
  import { clusterBounds, contains, type Bounds } from './plot-viewport';
  import { concordiaLabels, concordia, EARTH_AGE, visibleConcordiaAges, type ConcordiaMode } from '../../lib/concordia';
  import { sampleCurve } from '../../lib/concordia-geometry';
  import type { Point } from '../../lib/concordia';
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
  const visibility = getContext<PlotVisibility | undefined>(PLOT_VISIBILITY);
  let viewport = $state<Bounds | null>(null);
  let boxed = $state.raw(new Set<string>());
  let more = $state(false);
  let moreControls = $state<HTMLDivElement>();
  let ellipses = $state(true);
  // Keep each diagram's reactive dependencies stable across mode switches.
  // A stale hidden diagram is recomputed only when it is shown again.
  const wetherillMarks = $derived(ratioMarks(rows, 'wetherill'));
  const twMarks = $derived(ratioMarks(rows, 'tw'));
  const allMarks = $derived(mode === 'tw' ? twMarks : wetherillMarks);
  const shown = $derived(plotVisibility({ marks: allMarks, hidden: new Set([...hidden, ...(visibility?.hidden() ?? [])]) }).marks);
  const points = $derived(shown.map(m => m.point!));
  const cluster = $derived(clusterBounds(points));
  const outside = $derived(viewport ? points.filter(p => !contains(viewport!, p)).length : 0);
  const boxedKeys = $derived(shown.filter(m => boxed.has(m.spot.key)).map(m => m.spot.key));
  const marks = $derived(ellipses && !boxedKeys.length ? allMarks : allMarks.map(m => ({
    spot: m.spot, point: m.point, ellipse: ellipses ? m.ellipse : undefined,
    get polygon() { return ellipses ? m.polygon : undefined; }, boxed: boxed.has(m.spot.key),
  })));
  // The inverse U/Pb coordinate is unbounded as age approaches zero.
  const [youngX] = concordia(100e6, 'tw');
  const [, oldY] = concordia(EARTH_AGE, 'tw');
  const earthView: Bounds = { x: [0, youngX * 1.08], y: [0, oldY * 1.1] };
  const [oldWetherillX, oldWetherillY] = concordia(EARTH_AGE);
  const wetherillView: Bounds = { x: [0, oldWetherillX * 1.08], y: [0, oldWetherillY * 1.08] };

  function guidesForBounds(bounds: Bounds, toScreen: (p: Point) => Point) {
    const ages = visibleConcordiaAges(bounds.x, bounds.y, mode);
    if (!ages) return [];
    return [{ path: sampleCurve(t => concordia(t, mode), ages[0], ages[1], toScreen) },
      ...concordiaLabels(bounds.x, bounds.y, mode).map(({ age, label }) => ({ path: [], point: concordia(age, mode), label }))];
  }

  function setMode(next: ConcordiaMode) {
    if (next === mode) return;
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
  function escape(event: KeyboardEvent) {
    if (more && moreControls?.getClientRects().length && event.key === 'Escape' && !event.defaultPrevented && !document.querySelector(':popover-open')) { more = false; event.preventDefault(); }
  }
</script>
<svelte:window onkeydown={escape} />
{#snippet controls(secondaryNavigation: Snippet)}
<div class="row controls">
  <span>Diagram</span><SegmentedControl label="Concordia diagram" size="small" wrap options={[{value:'wetherill',label:'Wetherill'},{value:'tw',label:'Tera-W.',ariaLabel:'Tera-Wasserburg'}]} value={mode} onchange={value => setMode(value as ConcordiaMode)} />
  <button class="btn plot-control more" aria-label="More plot controls" aria-expanded={more} aria-controls="plot-more-controls" onclick={() => more = !more}>More…</button>
  <div id="plot-more-controls" bind:this={moreControls} class="secondary" class:expanded={more}>
  {#if mode === 'tw'}
    <button class="btn plot-control" title="Fit the reference curve from 100 to 4540 Ma" onclick={() => viewport = earthView}>Earth-age view</button>
  {/if}
  <button class="btn plot-control" disabled={!cluster} title="Fit the middle of the distribution, leaving extremes outside the view" onclick={() => viewport = cluster}>Fit cluster</button>
  <button class="btn plot-control" aria-pressed={ellipses} title="Show or hide the 2σ uncertainty ellipses" onclick={() => ellipses = !ellipses}>2σ ellipses</button>
  <IconButton size="small" icon="hide" label="Hide selected" disabled={!selected || !shown.some(m => m.spot.key === selected)} onclick={() => selected && onhide([selected])} />
  {#if boxedKeys.length}
    <button class="btn plot-control" onclick={hideBox}>Hide boxed ({boxedKeys.length})</button>
    <IconButton size="small" icon="close" label="Clear box" onclick={() => boxed = new Set()} />
  {/if}
  {#if hidden.size}<button class="btn plot-control" onclick={onrestore}>Show hidden ({hidden.size})</button>{/if}
  <span class="faint small" aria-live="polite">{shown.length}/{allMarks.length} plotted{outside ? ` · ${outside} outside view` : ''}</span>
  <div class="secondary-navigation">{@render secondaryNavigation()}</div>
  </div>
</div>
{/snippet}
<Plot {controls} {marks} {hidden} {guidesForBounds} emptyBounds={mode === 'tw' ? earthView : wetherillView} {selected} {onselect} bind:viewport onbox={selectBox} ontoggle={spot => onhide([spot.key])}
  xLabel={mode === 'tw' ? '238U/206Pb' : '207Pb/235U'} yLabel={mode === 'tw' ? '207Pb/206Pb' : '206Pb/238U'} />
<style>
  .plot-control { border-radius: var(--radius-sm); font-size: 12px; padding: 3px 7px; transition: none; }
  .plot-control:active:not(:disabled) { transform: none; background-image: linear-gradient(var(--press), var(--press)); }
  .plot-control[aria-pressed=true] { color: var(--accent); background: var(--accent-soft); border-color: var(--accent); }
  .controls {gap:5px;align-items:center;flex:none;min-width:0;}
  .secondary {display:contents;}
  .more,.secondary-navigation {display:none;}
  @container (max-width:760px) {
    .more {display:inline-flex;}
    .secondary {display:none;}
    .secondary.expanded {display:flex;flex-wrap:wrap;align-items:center;gap:5px;flex:1 0 100%;padding:6px;border:1px solid var(--hairline);border-radius:var(--radius-sm);background:var(--accent-soft);}
    .secondary-navigation {display:contents;}
  }
</style>
