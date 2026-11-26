<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Sort } from '../../lib/home';
  let { section, query = $bindable(''), sort = $bindable<Sort>('newest'), count, total, summary, filtered = false, progress, cap, refresh, busy = false, options, compact = false, legend }:
    { section: string; query?: string; sort?: Sort; count: number; total: number; summary?: string; filtered?: boolean; progress?: string; cap?: { shown: number; total: number; hasMore?: boolean; loadRest: () => void }; refresh?: () => void; busy?: boolean; options?: Snippet; compact?: boolean; legend?: Snippet } = $props();
</script>
<header class="toolbar" class:compact>
  <div class="row toolbar-title">
  <h2>{section}</h2>
  <span class="muted small count">{total}{summary ? ` · ${summary}` : ''}</span>
  {#if query.trim() || filtered}<span class="muted small">{count} matching</span>{/if}
  {#if progress}<span class="muted small" role="status">{progress}</span>{/if}
  {@render legend?.()}
  </div>
  <div class="row toolbar-controls">
  <input type="search" placeholder="Search {section.toLowerCase()}" aria-label="Search {section.toLowerCase()}" bind:value={query} />
  <select aria-label="Sort {section.toLowerCase()}" bind:value={sort}>
    <option value="newest">Newest</option><option value="oldest">Oldest</option>
    <option value="az">Name A-Z</option><option value="za">Name Z-A</option>
  </select>
  {@render options?.()}
  {#if refresh}<button class="btn small" disabled={busy} onclick={refresh}>{busy ? 'Refreshing…' : 'Refresh'}</button>{/if}
  </div>
{#if cap && (cap.shown < cap.total || cap.hasMore)}
  <p class="muted small scope">Showing {cap.shown}{cap.hasMore ? ' · More available' : ` of ${cap.total}`} · <button class="btn small" disabled={busy} onclick={cap.loadRest}>{cap.hasMore ? 'Load more' : 'Load the rest'}</button></p>
{/if}
</header>
<style>
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); min-width: 0; flex: none; }
  .toolbar-title, .toolbar-controls { min-width: 0; gap: var(--space-1) var(--space-2); }
  .toolbar-controls { flex: 1; }
  h2 { margin: 0; }
  input { width: 12rem; max-width: 100%; padding: var(--space-1) var(--space-2); font-size: 0.85rem; }
  select { appearance: none; -webkit-appearance: none;
    min-width: max(9rem, 144px); height: max(2rem, 32px); min-height: max(2rem, 32px); padding: var(--space-1) 2rem var(--space-1) var(--space-3); font-size: 0.9rem; line-height: 1.25rem;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    background-image: linear-gradient(45deg, transparent 50%, var(--text-muted) 50%), linear-gradient(135deg, var(--text-muted) 50%, transparent 50%);
    background-position: calc(100% - 1rem - 4px) 50%, calc(100% - 1rem) 50%; background-size: 4px 4px; background-repeat: no-repeat; }
  option { padding: 6px 10px; min-height: 28px; }
  .scope { margin: 0; }
  .count { white-space: nowrap; }
  @media (max-width: 1100px) { input { width: 10rem; } }
  .compact { display: block; }
  .compact .toolbar-title { margin-bottom: var(--space-1); }
  .compact .toolbar-controls { column-gap: var(--space-1); }
  .compact h2 { font-size: 1rem; }
  .compact input { flex: 1 1 8rem; width: 0; min-width: max(8rem, 128px); }
  .compact :global(.btn), .compact :global(.chip) { font-size: 0.74rem; padding-inline: var(--space-1); white-space: nowrap; }
</style>
