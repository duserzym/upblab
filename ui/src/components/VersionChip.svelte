<script lang="ts">
  import { tick } from 'svelte';
  import { shell } from '../lib/shell.svelte';
  import { updater } from '../lib/updater.svelte';

  const status = $derived(updater.status);
  const text = $derived(
    status.kind === 'checking' ? 'Checking'
      : status.kind === 'downloading' ? `Downloading${status.pct === null ? '…' : ` ${status.pct}%`}`
      : status.kind === 'available' ? 'Update available'
      : status.kind === 'ready' ? 'Update ready, restart'
      : status.kind === 'installing' ? 'Installing…'
      : status.kind === 'error' ? 'Check failed'
      : status.kind === 'none' && updater.justChecked ? 'Up to date'
      : `v${updater.version}`,
  );
  async function showUpdates() {
    shell.show('settings');
    await tick();
    document.getElementById('updates')?.scrollIntoView({ block: 'start' });
  }
</script>

<button class="tab version" data-testid="version-chip" title="UPb Studio v{updater.version} · Settings > Updates" onclick={showUpdates}>
  {#if status.kind === 'checking' || status.kind === 'downloading'}<span class="spinner" aria-hidden="true"></span>{/if}
  {#if status.kind === 'available' || status.kind === 'ready'}<span class="dot" aria-hidden="true"></span>{/if}
  <span>{text}</span>
</button>

<style>
  .version { display: inline-flex; align-items: center; gap: var(--space-2); font-size: 12px; color: var(--text-muted); max-width: 200px; min-width: 0; flex: 0 1 auto; white-space: nowrap; }
  .version > span:last-child { overflow: hidden; text-overflow: ellipsis; }
  .dot { background: var(--accent); }
  .spinner { width: 12px; height: 12px; }
</style>
