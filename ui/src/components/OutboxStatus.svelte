<script lang="ts">
  import { outbox } from '../lib/outbox.svelte';
  let error = $state('');
  async function action(run: () => Promise<void>) { error = ''; try { await run(); } catch (e) { error = String(e); } }
</script>
{#if outbox.counts.total || outbox.error}
  <aside class="panel small" aria-label="Saved edits">
    {#if outbox.counts.pending}<p role="status">{outbox.counts.pending} {outbox.counts.pending === 1 ? 'edit' : 'edits'} not sent yet · Saved here, not sent yet</p>{/if}
    {#if outbox.error}<p class="error">{outbox.error}</p>{/if}
    {#if outbox.entries.length}
      <details><summary>{outbox.attention.length ? `${outbox.attention.length} needs your attention` : 'Show saved edits'}</summary>
        <ul>{#each outbox.entries as entry (entry.id)}
          <li><p>{entry.objectKey} · {entry.lastStatus === 401 ? 'Waiting for this account to sign in again. ' : ''}{entry.lastError ?? 'Waiting to send.'}</p><div class="row">
            <button class="btn" disabled={entry.lastStatus === 401} onclick={() => void action(() => outbox.retry(entry.id))}>Retry</button>
            <button class="btn" onclick={() => void action(() => outbox.discard(entry.id))}>Discard</button>
          </div></li>
        {/each}</ul>
      </details>
    {/if}
    {#if error}<p class="error" role="status">{error}</p>{/if}
  </aside>
{/if}
<style>
  aside {flex:none;max-height:160px;overflow:auto;overflow-wrap:anywhere;margin:4px 8px;padding:6px;}
  p {margin:0;} ul {margin:4px 0;padding-left:18px;} li {margin:4px 0;} .row {gap:4px;}
</style>
