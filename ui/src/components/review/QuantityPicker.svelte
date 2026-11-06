<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { GROUPS, axisLabel, type AvailableQuantity } from '../../lib/geochem';
  let { quantities, anchor, axis, onpick, onclose }: {
    quantities: AvailableQuantity[]; anchor: HTMLElement; axis: string;
    onpick: (id: string) => void; onclose: () => void;
  } = $props();
  let filter = $state('');
  let popup = $state<HTMLDivElement>();
  let search = $state<HTMLInputElement>();
  let left = $state(12), top = $state(80);
  const matching = $derived(quantities.filter(q => q.available && `${q.label} ${q.id}`.toLowerCase().includes(filter.toLowerCase())));
  $effect(() => {
    if (!popup) return;
    const rect = untrack(()=>anchor.getBoundingClientRect());
    left = Math.max(12, Math.min(rect.left, window.innerWidth - Math.min(500, window.innerWidth - 24) - 12));
    top = Math.max(12, Math.min(rect.bottom + 4, window.innerHeight - 380));
    popup.showPopover();
    void tick().then(() => search?.focus());
  });
  // Read the anchor before onclose(): closing unmounts this picker and its props go away.
  let closed = false;
  function close() { if (closed) return; closed = true; const a = anchor; onclose(); a?.focus(); }
  function keydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const chips = [...popup!.querySelectorAll<HTMLButtonElement>('[data-quantity]')];
    if (!chips.length) return;
    e.preventDefault();
    const i = chips.indexOf(document.activeElement as HTMLButtonElement), direction = ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1;
    chips[i < 0 ? direction > 0 ? 0 : chips.length - 1 : (i + direction + chips.length) % chips.length].focus();
  }
</script>
<div class="picker" role="dialog" aria-label={`Choose ${axis} quantity`} tabindex="-1" popover="auto" bind:this={popup} style:left="{left}px" style:top="{top}px" onkeydown={keydown} ontoggle={e=>{if(e.newState==='closed') close();}}>
  <div class="row"><input type="search" placeholder="Find an element or quantity…" aria-label="Filter quantities" bind:value={filter} bind:this={search} /><button class="chip" aria-label="Close quantity picker" onclick={close}>×</button></div>
  {#if 'ree pattern'.includes(filter.toLowerCase())}<button class="chip pattern" data-quantity="ree" onclick={()=>onpick('ree')}>REE pattern</button>{/if}
  {#each GROUPS as group}
    {@const items = matching.filter(q=>q.group===group)}
    {#if items.length}<section><h3>{group}</h3><div class="chips">{#each items as q}<button class="chip" class:ree={q.ree} data-quantity={q.id} title={axisLabel(q)} onclick={()=>onpick(q.id)}>{q.label}</button>{/each}</div></section>{/if}
  {/each}
  {#if !matching.length && !'ree pattern'.includes(filter.toLowerCase())}<p class="muted small">No quantities with values match.</p>{/if}
</div>
<style>
  .picker {position:fixed;margin:0;width:min(500px,calc(100vw - 24px));max-height:min(370px,calc(100vh - 24px));overflow:auto;padding:12px;background:var(--plot-bg);color:var(--text);border:1px solid var(--hairline);border-radius:var(--radius);box-shadow:var(--glass-shadow);}
  .row {gap:8px;} input {flex:1;width:0;} h3 {font-size:0.69rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin:12px 0 6px;}
  .chips {display:flex;flex-wrap:wrap;gap:5px;} .chip {font-size:0.76rem;} .ree {background:var(--accent-soft);} .pattern {margin-top:8px;}
</style>
