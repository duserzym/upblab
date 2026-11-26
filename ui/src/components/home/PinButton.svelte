<script lang="ts">
  import IconButton from '../ui/IconButton.svelte';
  let { label, pinned, toggle }: { label: string; pinned: boolean; toggle: () => void } = $props();
</script>
<span class="pin"><IconButton size="small" icon="pin" aria-pressed={pinned} label={`${pinned ? 'Unpin' : 'Pin'} ${label}`} onclick={toggle} /></span>
<style>.pin { position: relative; z-index: 1; display: inline-flex; flex: none; }</style>
