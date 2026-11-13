<script lang="ts">
  import Thumbnail from './Thumbnail.svelte';
  import { overview, type MountRow } from '../../lib/overview.svelte';
  import { day } from '../../lib/home';
  import { shell } from '../../lib/shell.svelte';
  import { review } from '../../lib/review.svelte';
  let { row, atlasOnly = false }: { row: MountRow; atlasOnly?: boolean } = $props();
  const atlas = $derived(row.atlas && row.atlas !== 'error' ? row.atlas : null);
  const label = $derived(atlasOnly ? atlas?.name ?? row.mount.label : row.mount.label);
  const target = $derived(atlas ? `grainatlas://project/${atlas.projectId}` : `laicpmsdb://mount/${row.mount.id}`);
  const action = $derived(atlasOnly ? `Open atlas ${label}` : atlas ? `Open images for ${label}` : `Open mount details for ${label}`);
</script>
<article class="glass panel mount-card" data-testid={atlasOnly ? 'atlas-card' : 'mount-card'}>
  <div class="summary">
    <Thumbnail sources={row.thumbnails} label={row.mount.label} onvisible={atlas ? () => void overview.loadThumbnails(row.mount.id) : undefined} />
    <div class="details">
      <button class="main" title={action} aria-label={action} onclick={() => void shell.handleLink(target, 'home')}><span class="key">{label}</span></button>
      <p class="muted small ellipsis" title={atlasOnly ? row.mount.label : row.mount.mount_type}>{atlasOnly ? row.mount.label : row.mount.mount_type || 'Mount'}</p>
      {#if !atlasOnly}<p class="small counts">{row.mount.grain_count} grains · {row.mount.spot_count} spots</p>{/if}
    </div>
  </div>
  <div class="footer">
    <span class="badge small" title={atlas?.name ?? undefined}>{atlas ? `atlas${atlas.version != null ? ` v${atlas.version}` : ''}${atlas.publishedAt ? ` · ${day(atlas.publishedAt)}` : ''}` : row.detailsPending ? 'checking atlas…' : row.atlas === 'error' ? 'atlas unavailable' : 'no atlas'}</span>
    {#if !atlasOnly}
      <div class="controls">
        <button class="btn" onclick={(e) => { e.stopPropagation(); shell.show('review'); void review.open({ kind: 'mount', id: row.mount.id }); }}>Review</button>
      </div>
    {/if}
  </div>
</article>
<style>
  .mount-card { position: relative; min-width: 0; padding: var(--space-2) var(--space-3); display: flex; flex-direction: column; gap: var(--space-1); box-shadow: none; }
  .mount-card:hover, .mount-card:focus-within { border-color: var(--accent); }
  .summary { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
  .details { min-width: 0; flex: 1; }
  .main { display: block; width: 100%; border: 0; background: none; padding: 0; text-align: left; font-weight: 600; color: var(--accent); cursor: pointer; }
  .key { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .main::after { content: ''; position: absolute; inset: 0; border-radius: var(--radius); }
  .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  p { margin: 0; }
  .counts, .badge { font-size: 0.74rem; }
  .footer { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1); }
  .badge { color: var(--text-muted); }
  .controls { position: relative; z-index: 1; display: flex; gap: var(--space-1); margin-left: auto; }
  .btn { padding: 0.1rem var(--space-2); font-size: 0.74rem; }
</style>
