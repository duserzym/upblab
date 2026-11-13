<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { AtlasDraft } from '@lab/bridge';
  import { atlasSync, changeCounts } from '../../lib/atlas-sync.svelte';
  import { overview } from '../../lib/overview.svelte';
  import { sendCommand } from '../../lib/incoming';
  import { openOverlay, closeOverlay } from '../../lib/overlays.svelte';
  let confirm = $state<AtlasDraft | null>(null);
  let cancel = $state<HTMLButtonElement>();
  let pending = $state<Record<string, boolean>>({});
  let error = $state('');
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  // The bridge retains only one waiting command. Lock every row during the
  // acknowledgement window, so an action on another draft cannot replace it.
  const busy = $derived(Object.values(pending).some(Boolean));
  $effect(() => {
    void atlasSync.snapshot;
    pending = {};
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  });
  $effect.pre(() => { if (confirm) openOverlay('atlas-discard'); else closeOverlay('atlas-discard'); });
  $effect(() => { if (confirm) queueMicrotask(() => cancel?.focus()); });
  onDestroy(() => { closeOverlay('atlas-discard'); for (const timer of timers.values()) clearTimeout(timer); });
  async function command(type: 'sync-draft' | 'discard-draft', draft: AtlasDraft) {
    if (!atlasSync.v4 || busy) return;
    pending = { [draft.project]: true };
    confirm = null; error = '';
    timers.set(draft.project, setTimeout(() => { pending = {}; timers.delete(draft.project); }, 5000));
    try { await sendCommand('images', { type, project: draft.project }); }
    catch (err) { error = String(err); }
  }
  function loss(draft: AtlasDraft) {
    const c = draft.changes;
    const parts = ([['spots', 'spot'], ['grains', 'grain'], ['labels', 'label']] as const)
      .flatMap(([key, name]) => c[key] ? [`${c[key]} ${name}`] : []);
    if (c.pixels) parts.push('image');
    return `${parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1) : parts[0] ?? 'draft'} changes`;
  }
  function changed(at: string) {
    const date = new Date(at);
    return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : at;
  }
</script>
<svelte:window onkeydown={e => { if (e.key === 'Escape') confirm = null; }} />
{#if atlasSync.v4 && atlasSync.drafts.length}
  <section class="board-section stack" aria-label="Changes not yet in the database">
    <h2>Changes not yet in the database</h2>
    {#each atlasSync.drafts as draft}
      {@const mount = overview.mounts.find(row => row.mount.id === draft.mount)?.mount}
      <div class="glass panel draft-row">
        <div class="description">
          <strong title={draft.name}>{draft.name}</strong>
          <span class="muted small">{mount?.label ?? ''}{mount ? ' · ' : ''}{changeCounts(draft.changes)}</span>
          <span class="faint small">changed {changed(draft.updatedAt)}</span>
        </div>
        <button class="btn small" disabled={busy} onclick={() => command('sync-draft', draft)}>Sync</button>
        <button class="btn small" disabled={busy} onclick={() => confirm = draft}>Discard</button>
      </div>
    {/each}
    {#if error}<p class="error small" role="status">{error}</p>{/if}
  </section>
{/if}
{#if confirm}
  <div class="backdrop" role="presentation">
    <div class="glass panel dialog stack" role="dialog" aria-modal="true" aria-labelledby="discard-draft-title">
      <h2 id="discard-draft-title">Discard draft?</h2>
      <p>Discard {loss(confirm)} to {confirm.name}? This cannot be undone.</p>
      <div class="row">
        <button class="btn" bind:this={cancel} onclick={() => confirm = null}>Cancel</button>
        <span class="spacer"></span>
        <button class="btn destructive" disabled={busy} onclick={() => confirm && command('discard-draft', confirm)}>Discard</button>
      </div>
    </div>
  </div>
{/if}
<style>
  .board-section { min-width: 0; gap: var(--space-2); }
  .draft-row { display: flex; align-items: center; gap: var(--space-2); margin-top: 0; padding: var(--space-2) var(--space-3); min-width: 0; }
  .description { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); align-items: baseline; }
  strong { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .description span { overflow-wrap: anywhere; }
  .backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; background: color-mix(in srgb, var(--bg) 55%, transparent); padding: var(--space-4); }
  .dialog { width: min(32rem, 100%); max-height: 100%; overflow: auto; overflow-wrap: anywhere; }
  h2, p { margin: 0; }
  .destructive { color: var(--danger); }
</style>
