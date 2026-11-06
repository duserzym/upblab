<script lang="ts">
  let { src, label }: { src?: string | null; label: string } = $props();
  let failed = $state(false);
  $effect(() => { void src; failed = false; });
</script>
<div class="thumbnail">
  {#if src && !failed}
    <img {src} alt="Atlas thumbnail for {label}" loading="lazy" referrerpolicy="no-referrer" onerror={() => (failed = true)} />
  {:else}
    <svg viewBox="0 0 80 45" fill="none" stroke="currentColor" stroke-width="1.3" role="img" aria-label="No thumbnail for {label}">
      <ellipse cx="40" cy="22.5" rx="21" ry="17"/><path d="m29 15 6-3 5 5-4 6-6-1Zm16 9 6-4 5 5-3 7-7-1Z"/>
    </svg>
  {/if}
</div>
<style>
  .thumbnail { width: 5.6rem; aspect-ratio: 16 / 9; flex: none; overflow: hidden; border-radius: var(--radius-sm); background: var(--plot-bg); color: var(--text-faint); border: 1px solid var(--hairline); }
  img, svg { display: block; width: 100%; height: 100%; object-fit: cover; }
</style>
