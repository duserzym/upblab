<script lang="ts">
  import { untrack } from 'svelte';
  import { identity } from '../lib/identity.svelte';
  import { oversight } from '../lib/oversight.svelte';
  import { samples, projects, ownerName } from '../lib/records.svelte';
  import { shell } from '../lib/shell.svelte';
  let { active }: { active: boolean } = $props();
  $effect(() => {
    if (!active) return;
    void identity.revision; void identity.target?.server; JSON.stringify(oversight.filters);
    untrack(() => { void samples.load(); void projects.load(); });
  });
</script>
{#if identity.signedIn}
  {#each ['samples', 'projects'] as kind (kind)}
    {@const list = kind === 'samples' ? samples : projects}
    <section class="glass panel stack records" aria-label={kind === 'samples' ? 'Samples' : 'Projects'}>
      <div class="row"><h2>{kind === 'samples' ? 'Samples' : 'Projects'}</h2><span class="muted small">{list.rows.length} shown</span><span class="spacer"></span>
        <button class="btn small" disabled={list.loading} onclick={() => void list.load(false, { force: true })}>Refresh {kind}</button></div>
      <p class="muted small">Open in UPbDB to see details and edit.</p>
      {#if list.error}<p class="error small" role="alert">{list.error}</p>{/if}
      {#if !list.rows.length}<p class="muted small">{list.loading ? `Loading ${kind}…` : `No ${kind} match these filters.`}</p>{/if}
      <div class="record-rows" data-testid="{kind}-list">
        {#each list.rows as row (row.id)}
          {@const name = 'code' in row ? row.code : row.name}
          <div class="record-row" data-testid="{kind}-row">
            <button class="btn small" onclick={() => void shell.handleLink(`upbdb://${kind === 'samples' ? 'sample' : 'project'}/${row.id}`, 'home')}>{name}</button>
            {#if ownerName(row)}<span class="small muted">Owner: {ownerName(row)}</span>{/if}
            <span class="small faint">{'title' in row ? row.title : 'material' in row ? row.material : ''}</span>
          </div>
        {/each}
      </div>
      {#if list.cursor}<button class="btn small" disabled={list.loading} onclick={() => void list.load(true)}>Show more {kind}</button>{/if}
    </section>
  {/each}
{/if}
<style>
  .records { min-width: 0; gap: var(--space-2); }
  h2, p { margin: 0; }
  .record-rows { max-height: 18rem; overflow: auto; min-width: 0; }
  .record-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2) var(--space-4); padding: var(--space-1); border-bottom: 1px solid var(--glass-edge); overflow-wrap: anywhere; }
  .record-row > * { min-width: 0; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
</style>
