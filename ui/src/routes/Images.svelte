<script lang="ts">
  import { publishImagesPresentation } from '../lib/incoming';
  import { atlasSync, statusLabel } from '../lib/atlas-sync.svelte';
  import { apps, editInAtlas } from '../lib/apps.svelte';
  import { review } from '../lib/review.svelte';
  import { isDesktop } from '../lib/platform';
  import ModuleSurface from '../components/ModuleSurface.svelte';
  import { shell } from '../lib/shell.svelte';

  let { active, layoutKey }: { active: boolean; layoutKey: string } = $props();
  $effect(() => {
    if (active) void publishImagesPresentation();
  });
  const atlas = $derived(shell.atlas);
  let busy = $state(false), error = $state('');
  async function openStandalone() {
    const status = atlasSync.status;
    if (!atlasSync.v4 || !status || busy) return;
    busy = true; error = '';
    try {
      const spot = review.selected?.atlasProjectId === status.project ? review.selected : null;
      await editInAtlas({ project: status.project, mount: status.mount, spot: spot?.atlasSpotId, revision: status.revision ?? undefined }, 'images');
      if (apps.atlas?.from === 'images') error = apps.atlas.message;
    } catch (err) { error = String(err); }
    finally { busy = false; }
  }
</script>

<section class="view images-view" class:hidden={!active}>
  {#if shell.view === 'images' && atlasSync.v4 && atlasSync.status}
    <div class="atlas-strip row" data-testid="atlas-status-strip">
      <strong class="project" title={atlasSync.status.name}>{atlasSync.status.name}</strong>
      <span class="small status-text" title={statusLabel(atlasSync.status)}>{statusLabel(atlasSync.status)}</span>
      {#if atlasSync.note}<span class="small launch-error" role="status" title={atlasSync.note}>{atlasSync.note}</span>{/if}
      {#if error}<span class="error small launch-error" role="status" title={error}>{error}</span>{/if}
      {#if isDesktop}<button class="btn small" disabled={busy} onclick={openStandalone}>{busy ? 'Opening…' : 'Edit in grainatlas'}</button>{/if}
    </div>
  {/if}
  {#if atlas}
    <ModuleSurface module="images" title="grainatlas" home={shell.homeUrl('images')} target={shell.targets.images} {active} {layoutKey} />
  {:else}
    <div class="center">
      <div class="glass panel card stack">
        <h2>No grainatlas build pinned yet</h2>
        <p class="muted">
          The Images tab hosts a pinned build of grainatlas, the SEM mosaic, segmentation and spot tool. The shell
          bundles that build from <code>modules.lock.json</code>; none has been fetched into this copy of UPb Lab.
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

<style>
  .atlas-strip { flex: 0 0 36px; height: 36px; min-height: 0; min-width: 0; padding: 2px var(--space-3); border-bottom: 1px solid var(--glass-edge); gap: var(--space-2); }
  .project { flex: 0 1 16rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8rem; }
  .status-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .launch-error { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { flex: 0 0 auto; margin-left: auto; }
</style>
