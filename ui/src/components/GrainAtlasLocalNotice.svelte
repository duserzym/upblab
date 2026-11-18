<script lang="ts">
  import { connectivity } from '../lib/connectivity.svelte';
  let { active, view }: { active: boolean; view: 'home' | 'review' } = $props();
</script>
{#if active && connectivity.offlineCopy && connectivity.grainAtlasLocal === view}
  <p class="small muted" role="status" data-testid="grainatlas-local-notice">GrainAtlas opens without the server while UPb Lab shows a read-only copy, so your edits stay in GrainAtlas's local drafts.</p>
{/if}
