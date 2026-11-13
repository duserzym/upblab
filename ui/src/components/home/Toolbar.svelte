<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Sort } from '../../lib/home';
  let { section, query = $bindable(''), sort = $bindable<Sort>('newest'), count, total, progress, cap, refresh, busy = false, options }:
    { section: string; query?: string; sort?: Sort; count: number; total: number; progress?: string; cap?: { shown: number; total: number; loadRest: () => void }; refresh?: () => void; busy?: boolean; options?: Snippet } = $props();
</script>
<div class="toolbar row">
  <h2>{section}</h2>
  <span class="muted small count">{total}</span>
  {#if query.trim()}<span class="muted small">{count} matching</span>{/if}
  {#if progress}<span class="muted small" role="status">{progress}</span>{/if}
  <span class="spacer"></span>
  <input type="search" placeholder="Search {section.toLowerCase()}" aria-label="Search {section.toLowerCase()}" bind:value={query} />
  <select aria-label="Sort {section.toLowerCase()}" bind:value={sort}>
    <option value="newest">Newest</option><option value="oldest">Oldest</option>
    <option value="az">Name A-Z</option><option value="za">Name Z-A</option>
  </select>
  {@render options?.()}
  {#if refresh}<button class="btn small" disabled={busy} onclick={refresh}>{busy ? 'Refreshing…' : 'Refresh'}</button>{/if}
</div>
{#if cap && cap.shown < cap.total}
  <p class="muted small scope">Showing {cap.shown} of {cap.total} · <button class="btn small" disabled={busy} onclick={cap.loadRest}>Load the rest</button></p>
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
