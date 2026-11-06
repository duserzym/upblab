<script lang="ts">
  let { kind }: { kind: 'folder' | 'files' | 'session' | 'images' } = $props();
</script>
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if kind === 'folder'}<path d="M3 7V5h6l2 2h10v13H3Z"/><path d="M3 10h18"/>
  {:else if kind === 'files'}<path d="M8 3h8l4 4v14H8Z"/><path d="M16 3v5h4M4 7v14M11 12h6M11 16h6"/>
  {:else if kind === 'session'}<path d="M3 20h18M5 16v-4M10 16V8M15 16v-5M20 16V5M6 4h6M9 1v6"/>
  {:else}<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-4 4 3 4-6 5 7"/>{/if}
</svg>
<style>svg { width: 1.8rem; height: 1.8rem; flex: none; color: var(--accent); }</style>
