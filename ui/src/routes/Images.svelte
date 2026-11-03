<script lang="ts">
  import ModuleSurface from '../components/ModuleSurface.svelte';
  import { shell } from '../lib/shell.svelte';

  let { active }: { active: boolean } = $props();
  const atlas = $derived(shell.atlas);
</script>

<section class="view" class:hidden={!active}>
  {#if atlas}
    <ModuleSurface module="images" title="grainatlas" home={shell.homeUrl('images')} target={shell.targets.images} {active} />
  {:else}
    <div class="center">
      <div class="glass panel card stack">
        <h2>No grainatlas build pinned yet</h2>
        <p class="muted">
          The Images tab hosts a pinned build of grainatlas, the SEM mosaic, segmentation and spot tool. The shell
          bundles that build from <code>modules.lock.json</code>; none has been fetched into this copy of UPb Studio.
        </p>
        <ul class="muted small">
          <li>Developers: build grainatlas's web UI, then run <code>make fetch-modules</code> here and restart.</li>
          <li>Releases will ship with the build included.</li>
        </ul>
        {#if shell.targets.images}
          <p class="small">Waiting to open <code>{shell.targets.images.url}</code> once a build is installed.</p>
        {/if}
      </div>
    </div>
  {/if}
</section>
