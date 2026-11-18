<script lang="ts">
  import { oversight, READ_ONLY_REASON } from '../../lib/oversight.svelte';
  import { ownerName } from '../../lib/records.svelte';
  import { editInAtlas } from '../../lib/apps.svelte';
  import AtlasGuidance from '../AtlasGuidance.svelte';
  import PinButton from './PinButton.svelte';
  import Thumbnail from './Thumbnail.svelte';
  import { plural } from '../../lib/plural';
  import { overview, type MountRow } from '../../lib/overview.svelte';
  import { atlasStatus, mountHomeLink } from '../../lib/home';
  import { shell } from '../../lib/shell.svelte';
  import { review } from '../../lib/review.svelte';
  let { row, dense = false, pinned = false, togglePin }: { row: MountRow; dense?: boolean; pinned?: boolean; togglePin?: () => void } = $props();
  const atlas = $derived(row.atlas && row.atlas !== 'error' ? row.atlas : null);
  const status = $derived(atlasStatus(row));
  const label = $derived(row.mount.label);
  const atlasName = $derived(atlas?.name && atlas.name !== label ? `Atlas: ${atlas.name}` : '');
  const target = $derived(mountHomeLink(row, !!oversight.viewAs));
  const action = $derived(atlas && !oversight.viewAs ? `Open images for ${label}` : `Open mount details for ${label}`);
</script>
<article class="glass panel mount-card" class:dense data-testid="mount-card">
  <div class="summary">
    <Thumbnail sources={atlas ? row.thumbnails : []} label={label} onvisible={atlas ? () => void overview.loadThumbnails(row.mount.id) : undefined} />
    <div class="details">
      <button class="main" title={action} aria-label={action} onclick={() => void shell.handleLink(target, 'home')}><span class="key">{label}</span></button>
      <p class="muted small ellipsis atlas-name" title={atlasName || undefined}>{atlasName || (dense ? atlas ? 'Published images' : row.detailsPending ? 'Checking images…' : row.atlas === 'error' ? 'Published images unknown' : 'No published images' : '')}</p>
      {#if !dense}<p class="muted small ellipsis" title={row.mount.mount_type}>{row.mount.mount_type || 'Mount'}</p>{/if}
      {#if ownerName(row.mount)}<p class="muted small ellipsis">Owner: {ownerName(row.mount)}</p>{/if}
      <p class="small counts">{plural(row.mount.grain_count, 'grain')} · {plural(row.mount.spot_count, 'spot')}</p>
    </div>
    {#if togglePin}<PinButton {label} {pinned} toggle={togglePin} />{/if}
  </div>
  <div class="footer">
    <span class="badge small" class:published={!!atlas}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" role="img" aria-label={status.label} data-testid="atlas-symbol">
        <title>{status.label}</title>
        <rect x="5" y="3" width="16" height="14" rx="2" />
        <path d="M17 21H5a2 2 0 0 1-2-2V7" />
        {#if atlas}<circle cx="10" cy="8" r="1" /><path d="m6 15 5-5 3 3 2-2 4 4" />{/if}
      </svg>
      {status.text}
    </span>
    <div class="controls">
      {#if atlas}<button class="btn" disabled={!!oversight.viewAs} title={oversight.viewAs ? READ_ONLY_REASON : undefined} onclick={(e) => { e.stopPropagation(); void editInAtlas({ project: atlas!.projectId, mount: row.mount.id }, 'home'); }}>Edit in grainatlas</button>{/if}
      <button class="btn" onclick={(e) => { e.stopPropagation(); shell.show('review'); void review.open({ kind: 'mount', id: row.mount.id }); }}>Review</button>
    </div>
  </div>
  <AtlasGuidance mount={row.mount.id} from="home" />
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
  .atlas-name { height: 1.2rem; }
  p { margin: 0; }
  .counts, .badge { font-size: 0.74rem; }
  .footer { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1); }
  .badge { color: var(--text-muted); display: inline-flex; align-items: center; gap: var(--space-1); }
  .badge.published { color: var(--accent); }
  .badge svg { width: 1rem; height: 1rem; flex: none; }
  .controls { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: var(--space-1); margin-left: auto; }
  .btn { padding: 0.1rem var(--space-2); font-size: 0.74rem; }
  .dense { border: 0; border-bottom: 1px solid var(--hairline); border-radius: 0; background: transparent; padding: var(--space-2) 0; gap: var(--space-1); }
  .dense:hover { background: var(--row-hover); }
  .dense .summary :global(.thumbnail) { width: 3rem; }
  .dense .footer { min-height: 26px; }
</style>
