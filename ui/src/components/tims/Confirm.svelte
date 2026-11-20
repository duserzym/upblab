<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { openOverlay, closeOverlay } from '../../lib/overlays.svelte';
  let { title, text, busy = false, confirm, cancel }: { title: string; text: string; busy?: boolean; confirm: () => void; cancel: () => void } = $props();
  const id = `tims-confirm-${crypto.randomUUID()}`;
  let cancelButton = $state<HTMLButtonElement>();
  $effect.pre(() => { openOverlay(id); });
  $effect(() => { void tick().then(() => cancelButton?.focus()); });
  onDestroy(() => closeOverlay(id));
</script>
<svelte:window onkeydown={e => { if (e.key === 'Escape' && !busy) cancel(); }} />
<div class="backdrop"><div role="dialog" aria-modal="true" aria-label={title} class="glass panel stack" tabindex="-1" onkeydown={e => { if (e.key === 'Tab') { const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')); const at = buttons.indexOf(document.activeElement as HTMLButtonElement); e.preventDefault(); buttons[(at + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus(); } }}>
<h2>{title}</h2><p>{text}</p><div class="row"><button class="btn" type="button" disabled={busy} bind:this={cancelButton} onclick={cancel}>Cancel</button><button class="btn primary" type="button" disabled={busy} onclick={confirm}>Confirm</button></div>
</div></div>
<style>.backdrop{position:fixed;inset:0;z-index:100;background:color-mix(in srgb,var(--text) 25%,transparent);display:grid;place-items:center;padding:16px}.panel{width:min(36rem,100%);max-height:calc(100vh - 32px);overflow:auto;overflow-wrap:anywhere;background:var(--bg);padding:16px}h2,p{margin:0}</style>
