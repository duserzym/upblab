<!-- Usage: <Icon kind="refresh" />; decorative, inherits the control's colour. -->
<script module lang="ts">
  export type IconName = 'refresh' | 'edit' | 'history' | 'person' | 'flask' | 'building' | 'info' | 'check' | 'chevron-left' | 'calendar' | 'rows' | 'lanes' | 'chevron-right' | 'close' | 'more' | 'maximize' | 'restore' | 'zoom-in' | 'zoom-out' | 'fit' | 'hide' | 'show' | 'pin' | 'settings';
</script>
<script lang="ts">
  let { kind }: { kind: IconName } = $props();
</script>
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if kind === 'refresh'}<path d="M20 7v5h-5M4 17v-5h5M5.5 7a7 7 0 0 1 12-2L20 8M4 16l2.5 3a7 7 0 0 0 12-2" />
  {:else if kind === 'edit'}<path d="m4 16 12-12 4 4L8 20H4ZM14 6l4 4" />
  {:else if kind === 'history'}<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  {:else if kind === 'person'}<circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" />
  {:else if kind === 'flask'}<path d="M9 3h6M10 3v7L4 19q-1 2 2 2h12q3 0 2-2l-6-9V3M7 15h10" />
  {:else if kind === 'building'}<path d="M3 21h18M5 21V7l7-4 7 4v14M9 8h1m4 0h1M9 12h1m4 0h1M10 21v-5h4v5" />
  {:else if kind === 'info'}<circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" />
  {:else if kind === 'check'}<path d="m5 12 4 4L19 6" />
  {:else if kind === 'chevron-left'}<path d="m15 5-7 7 7 7" />
  {:else if kind === 'chevron-right'}<path d="m9 5 7 7-7 7" />
  {:else if kind === 'close'}<path d="m6 6 12 12M18 6 6 18" />
  {:else if kind === 'more'}<path d="M5 12h.01M12 12h.01M19 12h.01" />
  {:else if kind === 'maximize'}<path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5" />
  {:else if kind === 'restore'}<path d="M9 4v5H4m16 6h-5v5M9 9 4 4m11 11 5 5" />
  {:else if kind === 'zoom-in' || kind === 'zoom-out'}<circle cx="10" cy="10" r="6" /><path d="m15 15 6 6M7 10h6" />{#if kind === 'zoom-in'}<path d="M10 7v6" />{/if}
  {:else if kind === 'fit'}<path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5M8 12h8m-4-4v8" />
  {:else if kind === 'show' || kind === 'hide'}<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{#if kind === 'hide'}<path d="m3 3 18 18" />{/if}
  {:else if kind === 'pin'}<path d="M8 3h8l-1 6 3 4v2h-5v6l-1 1-1-7H6v-2l3-4Z" />
  {:else if kind === 'settings'}<path d="m9 3-1 3-3 1-2 4 2 2 1 4 3 1 2 3 4-1 1-3 3-1 2-4-2-2-1-4-3-1-2-3Z" /><circle cx="12" cy="12" r="3" />
  {:else if kind === 'calendar'}<rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 11h18M7 15h2m4 0h2M7 18h2" />
  {:else if kind === 'rows'}<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01" />
  {:else}<rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" />{/if}
</svg>
<style>svg { width: 18px; height: 18px; flex: none; display: block; }</style>
