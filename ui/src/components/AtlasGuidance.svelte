<script lang="ts">
  import { apps, showInImages } from '../lib/apps.svelte';
  let { mount, from }: { mount: string | null; from: string } = $props();
  const request = $derived(apps.atlas);
</script>
{#if request?.state === 'missing' && request.from === from && request.target.mount === mount}
  <div class="panel stack small" role="status">
    <strong>GrainAtlas is not installed</strong>
    <p>{request.message}</p>
    <p>On macOS, install GrainAtlas into /Applications or ~/Applications. On Windows, install it in one of the locations above.</p>
    <button class="btn" onclick={() => void showInImages(request!.target, from)}>Show in Images</button>
  </div>
{/if}
<style>
  .panel {position:relative;z-index:1;min-width:0;overflow-wrap:anywhere;} p {margin:0;}.btn {white-space:normal;}
</style>
