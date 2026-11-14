<script lang="ts">
  import { containedPopover } from '../lib/contained-popover';
  import type { Snippet } from 'svelte';
  import { settings } from '../lib/settings.svelte';
  import { defaultRatio, dock, edgeAt, gap, geometry, panes, presetLayout, readLayout, resize, type Preset, type Edge, type Layout, type Pane, type Rect } from '../lib/review-layout';

  let { active, ready, split, imagesOnly, spots, plots, details, images, headerActions, detailsRail }: {
    active: boolean; ready: boolean; split: boolean; imagesOnly: boolean;
    spots: Snippet; plots: Snippet; details: Snippet; images: Snippet<[boolean, string]>;
    headerActions?: Snippet<[Pane]>; detailsRail?: Snippet<[() => void]>;
  } = $props();

  const title = { spots: 'Spots', plots: 'Age & plots', details: 'Spot metadata', images: 'SEM images' };
  const edges: Edge[] = ['left', 'right', 'top', 'bottom'];
  let maximised = $state<Pane | null>(null);
  let imagesMenu = $state(false);
  let surface = $state<HTMLDivElement>();
  let width = $state(0), height = $state(0);
  let draft = $state.raw<Layout>();
  let drag = $state<{ pane: Pane; pointer: number; x: number; y: number; moving: boolean; target?: Pane; edge?: Edge }>();
  let sizing = $state<{ pointer: number; offset: number }>();
  const layout = $derived(draft ?? readLayout(split ? settings.reviewDockSplit : settings.reviewDockSolo, split, settings.reviewDataWidth));
  const { tiles, dividers, rails } = $derived(geometry(layout, width, height));
  const empty = { x: 0, y: 0, width: 0, height: 0 };

  function closeImagesMenu(restore = false) {
    imagesMenu = false;
    if (restore) surface?.querySelector<HTMLButtonElement>('[aria-label="Move SEM images"]')?.focus();
  }
  function menuKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (imagesMenu) {
      event.preventDefault();
      closeImagesMenu(true);
      return;
    }
    // Native popovers consume Escape themselves; in-tile drawers have window
    // handlers too. Wait for a task, not a microtask: microtasks run between
    // listeners, before a drawer registered later has handled the event.
    if (document.querySelector(':popover-open')) return;
    setTimeout(() => { if (!event.defaultPrevented) maximised = null; }, 0);
  }
  function maximise(pane: Pane) {
    imagesMenu = false;
    surface?.querySelectorAll<HTMLElement>(':popover-open').forEach(menu => menu.hidePopover());
    maximised = maximised === pane ? null : pane;
  }
  function headerDoubleClick(event: MouseEvent, pane: Pane) {
    if (!(event.target as Element).closest('button')) maximise(pane);
  }
  function menuOutside(event: PointerEvent) {
    const target = event.target as Element;
    if (!target.closest('#dock-images, [aria-label="Move SEM images"]')) closeImagesMenu();
  }
  $effect(() => { if (!active || !split || imagesOnly || !ready) imagesMenu = false; });
  $effect(() => { if (!split && maximised === 'images') maximised = null; });

  export function applyPreset(name: Preset) {
    maximised = null;
    imagesMenu = false;
    draft = undefined;
    const json = JSON.stringify(presetLayout(name, split));
    void settings.update(split ? { reviewDockSplit: json, reviewDataWidth: 50 } : { reviewDockSolo: json });
  }

  function save(next: Layout) {
    const json = JSON.stringify(next);
    void settings.update(split ? { reviewDockSplit: json } : { reviewDockSolo: json });
  }

  function move(pane: Pane, target: Pane, edge: Edge) {
    save(dock(layout, pane, target, edge));
  }

  function tileStyle(rect: Rect) {
    return `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`;
  }

  function grab(e: PointerEvent, pane: Pane) {
    if (e.button !== 0 || drag || sizing || maximised) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { pane, pointer: e.pointerId, x: e.clientX, y: e.clientY, moving: false };
  }

  function slide(e: PointerEvent) {
    if (!drag || drag.pointer !== e.pointerId || !surface) return;
    if (!drag.moving && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    const bounds = surface.getBoundingClientRect();
    const x = e.clientX - bounds.left, y = e.clientY - bounds.top;
    drag.moving = true;
    drag.x = e.clientX; drag.y = e.clientY;
    drag.target = panes.find(pane => {
      const r = tiles[pane];
      return pane !== drag?.pane && r && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
    });
    drag.edge = drag.target ? edgeAt(tiles[drag.target]!, x, y) : undefined;
  }

  function release(e: PointerEvent) {
    if (!drag || drag.pointer !== e.pointerId) return;
    if (e.type === 'pointerup' && drag.target && drag.edge) move(drag.pane, drag.target, drag.edge);
    drag = undefined;
  }

  type Divider = (typeof dividers)[number];
  const coordinate = (e: PointerEvent, d: Divider) => d.axis === 'x' ? e.clientX : e.clientY;
  const length = (d: Divider) => Math.max(1, (d.axis === 'x' ? d.area.width : d.area.height) - gap);
  function grabDivider(e: PointerEvent, divider: Divider) {
    if (e.button !== 0 || drag || sizing) return;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    el.setPointerCapture(e.pointerId);
    sizing = { pointer: e.pointerId, offset: coordinate(e, divider) - (divider.axis === 'x' ? rect.left : rect.top) };
  }

  function slideDivider(e: PointerEvent, divider: Divider) {
    if (!sizing || sizing.pointer !== e.pointerId || !surface) return;
    const bounds = surface.getBoundingClientRect();
    const origin = (divider.axis === 'x' ? bounds.left : bounds.top) + divider.area[divider.axis];
    draft = resize(layout, divider.path, (coordinate(e, divider) - origin - sizing.offset) / length(divider), { width, height });
  }

  function releaseDivider(e: PointerEvent) {
    if (!sizing || sizing.pointer !== e.pointerId) return;
    if (e.type === 'pointerup' && draft) save(draft);
    draft = undefined;
    sizing = undefined;
  }

  function dividerKey(e: KeyboardEvent, divider: Divider) {
    const [back, forward] = divider.axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (![back, forward, 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const delta = e.shiftKey ? 40 : 12;
    const ratio = e.key === 'Home' ? 0 : e.key === 'End' ? 1 :
      (divider.position + (e.key === back ? -delta : delta)) / length(divider);
    save(resize(layout, divider.path, ratio, { width, height }));
  }
</script>

{#snippet destinations(pane: Pane)}
  <span class="muted small">Dock {title[pane]} next to</span>
  {#each panes.filter(target => target !== pane && tiles[target]) as target}
    <div class="destination"><span>{title[target]}</span>
      {#each edges as edge, i}
        <button class="btn" aria-label={`Dock ${edge} of ${title[target]}`} title={edge}
          onclick={e => { e.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover(); imagesMenu = false; move(pane, target, edge); }}>
          {['←', '→', '↑', '↓'][i]}
        </button>
      {/each}
    </div>
  {/each}
{/snippet}
<svelte:window onblur={() => closeImagesMenu()} onkeydown={menuKey} onpointerdown={menuOutside} />

<div class="dock" class:manipulating={drag?.moving || sizing} bind:this={surface} bind:clientWidth={width} bind:clientHeight={height}
  hidden={!imagesOnly && (!active || !ready)}>
  {#each panes as pane (pane)}
    {@const rect = maximised === pane ? { x: 0, y: 0, width, height } : tiles[pane] ?? empty}
    {@const full = pane === 'images' && imagesOnly}
    {@const rail = !full && !maximised && rails[pane]}
    {@const shown = full || (!imagesOnly && active && ready && !!tiles[pane] && (!maximised || maximised === pane))}
    <section data-collapsed={!!rail} data-review-panel={pane} class="tile" class:full class:rail={!!rail} class:rail-x={rail === 'x'} class:drag-source={drag?.moving && drag.pane === pane} hidden={!shown} aria-label={title[pane]}
      style={full ? '' : tileStyle(rect)}>
      {#if rail}
        {#if pane === 'details' && rail === 'y' && detailsRail}
          {@render detailsRail(() => maximise(pane))}
        {:else}
          <button class="rail-button" aria-label={`Expand ${title[pane]}`} title={`Expand ${title[pane]}`} onclick={() => maximise(pane)}>{title[pane]}</button>
        {/if}
      {/if}
      <!-- svelte-ignore a11y_no_static_element_interactions (Header double-click complements the maximise button.) -->
      <header hidden={full || !!rail} ondblclick={event => headerDoubleClick(event, pane)}>
        <div class="heading"><button class="grip" title="Drag to another panel edge to move" aria-label={`Drag ${title[pane]}`}
          onpointerdown={e => grab(e, pane)} onpointermove={slide} onpointerup={release}
          onpointercancel={release} onlostpointercapture={release}><span aria-hidden="true">⠿</span></button><span class="tile-title" title={title[pane]}>{title[pane]}</span></div>
        <div class="header-actions">{#if headerActions}{@render headerActions(pane)}{/if}<button class="dock-menu maximise" aria-label={`${maximised === pane ? 'Restore' : 'Maximise'} ${title[pane]}`} aria-pressed={maximised === pane} title={maximised === pane ? 'Restore panel' : 'Maximise panel'} onclick={() => maximise(pane)}>{maximised === pane ? 'Restore' : '⛶'}</button>
        {#if pane === 'images'}
          <button class="dock-menu" aria-label="Move SEM images" title="Move panel" aria-expanded={imagesMenu} aria-controls="dock-images" onclick={() => imagesMenu = !imagesMenu}>⋯</button>
        {:else}
          <button id={`dock-trigger-${pane}`} class="dock-menu" aria-label={`Move ${title[pane]}`} title="Move panel" popovertarget={`dock-${pane}`}>⋯</button>
          <div id={`dock-${pane}`} class="move-menu" popover="auto"
            use:containedPopover={{anchor: () => surface?.querySelector<HTMLElement>(`#dock-trigger-${pane}`) ?? undefined, w: 310, h: 180}}>
            {@render destinations(pane)}
          </div>
        {/if}
        </div>
      </header>
      {#if pane === 'images' && imagesMenu && !full}
        <!-- The Images body is native, so its own menu must also take layout space. -->
        <div id="dock-images" class="move-menu image-menu" role="group" aria-label="Move SEM images">
          {@render destinations(pane)}
        </div>
      {/if}
      <div class="body" hidden={!!rail}>
        {#if pane === 'images'}
          <!-- Review is the only active module owner here. Sessions and People
               already receive active=false from App while this dock is active. -->
          {@render images(shown && !rail && !drag?.moving, full ? 'full' : tileStyle(rect))}
        {:else if pane === 'spots'}{@render spots()}
        {:else if pane === 'plots'}{@render plots()}
        {:else}{@render details()}{/if}
      </div>
      {#if drag?.target === pane && drag.edge}<div class="drop-edge {drag.edge}"><span>Dock {drag.edge} of {title[pane]}</span></div>{/if}
    </section>
  {/each}
  {#if active && ready && !imagesOnly && !maximised}
    {#each dividers as divider (divider.path.join('.'))}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (Focusable splitter.) -->
      <div class="divider" class:vertical={divider.axis === 'x'} style={tileStyle(divider.rect)} role="separator" tabindex="0"
        aria-label="Resize panels" aria-orientation={divider.axis === 'x' ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(100 * divider.position / length(divider))} title="Drag or use arrow keys to resize; double-click to reset"
        onpointerdown={e => grabDivider(e, divider)} onpointermove={e => slideDivider(e, divider)}
        onpointerup={releaseDivider} onpointercancel={releaseDivider} onlostpointercapture={releaseDivider}
        ondblclick={() => save(resize(layout, divider.path, defaultRatio(layout, divider.path, split, settings.reviewDataWidth)))}
        onkeydown={e => dividerKey(e, divider)}></div>
    {/each}
  {/if}
</div>
{#if drag?.moving}<div class="drag-ghost" style:left={`clamp(8px, ${drag.x + 12}px, calc(100vw - 180px))`} style:top={`${drag.y + 12}px`} aria-hidden="true">⠿ {title[drag.pane]}</div>{/if}

<style>
  .dock { position:relative; flex:1; min-height:0; min-width:0; overflow:hidden; }
  .tile { container-type:inline-size; position:absolute; display:flex; flex-direction:column; min-width:0; min-height:0; overflow:hidden; border-radius:var(--radius-sm); border:1px solid var(--hairline); background:var(--glass); }
  .tile[hidden], .tile header[hidden], .body[hidden], .dock[hidden] { display:none; }
  .tile.full { inset:0; border:0; border-radius:0; }
  .tile header { display:flex; align-items:center; justify-content:space-between; height:29px; padding:0 4px; flex:none; border-bottom:1px solid var(--hairline); background:var(--accent-soft); }
  .heading,.header-actions {display:flex;align-items:center;min-width:0;gap:2px;}
  .heading {flex:1;}
  .header-actions {flex:none;}
  .tile-title {font-size:0.73rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .rail-button {flex:1;min-width:0;padding:0;border:0;background:var(--accent-soft);color:var(--text);font-size:0.73rem;cursor:pointer;}
  .rail-x .rail-button {writing-mode:vertical-rl;transform:rotate(180deg);}
  .grip,.dock-menu { border:0; background:transparent; color:var(--text); padding:2px 5px; font-size:0.73rem; white-space:nowrap; border-radius:var(--radius-sm); }
  .grip { cursor:grab; touch-action:none; text-overflow:ellipsis; overflow:hidden; }
  .grip span { color:var(--text-muted); padding-right:3px; }
  .grip:active { cursor:grabbing; }
  .dock-menu { cursor:pointer; font-weight:700; font-size:0.9rem; }
  .grip:hover,.dock-menu:hover { background:var(--row-hover); }
  .body { flex:1; min-height:0; min-width:0; display:flex; flex-direction:column; overflow:hidden; container-type:inline-size; }
  .divider { position:absolute; cursor:row-resize; touch-action:none; border-radius:4px; }
  .divider.vertical { cursor:col-resize; }
  .divider::after { content:''; position:absolute; width:3px;height:28px;left:calc(50% - 1.5px);top:calc(50% - 14px); background:transparent; border-radius:3px; }
  .divider:not(.vertical)::after { width:28px;height:3px;left:calc(50% - 14px);top:calc(50% - 1.5px); }
  .divider:hover::after,.divider:focus-visible::after,.divider:active::after { background:var(--accent); }
  .manipulating { user-select:none; -webkit-user-select:none; }
  .manipulating :global(iframe) { pointer-events:none; }
  .drag-source { opacity:0.55; }
  .drop-edge { position:absolute; inset:0; pointer-events:none; background:color-mix(in srgb,var(--accent) 30%,transparent); border:2px solid var(--accent); z-index:1;display:grid;place-items:center;text-align:center;padding:6px; }
  .drop-edge span,.drag-ghost {background:var(--plot-bg);color:var(--text);border:1px solid var(--accent);border-radius:999px;padding:4px 9px;font-size:0.75rem;box-shadow:var(--glass-shadow);}
  .drag-ghost {max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;position:fixed;pointer-events:none;z-index:10;}
  .drop-edge.left { right:50%; } .drop-edge.right { left:50%; }
  .drop-edge.top { bottom:50%; } .drop-edge.bottom { top:50%; }
  .move-menu { color:var(--text); background:var(--plot-bg); padding:12px; border:1px solid var(--hairline); border-radius:var(--radius); box-shadow:var(--glass-shadow); }
  .image-menu {flex:none;max-height:min(180px,calc(100% - 60px));overflow:auto;min-width:0;border-radius:0;}
  .destination { display:grid; grid-template-columns:minmax(0,1fr) repeat(4,minmax(0,30px)); align-items:center; gap:4px; margin-top:6px; font-size:0.8rem; }
  .destination span {overflow-wrap:anywhere;min-width:0;}
  .destination .btn { padding:3px;min-width:0; }
</style>
