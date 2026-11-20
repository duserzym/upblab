<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { oversight } from '../lib/oversight.svelte';
  import { openOverlay, closeOverlay } from '../lib/overlays.svelte';
  let cancelButton = $state<HTMLButtonElement>();
  $effect(() => { if (oversight.pending) void tick().then(() => cancelButton?.focus()); });
  $effect.pre(() => {
    if (oversight.pending) openOverlay('on-behalf'); else closeOverlay('on-behalf');
  });
  onDestroy(() => { oversight.confirm(false); closeOverlay('on-behalf'); });
</script>
<svelte:window onkeydown={e => { if (e.key === 'Escape' && oversight.pending) oversight.confirm(false); }} />
{#if oversight.onBehalf}<div class="oversight-bar glass" role="status">Editing on behalf of {oversight.owner}</div>{/if}
{#if oversight.pending}
  <div class="backdrop">
    <div class="glass panel stack confirmation" role="dialog" aria-modal="true" aria-labelledby="on-behalf-title" tabindex="-1" onkeydown={e => { if (e.key === 'Tab') { const buttons = Array.from(e.currentTarget.querySelectorAll('button')); const at = buttons.indexOf(document.activeElement as HTMLButtonElement); e.preventDefault(); buttons[(at + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus(); } }}>
      <h2 id="on-behalf-title">Confirm on-behalf change</h2>
      <p>This data belongs to <strong>{oversight.pending.owner}</strong>. Make this change on their behalf?</p>
      <p class="small muted">{oversight.pending.message}</p>
      <p class="small muted">Consent applies to this operation only. The server records who made the change.</p>
      <div class="row"><button class="btn" bind:this={cancelButton} onclick={() => oversight.confirm(false)}>Cancel</button><button class="btn primary" onclick={() => oversight.confirm(true)}>Confirm on behalf</button></div>
    </div>
  </div>
{/if}
<style>
  .oversight-bar { flex: none; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: var(--space-2); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--glass-edge); min-width: 0; overflow-wrap: anywhere; }
  .backdrop { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: var(--space-4); background: color-mix(in srgb, var(--text) 25%, transparent); }
  .confirmation { width: min(32rem, 100%); max-height: calc(100vh - 4rem); overflow: auto; overflow-wrap: anywhere; background: var(--bg); }
  h2, p { margin: 0; }
</style>
