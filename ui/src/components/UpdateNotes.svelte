<script lang="ts">
  import { isDesktop, openExternal } from '../lib/platform';
  import { releaseNotesUrl } from '../lib/release-notes';
  import type { UpdateStatus } from '../lib/updates';
  let { status }: { status: UpdateStatus } = $props();
</script>

{#if status.kind === 'available' || status.kind === 'ready'}
  {#if status.info.notes}<p class="small notes" data-testid="update-notes">{status.info.notes}</p>{/if}
  <a class="small" href={releaseNotesUrl(status.info.version)} target="_blank" rel="noreferrer" onclick={(event) => {
    if (isDesktop) { event.preventDefault(); void openExternal(releaseNotesUrl(status.info.version)); }
  }}>Release notes</a>
{/if}

<style>
  .notes { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; line-clamp: 4; overflow: hidden; line-height: 1.4; max-height: 5.6em; }
</style>
