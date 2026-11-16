<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { review } from '../../lib/review.svelte';
  import { dateLabel, type ReviewSpot, type SpotGroup } from '../../lib/review-data';
  import { layerVisibility, moveLayer, orderedLayers, resultLayers, type Layer, type LayerOrder } from '../../lib/review-layers';

  let { scope, groups, allGroups, hidden, searching, active, onvisibility, ongrain, onall, onclear, ongroup, onorder }: {
    scope: string; groups: SpotGroup[]; allGroups: SpotGroup[]; hidden: Set<string>; searching: boolean; active: boolean;
    onvisibility: (keys: string[], show: boolean) => void;
    ongrain: (key: string, rows: ReviewSpot[], event: MouseEvent, order: string[]) => void;
    onall: () => void; onclear: () => void;
    ongroup: (key: string | undefined, event?: MouseEvent) => void;
    onorder: (keys: string[]) => void;
  } = $props();

  let tree = $state<HTMLDivElement>();
  const orderKey = `upbstudio.review.layerOrder:${untrack(() => scope)}`;
  function readOrder(): LayerOrder {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(orderKey) ?? '{}');
      if (!saved || typeof saved !== 'object') return {};
      return Object.fromEntries(Object.entries(saved).filter(([, keys]) =>
        Array.isArray(keys) && keys.every(key => typeof key === 'string')));
    } catch { return {}; }
  }
  let order = $state<LayerOrder>(readOrder());
  let expanded = $state<Record<string, boolean>>({});
  let drag = $state<{ parent: string; key: string }>();
  let drop = $state<{ key: string; after: boolean }>();
  const all = $derived(orderedLayers(resultLayers(allGroups), order));
  const layers = $derived(orderedLayers(resultLayers(groups), order));
  const grainOrder = $derived(layers.flatMap(branch => 'children' in branch ? branch.children : [])
    .flatMap(sample => 'children' in sample ? sample.children : [])
    .flatMap(grain => 'children' in grain && grain.grain ? [grain.key] : []));

  $effect(() => {
    const keys = layers.flatMap(branch => 'children' in branch ? branch.children.map(sample => sample.key) : []);
    untrack(() => onorder(keys));
  });

  function isOpen(layer: Layer, level: number) {
    return searching || (expanded[layer.key] ?? (level === 0 || level > 1 || groups.length <= 3));
  }

  $effect(() => {
    void review.scrollVersion;
    const selected = review.selectedKey;
    if (!active || !selected || !tree) return;
    untrack(() => {
      function openPath(branches: Layer[]) {
        const layer = branches.find(branch => branch.rows.some(row => row.key === selected));
        if (layer && 'children' in layer) {
          expanded[layer.key] = true;
          openPath(layer.children);
        }
      }
      openPath(layers);
      void tick().then(() => tree?.querySelector<HTMLElement>(`[data-spot-key="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest' }));
    });
  });

  function siblings(branches: Layer[], parent: string): Layer[] | undefined {
    if (!parent) return branches;
    for (const branch of branches) {
      if (!('children' in branch)) continue;
      if (branch.key === parent) return branch.children;
      const match = siblings(branch.children, parent);
      if (match) return match;
    }
  }

  function move(parent: string, source: string, target: string, after: boolean) {
    const keys = siblings(all, parent)?.map(layer => layer.key) ?? [];
    order[parent] = moveLayer(keys, source, target, after);
    try { localStorage.setItem(orderKey, JSON.stringify(order)); } catch { /* Ordering still works without storage. */ }
  }

  function startDrag(event: DragEvent, parent: string, key: string) {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', key);
    drag = { parent, key };
  }

  function over(event: DragEvent, parent: string, key: string) {
    if (!drag || drag.parent !== parent || drag.key === key) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    drop = { key, after: event.clientY >= rect.top + rect.height / 2 };
  }

  function finish(event: DragEvent, parent: string, key: string) {
    if (drag?.parent !== parent || drop?.key !== key) return;
    event.preventDefault();
    move(parent, drag.key, key, drop.after);
    clearDrag();
  }

  function clearDrag() {
    drag = drop = undefined;
  }

  function moveWithKeys(event: KeyboardEvent, parent: string, key: string) {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const keys = siblings(all, parent)?.map(layer => layer.key) ?? [];
    const after = event.key === 'ArrowDown';
    const target = keys[keys.indexOf(key) + (after ? 1 : -1)];
    event.preventDefault();
    event.stopPropagation();
    if (target) move(parent, key, target, after);
  }

  function toggle(layer: Layer, level: number) {
    if (level <= 1) ongroup(level === 1 ? layer.key : undefined);
    const rows = layer.rows;
    onvisibility(rows.map(spot => spot.key), layerVisibility(rows, hidden) !== true);
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') return onclear();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      return onall();
    }
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('.layer-row');
    if (row && event.key.toLowerCase() === 'h' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      row.querySelector<HTMLButtonElement>('.visibility')?.click();
      return;
    }
    if (event.altKey || !['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key) || (row && !target.matches('.spot'))) return;
    const spots = Array.from(tree?.querySelectorAll<HTMLButtonElement>('[data-spot-key]') ?? []).filter(button => !button.closest('[hidden]'));
    const i = spots.findIndex(button => button.dataset.spotKey === review.selectedKey);
    if (event.key === 'Enter' && !target.matches('.spot')) return;
    event.preventDefault();
    if (event.key === 'Enter' && review.selected) void review.focus(review.selected, true);
    else if (spots.length) {
      const button = spots[Math.max(0, Math.min(spots.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1)))];
      button.click();
      button.focus();
    }
  }

  const badgeColor = (spot: ReviewSpot) => !spot.date ? 'var(--text-faint)' :
    spot.flags.length || spot.date.passes === false ? 'var(--warning)' : spot.date.passes ? 'var(--ok)' : 'var(--text-muted)';
</script>

{#snippet nodes(branches: Layer[], parent: string, level: number)}
  {#each branches as layer (layer.key)}
    {@const spot = 'spot' in layer ? layer.spot : null}
    {@const open = !spot && isOpen(layer, level)}
    {@const full = siblings(all, parent)?.find(item => item.key === layer.key) ?? layer}
    {@const checked = layerVisibility(full.rows, hidden)}
    <div role="treeitem" aria-label={layer.name} aria-expanded={spot ? undefined : open} aria-selected={spot ? review.selectedKey === spot.key : undefined}>
      <div class="layer-row" class:root={level === 0} class:drop-before={drop?.key === layer.key && !drop.after}
        class:drop-after={drop?.key === layer.key && drop.after} class:dimmed={checked === false}
        role="none" ondragover={e => over(e, parent, layer.key)} ondrop={e => finish(e, parent, layer.key)}
        ondragleave={e => { if (drop?.key === layer.key && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) drop = undefined; }}
        oncontextmenu={e => { e.preventDefault(); toggle(full, level); }}>
        {#if !spot}
          <button class="icon disclosure" aria-label={`${open ? 'Collapse' : 'Expand'} ${layer.name}`} aria-expanded={open}
            onclick={() => expanded[layer.key] = !open}><span aria-hidden="true">{open ? '▾' : '▸'}</span></button>
        {/if}
        <button type="button" class="icon visibility" role="checkbox" aria-checked={checked} aria-label={`Show ${layer.name} in Review`}
          title="Toggle visibility (right-click or H)" onclick={() => toggle(full, level)}>
          <span aria-hidden="true">{checked === 'mixed' ? '−' : checked ? '✓' : ''}</span>
        </button>
        {#if spot}
          <button class="spot" class:selected={review.selectedKey === spot.key} class:hovered={review.hoveredKey === spot.key}
            data-spot-key={spot.key} tabindex={review.selectedKey === spot.key ? 0 : -1} aria-keyshortcuts="H" onclick={() => review.select(spot)} ondblclick={() => void review.focus(spot, true)}>
            <span>{spot.label}</span><small style:color={badgeColor(spot)} title="Preferred date ± 2σ (Ma)">{dateLabel(spot)}</small>
          </button>
        {:else if 'grain' in layer && layer.grain}
          <button class="name" title="Click to isolate · Ctrl/Cmd-click to toggle · Shift-click for a range"
            onclick={e => ongrain(layer.key, full.rows, e, grainOrder)} ondblclick={() => void review.focusGrain(full.rows)}>{layer.name}</button>
        {:else}
          <button class="name" title={layer.name} onclick={e => { ongroup(level === 1 ? layer.key : undefined, e); expanded[layer.key] = !open; }}>{layer.name}</button>
          <small class="count">{layer.rows.length}</small>
        {/if}
        {#if (siblings(all, parent)?.length ?? 0) > 1}
          <button class="icon handle" draggable="true" aria-label={`Reorder ${layer.name}`} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            title="Drag to reorder within this level, or press Option/Alt with ↑ or ↓"
            ondragstart={e => startDrag(e, parent, layer.key)} ondragend={clearDrag}
            onkeydown={e => moveWithKeys(e, parent, layer.key)}>⠿</button>
        {/if}
      </div>
      {#if 'children' in layer}
        <div class="children" role="group" hidden={!open}>
          {@render nodes(layer.children, layer.key, level + 1)}
        </div>
      {/if}
    </div>
  {/each}
{/snippet}

<div class="layer-tree" role="tree" aria-label="Result spots" tabindex="0" bind:this={tree} onkeydown={keydown}>
  {@render nodes(layers, '', 0)}
</div>

<style>
  .layer-tree {min-height:0;overflow:auto;}
  .children {margin-left:8px;border-left:1px solid var(--hairline);padding-left:2px;}
  .layer-row {display:flex;align-items:center;min-width:0;gap:2px;position:relative;min-height:24px;}
  .layer-row:hover {background:var(--row-hover);}
  .root {font-weight:650;margin:2px 0;}
  .icon,.name,.spot {border:0;color:var(--text);background:transparent;font:inherit;font-size:0.72rem;cursor:pointer;border-radius:var(--radius-sm);}
  .icon {flex:none;padding:2px;width:17px;min-height:21px;color:var(--text-muted);}
  .icon:hover,.name:hover {color:var(--accent);}
  .visibility span {display:grid;place-items:center;width:13px;height:13px;border:1px solid var(--text-faint);border-radius:3px;font-size:0.62rem;line-height:1;}
  .visibility[aria-checked=true] span,.visibility[aria-checked=mixed] span {color:var(--accent);border-color:var(--accent);background:var(--accent-soft);}
  .name {min-width:0;flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:3px 1px;}
  .count {color:var(--text-muted);font-size:0.63rem;}
  .handle {cursor:grab;opacity:0.55;}
  .handle:hover,.handle:focus-visible {opacity:1;}
  .drop-before {box-shadow:inset 0 2px var(--accent);}
  .drop-after {box-shadow:inset 0 -2px var(--accent);}
  .dimmed .name,.dimmed .spot {opacity:0.60;}
  .spot {min-width:0;display:flex;align-items:center;justify-content:space-between;gap:1px 4px;flex:1;flex-wrap:wrap;
    padding:3px 2px;border:1px solid transparent;text-align:left;}
  .spot span {overflow-wrap:anywhere;min-width:0;}
  .spot small {font-size:0.64rem;white-space:nowrap;}
  .spot.selected {background:var(--accent-soft);border-color:var(--accent);}
  .spot.hovered {outline:1px solid var(--accent);outline-offset:-1px;}
</style>
