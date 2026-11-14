<script lang="ts">
  import { publishImagesPresentation } from '../lib/incoming';
  import ModuleSurface from './ModuleSurface.svelte';
  import { shell } from '../lib/shell.svelte';
  let { active, layoutKey }: { active: boolean; layoutKey: string } = $props();
  $effect(() => { if (active) void publishImagesPresentation(); });
</script>
<section class="view" class:hidden={!active} aria-label="Atlas viewer">
  {#if shell.atlas}
    <ModuleSurface module="images" title="grainatlas" home={shell.homeUrl('images')} target={shell.targets.images} {active} {layoutKey} />
  {:else}
    <div class="panel stack"><p class="muted">No grainatlas viewer build pinned yet.</p></div>
  {/if}
</section>
