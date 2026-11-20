<script lang="ts">
  import { untrack } from 'svelte';
  import { identity } from '../../lib/identity.svelte';
  import { read, type SourceOut } from '../../lib/tims-api';
  import { grainOutline, sourceGeometry, type MountGeometry } from '../../lib/tims-geometry';
  import { grainCrop, type GrainCrop } from '../../lib/tims-grain-image';
  import { grainImages, grainTiles, type AtlasListing, type PublishedGrainAtlas } from '../../lib/tims-grain-image-cache';
  import { grainImageScope, mountElements } from '../../lib/tims-requests';

  let { source, mount, size = 72, lazy = false, loadGeometry = false, enabled = true, geometryError = '' }: {
    source?: SourceOut; mount?: MountGeometry; size?: number; lazy?: boolean; loadGeometry?: boolean; enabled?: boolean; geometryError?: string;
  } = $props();
  const uid = $props.id();
  const clipId = `${uid}-grain`;
  let visible = $state(false), fetched = $state.raw<MountGeometry>(), crop = $state.raw<GrainCrop | null>(null);
  let published = $state.raw<PublishedGrainAtlas | null>(null), reason = $state('Loading published grain image…'), loaded = $state(0);
  const geometry = $derived(mount ?? fetched);
  const elements = $derived(sourceGeometry(source, geometry));
  const outline = $derived(grainOutline(elements.grain?.polygon_um, elements.spot));
  const scope = $derived(grainImageScope());
  const title = $derived(crop && loaded === crop.tiles.length ? 'Published SEM image, segmented grain outline and LA spot' : reason);
  const dotRadius = $derived(crop ? Math.max(...crop.viewBox.split(' ').slice(2).map(Number)) / size * 2.5 : 4);

  function observe(node: SVGSVGElement) {
    if (!lazy || typeof IntersectionObserver === 'undefined') { visible = true; return; }
    const observer = new IntersectionObserver(entries => { visible = entries.some(e => e.isIntersecting); });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }
  function tile(node: SVGImageElement, input: { url: string; ok: () => void; fail: () => void }) {
    let release: (() => void) | undefined;
    let disposed = false;
    const done = () => { release?.(); release = undefined; };
    const ok = () => { done(); if (!disposed) input.ok(); };
    const fail = () => { done(); if (!disposed) input.fail(); };
    node.addEventListener('load', ok); node.addEventListener('error', fail);
    const cancel = grainTiles.add(finish => {
      release = finish;
      if (disposed) { done(); return; }
      node.setAttribute('fetchpriority', 'low');
      node.setAttribute('href', input.url);
    });
    return { destroy() { disposed = true; cancel(); node.removeEventListener('load', ok); node.removeEventListener('error', fail); node.removeAttribute('href'); done(); } };
  }
  $effect(() => {
    const owner = scope, src = source, provided = mount, allowed = enabled, inView = visible, issue = geometryError;
    let disposed = false, retried = false;
    untrack(() => { fetched = undefined; crop = null; published = null; loaded = 0; reason = !src?.mount_id ? 'No source mount or grain is recorded.' : issue && !provided ? `Outline fallback: mount geometry could not be loaded: ${issue}` : 'Loading published grain image…'; });
    const current = () => !disposed && owner === grainImageScope();
    async function load(failed?: PublishedGrainAtlas) {
      if (!src?.mount_id || !current()) return;
      try {
        const value = provided ?? (loadGeometry ? await mountElements(src.mount_id) : undefined);
        if (!current()) return;
        fetched = value;
        const { grain, spot } = sourceGeometry(src, value);
        if (!grain?.polygon_um || !grainOutline(grain.polygon_um)) throw new Error('No segmented grain polygon is available.');
        const image = await grainImages.published(owner, identity.target!.server, src.mount_id, () => read<AtlasListing>(`/v1/mounts/${encodeURIComponent(src.mount_id!)}/atlas`), failed);
        if (!current()) return;
        if (grain.project_uuid && grain.project_uuid !== image.listing.current?.project_id) throw new Error('The grain belongs to a different atlas project.');
        const next = grainCrop(image.atlas, grain, spot, size, window.devicePixelRatio || 1);
        published = image; loaded = 0; reason = 'Loading published grain tiles…'; crop = next;
      } catch (error) { if (current()) { crop = null; reason = `Outline fallback: ${String(error instanceof Error ? error.message : error)}`; } }
    }
    // Only a mounted visible crop starts metadata reads; batch/element reads finish first.
    if (allowed && inView && (provided || loadGeometry)) untrack(() => { void load(); });
    failedTile = () => {
      if (!current()) return;
      const failed = published;
      crop = null; reason = 'Outline fallback: a published tile could not be loaded (offline, unavailable or access expired).';
      if (!retried && failed) { retried = true; void load(failed); }
    };
    return () => { disposed = true; };
  });
  let failedTile: () => void = () => {};
</script>

<svg use:observe width={size} height={size} viewBox={crop?.viewBox ?? '0 0 100 100'} preserveAspectRatio="xMidYMid meet" role="img" aria-label={crop || outline ? 'Grain outline and LA spot' : 'No grain geometry'} style={`--grain-size:${size}px`} data-testid="tims-grain-image" data-image-state={crop ? loaded === crop.tiles.length ? 'ready' : 'loading' : 'fallback'}>
  <title>{title}</title>
  {#if crop && published}
    <defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse"><polygon points={crop.points} /></clipPath></defs>
    <polygon class="body" points={crop.points} />
    <g clip-path={`url(#${clipId})`}>
      {#each crop.tiles as item (published.url(item.path))}
        <image x={item.x} y={item.y} width={item.width} height={item.height} preserveAspectRatio="none" use:tile={{ url: published.url(item.path), ok: () => loaded++, fail: () => failedTile() }} />
      {/each}
    </g>
    <polygon class="outline" points={crop.points} />
    {#if crop.spot}<circle class:dot={crop.spot.radius === null} cx={crop.spot.x} cy={crop.spot.y} r={crop.spot.radius ?? dotRadius} />{/if}
  {:else if outline}
    <polygon class="body" points={outline.points} /><polygon class="outline" points={outline.points} />
    {#if outline.dot}<circle class:dot={outline.radius === undefined} cx={outline.dot[0]} cy={outline.dot[1]} r={outline.radius ?? 4} />{/if}
  {:else}<rect x="20" y="20" width="60" height="60" rx="12" /><text x="50" y="58" text-anchor="middle">—</text>{/if}
</svg>
<style>
  svg{display:block;width:var(--grain-size);max-width:100%;height:auto;aspect-ratio:1;flex-shrink:0}
  .body{fill:var(--accent-soft)}.outline{fill:none;stroke:var(--text-muted);stroke-width:.8;vector-effect:non-scaling-stroke}
  circle{fill:none;stroke:var(--danger);stroke-width:1.5;vector-effect:non-scaling-stroke}.dot{fill:var(--danger);stroke:none}
  rect{fill:var(--hairline)}text{fill:var(--text-muted)}
</style>
