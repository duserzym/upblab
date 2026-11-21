<script lang="ts">
  import { review } from '../../lib/review.svelte';
  import { regionSummary, regionLabel } from '../../lib/region-summary';
  const region = $derived(review.region);
  const summary = $derived(region ? regionSummary(region, review.regionRows, review.sessions, review.regionFractions) : null);
  const mountLabel = $derived(review.mounts.find(mount => mount.id === region?.mount)?.label ?? region?.mountLabel ?? 'Mount');
  const counts = $derived(summary ? [
    { label: 'Grains', value: summary.grains, title: 'Distinct grain ids, or grain labels when no id is stored, among the region’s spots.' },
    { label: 'Spots', value: summary.spots, title: 'Distinct physical spot ids, or atlas spot ids when no physical id is stored.' },
    { label: 'Analysed', value: summary.analysed, title: 'Distinct physical spots with at least one acquisition.' },
    { label: 'Plucked', value: summary.plucked, title: 'Distinct grains with an active TIMS fraction on the grain or one of its spots.' },
  ] : []);
</script>
{#if region && summary}
  <div class="stack region-summary" data-testid="region-summary">
    <header>
      <h2>{mountLabel}</h2>
      <p class="small">{regionLabel(region)}{' · '}{summary.spots} spots{#if region.kind !== 'mount' && region.spots.length !== summary.spots}{' '}(viewer listed {region.spots.length}){/if}</p>
      {#if review.regionBack}
        <button class="btn" onclick={() => review.regionBack && review.select(review.regionBack)}>Back to {review.regionBack.label}</button>
      {/if}
    </header>
    {#if review.regionLoading}<p class="small muted" role="status">Loading…</p>{/if}
    {#if review.regionError}<p class="small error" role="status">Could not read mount results: {review.regionError}</p>{/if}
    {#if summary.matchedBySample}<p class="small muted">matched by sample name</p>{/if}
    <dl class="counts">
      {#each counts as count}<div title={count.title}><dt>{count.label}</dt><dd>{count.value}</dd></div>{/each}
    </dl>
    <section>
      <h3>LA-ICP-MS sessions</h3>
      {#each summary.sessions as session}
        <div class="session small">
          <div><strong>{session.key}</strong><br /><span class="muted">{session.date} · {session.spots} spots</span></div>
          {#if review.scope?.kind === 'session' && review.scope.id === session.id}<span class="small muted">shown</span>
          {:else}<button class="btn" onclick={() => void review.open({ kind: 'session', id: session.id })}>Review session</button>{/if}
        </div>
      {:else}{#if !review.regionLoading && !review.regionError}<p class="small muted">No LA-ICP-MS analyses yet.</p>{/if}{/each}
    </section>
    <section>
      <h3>TIMS fractions</h3>
      {#if review.regionFractionNotice}<p class="small muted" role="status">{review.regionFractionNotice}</p>{/if}
      {#if summary.fractions.length}
        <ul class="small">{#each summary.fractions.slice(0, 20) as match}
          {@const grainLabel = match.source.grain_label || review.regionRows.find(row => row.grainId === match.source.grain_id && row.grainLabel)?.grainLabel}
          <li>{match.fraction.name || match.fraction.capsule_label || 'Unnamed fraction'}{' · '}{grainLabel ? `grain ${grainLabel}` : 'grain not linked'}</li>
        {/each}</ul>
        {#if summary.fractions.length > 20}<p class="small muted">and {summary.fractions.length - 20} more</p>{/if}
      {:else if !review.regionFractionNotice}<p class="small muted">None plucked</p>{/if}
    </section>
    <footer class="row wrap">
      {#if region.mount && !(review.scope?.kind === 'mount' && review.scope.id === region.mount)}
        <button class="btn" onclick={() => region?.mount && void review.open({ kind: 'mount', id: region.mount })}>Review this mount</button>
      {/if}
      <button class="btn" onclick={() => review.closeRegion()}>Close</button>
    </footer>
  </div>
{/if}
<style>
  .region-summary {gap:12px;min-width:0;}
  h2 {font-size:1rem;margin:0;} h3 {font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin:0 0 5px;}
  p {margin:3px 0;} .btn {font-size:0.72rem;padding:3px 8px;}
  .counts {display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin:0;}
  .counts div {text-align:center;background:var(--accent-soft);padding:6px 2px;border-radius:var(--radius-sm);}
  dt {font-size:0.7rem;color:var(--text-muted);} dd {margin:0;font-weight:600;}
  .session {display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 0;}
  .session div {min-width:0;} .session .btn {flex:none;} ul {margin:0;padding-left:16px;}
</style>
