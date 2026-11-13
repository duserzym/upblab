<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { AtlasDraft, AtlasSyncConfirmation } from '@lab/bridge';
  import { atlasSync, changeCounts } from '../../lib/atlas-sync.svelte';
  import { overview } from '../../lib/overview.svelte';
  import { confirmationSummary, resultMessage } from '../../lib/atlas-requests';
  import { openOverlay, closeOverlay } from '../../lib/overlays.svelte';
  let confirm = $state<AtlasDraft | null>(null);
  let cancel = $state<HTMLButtonElement>();
  let pending = $state<Record<string, boolean>>({});
  let results = $state<Record<string, { name: string; message: string; confirm?: AtlasSyncConfirmation }>>({});
  const busy = $derived(Object.values(pending).some(Boolean));
  $effect.pre(() => { if (confirm) openOverlay('atlas-discard'); else closeOverlay('atlas-discard'); });
  $effect(() => { if (confirm) queueMicrotask(() => cancel?.focus()); });
  onDestroy(() => closeOverlay('atlas-discard'));
  async function command(type: 'sync-draft' | 'discard-draft', draft: AtlasDraft) {
    if (!atlasSync.v4 || busy) return;
    pending = { [draft.project]: true };
    confirm = null;
    delete results[draft.project];
    const result = await atlasSync.request({ type, project: draft.project });
    pending = {};
    if (!('timeout' in result) && result.code === 'needs-confirmation') {
      results[draft.project] = { name: draft.name,
        message: `Needs your confirmation: ${confirmationSummary(result.confirm, ', ')}`, confirm: result.confirm };
      return;
    }
    const message = 'timeout' in result || !result.ok
      ? !('timeout' in result) && result.code === 'conflict'
        ? 'Both changed: open it in Images to review the differences'
        : resultMessage(result, type === 'sync-draft' ? 60 : 10, type === 'sync-draft' ? 'Sync' : 'Discard')
      : type === 'sync-draft' ? `Synced${result.revision == null ? '' : ` r${result.revision}`}` : 'Draft discarded';
    results[draft.project] = { name: draft.name, message };
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
{#if atlasSync.v4 && (atlasSync.drafts.length || Object.keys(results).length)}
  <section class="board-section stack" aria-label="Changes not yet in the database">
    <h2>Changes not yet in the database</h2>
    {#each atlasSync.drafts as draft}
      {@const mount = overview.mounts.find(row => row.mount.id === draft.mount)?.mount}
      <div class="glass panel draft-row">
        <div class="description">
          <strong title={draft.name}>{draft.name}</strong>
          <span class="muted small">{mount?.label ?? ''}{mount ? ' · ' : ''}{changeCounts(draft.changes)}</span>
          <span class="faint small">changed {changed(draft.updatedAt)}</span>
          {#if results[draft.project]}<span class="small" role="status">{results[draft.project].message}</span>{/if}
        </div>
        {#if results[draft.project]?.confirm}
          <button class="btn small" disabled={busy} onclick={() => atlasSync.openForConfirmation(draft.project, results[draft.project].confirm!, true)}>Open in Images</button>
        {/if}
        <button class="btn small" disabled={busy} onclick={() => command('sync-draft', draft)}>Sync</button>
        <button class="btn small" disabled={busy} onclick={() => confirm = draft}>Discard</button>
      </div>
    {/each}
    {#each Object.entries(results).filter(([project]) => !atlasSync.drafts.some(draft => draft.project === project)) as [project, result] (project)}
      <p class="small" role="status">{result.name}: {result.message}</p>
      {#if result.confirm}
        <button class="btn small" disabled={busy} onclick={() => atlasSync.openForConfirmation(project, result.confirm!, true)}>Open in Images</button>
      {/if}
    {/each}
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
  .draft-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: 0; padding: var(--space-2) var(--space-3); min-width: 0; }
  .description { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); align-items: baseline; }
  strong { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .description span { overflow-wrap: anywhere; }
  .backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; background: color-mix(in srgb, var(--bg) 55%, transparent); padding: var(--space-4); }
  .dialog { width: min(32rem, 100%); max-height: 100%; overflow: auto; overflow-wrap: anywhere; }
  h2, p { margin: 0; }
  .destructive { color: var(--danger); }
</style>
