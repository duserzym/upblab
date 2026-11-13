<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import type { AtlasStatusEvent } from '@lab/bridge';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { atlasSync, changeCounts, needsLeaveGuard } from '../lib/atlas-sync.svelte';
  import { CONFLICT_NOTE, resultMessage } from '../lib/atlas-requests';
  import { isDesktop } from '../lib/platform';
  import { shell } from '../lib/shell.svelte';
  import { openOverlay, closeOverlay } from '../lib/overlays.svelte';

  let quit = $state<{ id: number; status: AtlasStatusEvent | null; otherDrafts: number } | null>(null);
  let busy = $state(false), error = $state(''), progress = $state('');
  let cancel = $state<HTMLButtonElement>();
  let disposed = false;
  let unlisten: (() => void) | undefined;
  const guardCurrent = $derived(needsLeaveGuard(quit?.status ?? null));
  onMount(() => {
    if (!isDesktop) return;
    void listen<{ id: number }>('shell://quit-request', async ({ payload: { id } }) => {
      if (quit) return;
      if (!atlasSync.v4 || !atlasSync.guardNeeded && !atlasSync.drafts.length && !atlasSync.leave) {
        await invoke('quit_answer', { id, answer: 'go' });
        return;
      }
      // A navigation dialog cannot leave an outstanding navigation after quit Cancel.
      if (atlasSync.leave) {
        atlasSync.finishLeave(null);
      }
      quit = { id, status: atlasSync.status, otherDrafts: atlasSync.drafts.filter(draft => draft.project !== atlasSync.status?.project).length };
      busy = false; error = ''; progress = '';
      await invoke('quit_answer', { id, answer: 'prompting' });
    }).then(stop => { if (disposed) stop(); else unlisten = stop; });
  });
  onDestroy(() => { disposed = true; unlisten?.(); closeOverlay('atlas-quit'); });
  $effect.pre(() => { if (quit) openOverlay('atlas-quit'); else closeOverlay('atlas-quit'); });
  $effect(() => { if (quit) queueMicrotask(() => cancel?.focus()); });
  async function stay() {
    if (!quit || busy) return;
    busy = true;
    try {
      await invoke('quit_cancel', { id: quit.id });
      quit = null; error = ''; progress = '';
    } catch {
      error = 'Could not cancel quitting. Try again, or press Cmd+Q to quit.';
    } finally {
      busy = false;
    }
  }
  async function close() {
    if (!quit) return;
    busy = true;
    try {
      await invoke('quit_confirm', { id: quit.id });
    } catch {
      error = 'Could not close the window. Your draft is kept.';
      busy = false;
    }
  }
  async function decide(decision: 'sync' | 'keep-draft') {
    if (!quit || busy) return;
    busy = true; error = '';
    progress = decision === 'sync' ? 'Syncing…' : 'Keeping drafts… If there is no reply in 10 s, UPb Lab will quit. Drafts already stored by the module stay.';
    if (quit.status && (decision === 'sync' || quit.status.mode === 'edit')) {
      const project = quit.status.project;
      const result = await atlasSync.request({ type: 'leave-edit', project, decision });
      if (decision === 'sync' && ('timeout' in result || !result.ok)) {
        busy = false; progress = '';
        if (!('timeout' in result) && result.code === 'needs-confirmation') {
          await stay();
          if (!quit) void atlasSync.openForConfirmation(project, result.confirm);
        } else if (!('timeout' in result) && result.code === 'conflict') {
          atlasSync.note = CONFLICT_NOTE;
          await stay();
          // Review differences belongs to GrainAtlas; show its surface directly.
          shell.view = 'images';
        } else error = resultMessage(result, 60);
        return;
      }
      if (decision === 'keep-draft' && 'timeout' in result) {
        progress = 'No reply in 10 s. Quitting; drafts already stored by the module stay.';
        await tick();
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    await close();
  }
</script>
<svelte:window onkeydown={event => { if (quit && event.key === 'Escape') stay(); }} />
{#if quit}
  <div class="backdrop" role="presentation">
    <div class="glass panel dialog stack" role="dialog" aria-modal="true" aria-labelledby="atlas-quit-title">
      <h2 id="atlas-quit-title">Quit with unsynced changes?</h2>
      {#if quit.status}<p>{quit.status.name}: {changeCounts(quit.status.changes) || 'no current changes'}</p>{/if}
      <p>{quit.otherDrafts} other {quit.otherDrafts === 1 ? 'draft' : 'drafts'}</p>
      {#if busy && progress}<p role="status">{progress}</p>{/if}
      {#if error}<p role="status">{error}</p>{/if}
      <div class="row actions">
        {#if error}
          <button class="btn primary" disabled={busy} bind:this={cancel} onclick={stay}>Stay</button>
          <button class="btn" disabled={busy} onclick={close}>Quit anyway (draft kept)</button>
        {:else}
          {#if guardCurrent}<button class="btn primary" disabled={busy} onclick={() => decide('sync')}>Sync and quit</button>{/if}
          <button class="btn" disabled={busy} onclick={() => decide('keep-draft')}>Quit, keep drafts</button>
          <button class="btn" disabled={busy} bind:this={cancel} onclick={stay}>Cancel</button>
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
</style>
