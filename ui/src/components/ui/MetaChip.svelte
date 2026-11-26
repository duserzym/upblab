<!-- Usage: <MetaChip text="Recipe" icon="flask" info="Provenance" infoLabel="About the recipe name" />. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon, { type IconName } from './Icon.svelte';
  let { text, icon, info, infoLabel }: { text: string; icon?: IconName | Snippet; info?: string; infoLabel?: string } = $props();
  const uid = $props.id();
  let hovered = $state(false), focused = $state(false), pinned = $state(false), dismissed = $state(false);
  const open = $derived(!dismissed && (hovered || focused || pinned));
</script>
<svelte:window onkeydown={event => { if (event.key === 'Escape' && open) { pinned = false; dismissed = true; } }} />
<span class="meta">
  {#if typeof icon === 'string'}<Icon kind={icon} />{:else if icon}{@render icon()}{/if}
  <span class="text" title={text}>{text}</span>
  {#if info}
    <button type="button" aria-label={infoLabel ?? `About ${text}`} aria-describedby={open ? uid : undefined}
      aria-expanded={open} onmouseenter={() => { hovered = true; dismissed = false; }} onmouseleave={() => { hovered = false; }}
      onfocus={() => { focused = true; dismissed = false; }} onblur={() => { focused = false; pinned = false; }}
      onclick={() => { pinned = !pinned; dismissed = false; }}><Icon kind="info" /></button>
    {#if open}<span class="tooltip" role="tooltip" id={uid}>{info}</span>{/if}
  {/if}
</span>
<style>
  .meta { position: relative; display: inline-flex; align-items: center; min-width: 0; max-width: 100%; height: 26px; gap: 4px; padding: 2px 6px; border: 1px solid var(--hairline); border-radius: var(--radius-sm); color: var(--text-muted); background: var(--glass); font-size: 12px; }
  .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { display: inline-flex; flex: none; border: 0; background: transparent; color: var(--text-muted); padding: 0; border-radius: 50%; cursor: pointer; }
  button:active { background-image: linear-gradient(var(--press), var(--press)); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .tooltip { position: absolute; top: calc(100% + 4px); left: 0; z-index: 6; width: 260px; max-width: calc(100vw - 32px); padding: 6px 8px; white-space: normal; overflow-wrap: anywhere; color: var(--text); background: var(--bg); border: 1px solid var(--hairline); border-radius: var(--radius-sm); box-shadow: var(--glass-shadow); }
</style>
