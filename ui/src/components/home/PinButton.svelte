<script lang="ts">
  let { label, pinned, toggle }: { label: string; pinned: boolean; toggle: () => void } = $props();
</script>
<button class="pin" aria-pressed={pinned} aria-label="{pinned ? 'Unpin' : 'Pin'} {label}" title="{pinned ? 'Unpin' : 'Pin'} {label}" onclick={toggle}>
  <svg viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m8 3 8 0-1 6 3 4v2h-5v6l-1 1-1-7H6v-2l3-4z" /></svg>
</button>
<style>
  .pin { position: relative; z-index: 1; display: inline-grid; place-items: center; flex: none; width: 26px; height: 26px; padding: 4px; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); cursor: pointer; }
  .pin:hover, .pin[aria-pressed='true'] { color: var(--accent); background: var(--accent-soft); }
  svg { width: 16px; height: 16px; }
</style>
