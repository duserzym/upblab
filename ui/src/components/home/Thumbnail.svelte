<script lang="ts">
  let { sources = [], label, onvisible }: { sources?: string[]; label: string; onvisible?: () => void } = $props();
  let element: HTMLDivElement;
  $effect(() => {
    if (!onvisible) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        onvisible?.();
      }
    }, { rootMargin: '200px' });
    observer.observe(element);
    return () => observer.disconnect();
  });
  let failures = $state.raw(new Set<string>());
  $effect(() => { void sources; failures = new Set(); });
  const images = $derived(sources.filter(src => !failures.has(src)));
</script>

<div class="thumbnail" bind:this={element}>
  {#if images.length}
    <div class="overview" role="img" aria-label="Atlas overview for {label}"
      style:grid-template-columns={`repeat(${Math.ceil(Math.sqrt(images.length))}, minmax(0, 1fr))`}>
      {#each images as src (src)}
        <img {src} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => failures = new Set([...failures, src])} />
      {/each}
    </div>
  {:else}
    <svg viewBox="0 0 80 45" fill="none" stroke="currentColor" stroke-width="1.3" role="img" aria-label="No thumbnail for {label}">
      <ellipse cx="40" cy="22.5" rx="21" ry="17"/><path d="m29 15 6-3 5 5-4 6-6-1Zm16 9 6-4 5 5-3 7-7-1Z"/>
    </svg>
  {/if}
</div>
<style>
  .thumbnail {width:5.6rem;aspect-ratio:16 / 9;flex:none;overflow:hidden;border-radius:var(--radius-sm);
    background:var(--plot-bg);color:var(--text-faint);border:1px solid var(--hairline);}
  .overview {display:grid;grid-auto-rows:minmax(0, 1fr);width:100%;height:100%;gap:1px;padding:1px;background:var(--hairline);}
  img,svg {display:block;width:100%;height:100%;object-fit:contain;}
  img {filter:brightness(1.4) contrast(0.84);}
</style>
