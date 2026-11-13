<script lang="ts">
  import { onDestroy } from 'svelte';
  import { CONFLICT_NOTE, resultReason } from '../lib/atlas-requests';
  import { atlasSync, changeCounts, type LeaveDecision } from '../lib/atlas-sync.svelte';
  import { openOverlay, closeOverlay } from '../lib/overlays.svelte';
  let busy = $state(false), error = $state(''), busyLabel = $state('');
  async function decide(decision: LeaveDecision) {
    if (busy || !atlasSync.leave) return;
    const leave = atlasSync.leave;
    busy = true; error = ''; busyLabel = decision === 'sync' ? 'Syncing…' : decision === 'keep-draft' ? 'Keeping draft…' : 'Discarding…';
    const result = await atlasSync.request({ type: 'leave-edit', project: leave.status.project, decision });
    // Quit may have cancelled this navigation while its command was running.
    if (atlasSync.leave !== leave) return;
    busy = false;
    if (!('timeout' in result) && result.ok) atlasSync.finishLeave(decision);
    else if (!('timeout' in result) && result.code === 'conflict') {
      atlasSync.note = CONFLICT_NOTE; atlasSync.finishLeave(null);
    } else {
      const action = decision === 'sync' ? 'Sync' : decision === 'keep-draft' ? 'Keeping draft' : 'Discard';
      error = `${action} did not finish: ${resultReason(result, decision === 'sync' ? 60 : 10)}. Your draft is kept.`;
    }
  }
  $effect(() => { if (!atlasSync.leave) { error = ''; busy = false; } });
  let cancel = $state<HTMLButtonElement>();
  $effect.pre(() => {
    if (atlasSync.leave) openOverlay('atlas-leave');
    else closeOverlay('atlas-leave');
  });
  $effect(() => { if (atlasSync.leave) queueMicrotask(() => cancel?.focus()); });
  onDestroy(() => closeOverlay('atlas-leave'));
</script>
<svelte:window onkeydown={e => { if (atlasSync.leave && !busy && e.key === 'Escape') atlasSync.finishLeave(null); }} />
{#if atlasSync.leave}
  {@const request = atlasSync.leave}
  <div class="backdrop" role="presentation">
    <div class="glass panel dialog stack" role="dialog" aria-modal="true" aria-labelledby="atlas-leave-title">
      <h2 id="atlas-leave-title">{`Leave editing ${request.status.name}?`}</h2>
      <p>{changeCounts(request.status.changes)}</p>
      {#if busy}<p role="status">{busyLabel}</p>{/if}
      {#if error}<p role="status">{error}</p>{/if}
      <div class="row actions">
        {#if error}
          <button class="btn primary" bind:this={cancel} onclick={() => atlasSync.finishLeave(null)}>Stay</button>
          <button class="btn" onclick={() => atlasSync.finishLeave('keep-draft')}>Leave anyway (draft kept)</button>
        {:else}
          <button class="btn primary" disabled={busy} onclick={() => decide('sync')}>Sync and leave</button>
          <button class="btn" disabled={busy} onclick={() => decide('keep-draft')}>Keep draft and leave</button>
          <button class="btn destructive" disabled={busy} onclick={() => decide('discard')}>Discard changes</button>
          <button class="btn" disabled={busy} bind:this={cancel} onclick={() => atlasSync.finishLeave(null)}>Stay</button>
        {/if}
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
