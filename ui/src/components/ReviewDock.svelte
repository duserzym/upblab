<script lang="ts">
  import type { Snippet } from 'svelte';
  import { settings } from '../lib/settings.svelte';
  import { dock, edgeAt, gap, geometry, panes, readLayout, resize, type Edge, type Layout, type Pane, type Rect } from '../lib/review-layout';

  let { active, ready, split, imagesOnly, spots, plots, details, images }: {
    active: boolean; ready: boolean; split: boolean; imagesOnly: boolean;
    spots: Snippet; plots: Snippet; details: Snippet; images: Snippet<[boolean, string]>;
  } = $props();

  const title = { spots: 'Spots', plots: 'Age & plots', details: 'Spot metadata', images: 'SEM images' };
  const edges: Edge[] = ['left', 'right', 'top', 'bottom'];
  let surface = $state<HTMLDivElement>();
  let width = $state(0), height = $state(0);
  let draft = $state.raw<Layout>();
  let drag = $state<{ pane: Pane; pointer: number; x: number; y: number; moving: boolean; target?: Pane; edge?: Edge }>();
  let sizing = $state<{ pointer: number; offset: number }>();
  const layout = $derived(draft ?? readLayout(split ? settings.reviewDockSplit : settings.reviewDockSolo, split, settings.reviewDataWidth));
  const { tiles, dividers } = $derived(geometry(layout, width, height));
  const empty = { x: 0, y: 0, width: 0, height: 0 };

  export function reset() {
    void settings.update(split ? { reviewDockSplit: '', reviewDataWidth: 50 } : { reviewDockSolo: '' });
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
    if (e.button !== 0 || drag || sizing) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { pane, pointer: e.pointerId, x: e.clientX, y: e.clientY, moving: false };
  }

  function slide(e: PointerEvent) {
    if (!drag || drag.pointer !== e.pointerId || !surface) return;
    if (!drag.moving && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    const bounds = surface.getBoundingClientRect();
    const x = e.clientX - bounds.left, y = e.clientY - bounds.top;
    drag.moving = true;
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
    draft = resize(layout, divider.path, (coordinate(e, divider) - origin - sizing.offset) / length(divider));
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
    save(resize(layout, divider.path, ratio));
  }
</script>

<div class="dock" class:manipulating={drag?.moving || sizing} bind:this={surface} bind:clientWidth={width} bind:clientHeight={height}
  hidden={!imagesOnly && (!active || !ready)}>
  {#each panes as pane (pane)}
    {@const rect = tiles[pane] ?? empty}
    {@const full = pane === 'images' && imagesOnly}
    {@const shown = full || (!imagesOnly && active && ready && !!tiles[pane])}
    <section class="tile" class:full class:drag-source={drag?.moving && drag.pane === pane} hidden={!shown} aria-label={title[pane]}
      style={full ? '' : tileStyle(rect)}>
      <header hidden={full}>
        <button class="grip" title="Drag to another panel edge to move" aria-label={`Drag ${title[pane]}`}
          onpointerdown={e => grab(e, pane)} onpointermove={slide} onpointerup={release}
          onpointercancel={release} onlostpointercapture={release}><span aria-hidden="true">⠿</span> {title[pane]}</button>
        <button class="dock-menu" aria-label={`Move ${title[pane]}`} title="Move panel" popovertarget={`dock-${pane}`}>⋯</button>
        <div id={`dock-${pane}`} class="move-menu" popover="auto">
          <span class="muted small">Dock {title[pane]} next to</span>
          {#each panes.filter(target => target !== pane && tiles[target]) as target}
            <div class="destination"><span>{title[target]}</span>
              {#each edges as edge, i}
                <button class="btn" aria-label={`Dock ${edge} of ${title[target]}`} title={edge}
                  onclick={e => { move(pane, target, edge); e.currentTarget.closest<HTMLElement>('.move-menu')?.hidePopover(); }}>
                  {['←', '→', '↑', '↓'][i]}
                </button>
              {/each}
            </div>
          {/each}
        </div>
      </header>
      <div class="body">
        {#if pane === 'images'}
          {@render images(shown && !drag?.moving, full ? 'full' : tileStyle(rect))}
        {:else if pane === 'spots'}{@render spots()}
        {:else if pane === 'plots'}{@render plots()}
        {:else}{@render details()}{/if}
      </div>
      {#if drag?.target === pane && drag.edge}<div class="drop-edge {drag.edge}"></div>{/if}
    </section>
  {/each}
  {#if active && ready && !imagesOnly}
    {#each dividers as divider (divider.path.join('.'))}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (Focusable splitter.) -->
      <div class="divider" class:vertical={divider.axis === 'x'} style={tileStyle(divider.rect)} role="separator" tabindex="0"
        aria-label="Resize panels" aria-orientation={divider.axis === 'x' ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(100 * divider.position / length(divider))} title="Drag or use arrow keys to resize"
        onpointerdown={e => grabDivider(e, divider)} onpointermove={e => slideDivider(e, divider)}
        onpointerup={releaseDivider} onpointercancel={releaseDivider} onlostpointercapture={releaseDivider}
        onkeydown={e => dividerKey(e, divider)}></div>
    {/each}
  {/if}
</div>

<style>
  .dock { position:relative; flex:1; min-height:0; min-width:0; overflow:hidden; }
  .tile { position:absolute; display:flex; flex-direction:column; min-width:0; min-height:0; overflow:hidden; border-radius:var(--radius-sm); border:1px solid var(--hairline); background:var(--glass); }
  .tile[hidden], .tile header[hidden], .dock[hidden] { display:none; }
  .tile.full { inset:0; border:0; border-radius:0; }
  .tile header { display:flex; align-items:center; justify-content:space-between; height:29px; padding:0 4px; flex:none; border-bottom:1px solid var(--hairline); background:var(--accent-soft); }
  .grip,.dock-menu { border:0; background:transparent; color:var(--text); padding:2px 5px; font-size:0.73rem; white-space:nowrap; border-radius:var(--radius-sm); }
  .grip { cursor:grab; touch-action:none; text-overflow:ellipsis; overflow:hidden; }
  .grip span { color:var(--text-muted); padding-right:3px; }
  .grip:active { cursor:grabbing; }
  .dock-menu { cursor:pointer; font-weight:700; font-size:0.9rem; }
  .grip:hover,.dock-menu:hover { background:var(--row-hover); }
  .body { flex:1; min-height:0; min-width:0; display:flex; flex-direction:column; overflow:hidden; container-type:inline-size; }
  .divider { position:absolute; cursor:row-resize; touch-action:none; border-radius:4px; }
  .divider.vertical { cursor:col-resize; }
  .divider::after { content:''; position:absolute; inset:3px 40%; background:var(--hairline); border-radius:3px; }
  .divider:not(.vertical)::after { inset:40% 3px; }
  .divider:hover::after,.divider:focus-visible::after,.divider:active::after { background:var(--accent); }
  .manipulating { user-select:none; -webkit-user-select:none; }
  .manipulating :global(iframe) { pointer-events:none; }
  .drag-source { opacity:0.55; }
  .drop-edge { position:absolute; inset:0; pointer-events:none; background:var(--accent-soft); border:2px solid var(--accent); z-index:1; }
  .drop-edge.left { right:50%; } .drop-edge.right { left:50%; }
  .drop-edge.top { bottom:50%; } .drop-edge.bottom { top:50%; }
  .move-menu { color:var(--text); background:var(--plot-bg); padding:12px; border:1px solid var(--hairline); border-radius:var(--radius); box-shadow:var(--glass-shadow); }
  .destination { display:grid; grid-template-columns:1fr repeat(4,30px); align-items:center; gap:4px; margin-top:6px; font-size:0.8rem; }
  .destination .btn { padding:3px 6px; }
</style>
