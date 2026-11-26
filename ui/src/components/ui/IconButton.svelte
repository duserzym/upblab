<!-- Usage: <IconButton icon="refresh" label="Refresh batch" onclick={refresh} disabled={busy} />. -->
<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon, { type IconName } from './Icon.svelte';
  let { icon, label, title, disabled = false, size = 'normal', element = $bindable(), ...rest }: Omit<HTMLButtonAttributes, 'children' | 'aria-label'> & { icon: IconName; label: string; size?: 'small' | 'normal'; element?: HTMLButtonElement } = $props();
</script>
<button {...rest} bind:this={element} class:small={size === 'small'} type="button" aria-label={label} title={title ?? label} {disabled}><Icon kind={icon} /></button>
<style>
  button { display: inline-flex; justify-content: center; align-items: center; flex: none; width: 30px; height: 30px; padding: 0; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); cursor: pointer; transition: background var(--motion), border-color var(--motion); }
  button:hover:not(:disabled) { background: var(--row-hover); border-color: var(--hairline); }
  button:active:not(:disabled) { background-image: linear-gradient(var(--press), var(--press)); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button:disabled { opacity: .5; cursor: default; }
  .small { width: 24px; height: 24px; }
  button[aria-pressed=true] { color: var(--accent); background: var(--accent-soft); }
</style>
