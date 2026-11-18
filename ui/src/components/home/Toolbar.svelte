<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Sort } from '../../lib/home';
  let { section, query = $bindable(''), sort = $bindable<Sort>('newest'), count, total, summary, filtered = false, progress, cap, refresh, busy = false, options, collapsed = false, controls, toggle }:
    { section: string; query?: string; sort?: Sort; count: number; total: number; summary?: string; filtered?: boolean; progress?: string; cap?: { shown: number; total: number; hasMore?: boolean; loadRest: () => void }; refresh?: () => void; busy?: boolean; options?: Snippet; collapsed?: boolean; controls?: string; toggle?: () => void } = $props();
</script>
<div class="toolbar row">
  {#if toggle}
    <button class="btn small disclosure" aria-expanded={!collapsed} aria-controls={controls}
      aria-label="{collapsed ? 'Expand' : 'Collapse'} {section}" onclick={toggle}>
      <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
    </button>
  {/if}
  <h2>{section}</h2>
  <span class="muted small count">{total}{summary ? ` · ${summary}` : ''}</span>
  {#if query.trim() || filtered}<span class="muted small">{count} matching</span>{/if}
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
{#if cap && (cap.shown < cap.total || cap.hasMore)}
  <p class="muted small scope">Showing {cap.shown}{cap.hasMore ? ' · More available' : ` of ${cap.total}`} · <button class="btn small" disabled={busy} onclick={cap.loadRest}>{cap.hasMore ? 'Load more' : 'Load the rest'}</button></p>
{/if}
<style>
  .toolbar { flex-wrap: wrap; gap: var(--space-2); min-width: 0; }
  h2 { margin: 0; }
  input { width: 12rem; max-width: 100%; padding: var(--space-1) var(--space-2); font-size: 0.85rem; }
  select { padding: var(--space-1) var(--space-2); font-size: 0.85rem; }
  .scope { margin: 0; }
  .count { white-space: nowrap; }
  .disclosure { justify-content: center; padding: 0 var(--space-1); min-width: 1.6rem; min-height: 1.6rem; }
  @media (max-width: 1100px) { input { width: 10rem; } }
</style>
