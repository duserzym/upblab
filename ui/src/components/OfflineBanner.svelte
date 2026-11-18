<script lang="ts">
  import { connectivity, savedDate } from '../lib/connectivity.svelte';
  const copyDate = $derived(connectivity.offlineCopy?.replace(/,?\s*read-only\s*$/i, '').trim());
  const status = $derived(connectivity.detail.match(/\b5\d\d\b/)?.[0]);
</script>
{#if connectivity.offlineCopy && connectivity.state === 'online'}
  <div class="glass row small offline-banner" role="status" data-testid="offline-banner">
    Read-only copy of UPbDB on this computer ({copyDate}). Changes are not accepted here; make them when the lab server is back.
  </div>
{:else if connectivity.state === 'offline' || connectivity.state === 'server-error'}
  <div class="glass row small offline-banner" class:server-error={connectivity.state === 'server-error'} role="status" data-testid="offline-banner">
    <span>
      {#if connectivity.state === 'server-error'}The server answered with an error{status ? ` (${status})` : ''}.{:else}Offline:{/if}
      {#if connectivity.asOf} {connectivity.state === 'offline' ? 'showing' : 'Showing'} data saved on this computer, as of {savedDate(connectivity.asOf)} (local time).{:else} The server is not answering.{/if}
      {#if connectivity.offlineCopy && connectivity.asOf}(saved from the read-only copy){/if}
      {connectivity.retrying ? 'Retrying…' : `Retrying in ${connectivity.retryIn} s`}
    </span>
    <span aria-hidden="true">·</span><button class="btn small" disabled={connectivity.retrying} onclick={() => void connectivity.retryNow()}>Retry now</button>
  </div>
{/if}
{#if connectivity.grainAtlasLocal && connectivity.offlineCopy}
  <div class="glass row small offline-banner" role="status" data-testid="grainatlas-local-notice">GrainAtlas opens without the server while UPb Lab shows a read-only copy, so your edits stay in GrainAtlas's local drafts.</div>
{/if}
<style>
  .offline-banner { flex: none; flex-wrap: wrap; padding: var(--space-1) var(--space-3); gap: var(--space-1); border-radius: 0; color: var(--text-muted); }
  .server-error { color: var(--danger); }
</style>
