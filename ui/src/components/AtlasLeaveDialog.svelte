<script lang="ts">
  import { onDestroy } from 'svelte';
  import { atlasSync, changeCounts } from '../lib/atlas-sync.svelte';
  import { openOverlay, closeOverlay } from '../lib/overlays.svelte';
  let cancel = $state<HTMLButtonElement>();
  $effect.pre(() => {
    if (atlasSync.leave) openOverlay('atlas-leave');
    else closeOverlay('atlas-leave');
  });
  $effect(() => { if (atlasSync.leave) queueMicrotask(() => cancel?.focus()); });
  onDestroy(() => closeOverlay('atlas-leave'));
</script>
<svelte:window onkeydown={e => { if (atlasSync.leave && e.key === 'Escape') atlasSync.finishLeave(null); }} />
{#if atlasSync.leave}
  {@const request = atlasSync.leave}
  <div class="backdrop" role="presentation">
    <div class="glass panel dialog stack" role="dialog" aria-modal="true" aria-labelledby="atlas-leave-title">
      <h2 id="atlas-leave-title">{`Leave editing ${request.status.name}?`}</h2>
      <p>{changeCounts(request.status.changes)}</p>
      <div class="row actions">
        <button class="btn primary" onclick={() => atlasSync.finishLeave('sync')}>Sync and leave</button>
        <button class="btn" onclick={() => atlasSync.finishLeave('keep-draft')}>Keep draft and leave</button>
        <button class="btn destructive" onclick={() => atlasSync.finishLeave('discard')}>Discard changes</button>
        <button class="btn" bind:this={cancel} onclick={() => atlasSync.finishLeave(null)}>Stay</button>
      </div>
    </div>
  </div>
{/if}
<style>
  .backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; background: color-mix(in srgb, var(--bg) 55%, transparent); padding: var(--space-4); }
  .dialog { width: min(36rem, 100%); max-height: 100%; overflow: auto; overflow-wrap: anywhere; }
  h2, p { margin: 0; }
  .actions { flex-wrap: wrap; }
  .destructive { color: var(--danger); }
</style>
