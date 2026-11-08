<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Sort } from '../../lib/home';
  let { section, query = $bindable(''), sort = $bindable<Sort>('newest'), count, total, loaded, refresh, showAll, busy = false, options }:
    { section: string; query?: string; sort?: Sort; count: number; total: number; loaded: number; refresh?: () => void; showAll?: () => void; busy?: boolean; options?: Snippet } = $props();
</script>
<div class="toolbar row">
  <h2>{section}</h2>
  <span class="muted small count">{count} of {total}</span>
  <span class="spacer"></span>
  <input type="search" placeholder="Search {section.toLowerCase()}" aria-label="Search {section.toLowerCase()}" bind:value={query} />
  <select aria-label="Sort {section.toLowerCase()}" bind:value={sort}>
    <option value="newest">Newest</option><option value="oldest">Oldest</option>
    <option value="az">Name A-Z</option><option value="za">Name Z-A</option>
  </select>
  {@render options?.()}
  {#if showAll}<button class="btn small" disabled={busy} onclick={showAll}>Show all</button>{/if}
  {#if refresh}<button class="btn small" disabled={busy} onclick={refresh}>{busy ? 'Refreshing…' : 'Refresh'}</button>{/if}
</div>
{#if loaded < total}
  <p class="faint small scope">Latest {loaded} of {total} · searching the latest {loaded}; Show all to search all {total}.</p>
{/if}
<style>
  .toolbar { flex-wrap: wrap; gap: var(--space-2); min-width: 0; }
  h2 { margin: 0; }
  input { width: 12rem; max-width: 100%; padding: var(--space-1) var(--space-2); font-size: 0.85rem; }
  select { padding: var(--space-1) var(--space-2); font-size: 0.85rem; }
  .scope { margin: 0; }
  .count { white-space: nowrap; }
  @media (max-width: 1100px) { input { width: 10rem; } }
</style>
