<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { clampHeight, rowStep, type HomeSection } from '../../lib/home-sections';
  import { settings } from '../../lib/settings.svelte';

  let { section, label, testId, grouped = false, children }: {
    section: HomeSection; label: string; testId: string; grouped?: boolean; children: Snippet;
  } = $props();
  let grid: HTMLDivElement;
  let minimum = $state(0), maximum = $state(0), current = $state(0), step = $state(120);
  const height = $derived(settings.homeSections[section]?.height);
  const limit = $derived(height == null ? undefined : clampHeight(height, minimum, maximum));
  let drag: { pointer: number; y: number; height: number } | undefined;

  function measure() {
    // Hidden Home/collapsed sections retain their last useful measurements.
    if (!grid || !grid.getBoundingClientRect().height) return;
    const card = grid.querySelector<HTMLElement>('article[data-testid]');
    const gap = card?.parentElement ? parseFloat(getComputedStyle(card.parentElement).rowGap) : 0;
    step = rowStep(card?.getBoundingClientRect().height ?? 0, gap);
    minimum = card ? Math.ceil(card.getBoundingClientRect().bottom - grid.getBoundingClientRect().top + grid.scrollTop + 2) : 0;
    maximum = Math.max(minimum, grid.scrollHeight);
    current = Math.round(grid.getBoundingClientRect().height);
  }

  onMount(() => {
    const observed = new Set<Element>();
    const resize = new ResizeObserver(measure);
    resize.observe(grid);
    const observeCards = () => {
      const cards = new Set(grid.querySelectorAll('article[data-testid]'));
      for (const old of observed) if (!cards.has(old)) { resize.unobserve(old); observed.delete(old); }
      for (const card of cards) if (!observed.has(card)) { resize.observe(card); observed.add(card); }
      measure();
    };
    const mutation = new MutationObserver(observeCards);
    mutation.observe(grid, { childList: true, subtree: true });
    observeCards();
    return () => {
      resize.disconnect();
      mutation.disconnect();
      void settings.flushHomeSections();
    };
  });

  function change(value: number, debounce = false) {
    void settings.updateHomeSection(section, { height: Math.round(clampHeight(value, minimum, maximum)) }, debounce);
  }
  function reset() {
    void settings.updateHomeSection(section, { height: null });
  }
  function pointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(event.pointerId);
    measure();
    drag = { pointer: event.pointerId, y: event.clientY, height: current };
  }
  function pointerMove(event: PointerEvent) {
    if (drag?.pointer === event.pointerId) change(drag.height + event.clientY - drag.y, true);
  }
  function pointerEnd(event: PointerEvent) {
    if (drag?.pointer !== event.pointerId) return;
    drag = undefined;
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    void settings.flushHomeSections();
  }
  function keyDown(event: KeyboardEvent) {
    measure();
    let value: number;
    switch (event.key) {
      case 'ArrowUp': value = current - step; break;
      case 'ArrowDown': value = current + step; break;
      case 'PageUp': value = current - step * 3; break;
      case 'PageDown': value = current + step * 3; break;
      case 'Home': value = minimum; break;
      case 'End': value = maximum; break;
      case 'Enter': event.preventDefault(); reset(); return;
      default: return;
    }
    event.preventDefault();
    change(value);
  }
</script>

<div bind:this={grid} id="home-{section}-grid" data-testid={testId} data-section={section}
  role="group" aria-label="{section === 'sessions' ? 'Session' : 'Mount'} cards"
  class:tile-grid={!grouped} class:stack={grouped} class="section-grid"
  style:max-height={limit === undefined ? undefined : `${limit}px`} style:--row-min={`${minimum}px`}>
  {@render children()}
</div>
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (Focusable splitter with pointer and keyboard resizing, as in ReviewDock.) -->
<div class="divider" role="separator" aria-orientation="horizontal" aria-label="Resize {label}"
  aria-controls="home-{section}-grid" aria-valuenow={current} aria-valuemin={minimum} aria-valuemax={maximum}
  aria-valuetext={`${current} px`} tabindex="0"
  title="Drag to resize; arrow keys move one row; Enter or double-click resets"
  onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerEnd}
  onpointercancel={pointerEnd} onlostpointercapture={pointerEnd} onkeydown={keyDown} ondblclick={reset}></div>

<style>
  .section-grid { max-height: max(20rem, var(--row-min)); overflow-y: auto; padding: 2px; min-width: 0; gap: var(--space-2); }
  .tile-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(22.3rem, 100%), 1fr)); }
  .section-grid > :global(.panel) { margin-top: 0; }
  .divider { position: relative; flex: none; height: 10px; margin-top: calc(-1 * var(--space-2)); cursor: row-resize; touch-action: none; user-select: none; border-radius: var(--radius-sm); }
  .divider::after { content: ''; position: absolute; width: 28px; height: 3px; left: calc(50% - 14px); top: calc(50% - 1.5px); background: var(--text-faint); opacity: 0.6; border-radius: 3px; }
  .divider:hover::after, .divider:focus-visible::after, .divider:active::after { background: var(--accent); opacity: 1; }
  .divider:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
