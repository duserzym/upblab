<script lang="ts">
  import { openInStudio } from '../../lib/apps.svelte';
  import type { SessionRow } from '../../lib/overview.svelte';
  import MineralIcon from './MineralIcon.svelte';
  import { day, kindColor, kindLabel, kindSegments, runStatus } from '../../lib/home';
  import { shell } from '../../lib/shell.svelte';
  import { review } from '../../lib/review.svelte';
  let { row, maximum }: { row: SessionRow; maximum: number } = $props();
  const s = $derived(row.session);
  const status = $derived(runStatus(row));
  const segments = $derived(kindSegments(s.acquisition_count, maximum, row.kindCounts));
  const counts = $derived(segments.map(({ kind, count }) => `${kindLabel(kind)}: ${count}`).join(' · ') || 'No spots');
  const byline = $derived([day(s.started_at), s.analyst, s.instrument?.name].filter(Boolean).join(' · ') || 'Date and analyst not recorded');
</script>
<article class="glass panel session-card" data-testid="session-card">
  <div class="heading">
    <button class="main mono" title={`${s.session_key} · ${counts} · ${status.text}`} aria-label="Open session {s.session_key}" onclick={() => void shell.handleLink(`laicpmsdb://session/${s.id}`, 'home')}><span class="key">{s.session_key}</span></button>
    <span class="chip mineral"><MineralIcon mineral={s.material} /><span>{s.material || 'Unspecified'}</span></span>
  </div>
  <div class="byline">
    <p class="muted small ellipsis" title={byline}>{byline}</p>
    {#if row.access}<span class="chip access" title={row.access.owner ? `Session owner: ${row.access.owner}` : 'Your session access'}>{row.access.role}</span>{/if}
  </div>
  <details class="spot-details">
    <summary class="spot-line" title={counts} aria-label={`Spot breakdown for ${s.session_key}, ${s.acquisition_count} spots`}>
      <svg viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true">
        <rect width="100" height="5" rx="2" fill="var(--hairline)"/>
        {#each segments as segment (segment.kind)}
          <rect x={segment.x} width={segment.width} height="5" fill={kindColor(segment.kind)}>
            <title>{kindLabel(segment.kind)}: {segment.count}</title>
          </rect>
        {/each}
      </svg>
      <span>{s.acquisition_count} spots</span>
      <span class="chevron" aria-hidden="true"></span>
    </summary>
    <ul class="breakdown small">
      {#each segments as { kind, count } (kind)}
        <li><i style:background={kindColor(kind)} aria-hidden="true"></i>{kindLabel(kind)} <strong>{count}</strong></li>
      {:else}
        <li>No spots</li>
      {/each}
    </ul>
  </details>
  <div class="footer">
    <p class="run small" title={status.text}><span class="dot" style:background={`var(--${status.tone})`} aria-hidden="true"></span><span class="ellipsis">{status.text}</span></p>
    <div class="controls">
      {#if row.runs && row.runs > 0}<button class="btn" onclick={(e) => { e.stopPropagation(); shell.show('review'); void review.open({ kind: 'session', id: s.id }); }}>Review</button>{/if}
      <button class="btn" onclick={(e) => { e.stopPropagation(); void openInStudio({ session: s.id, run: null }, 'home'); }}>Reduce</button>
    </div>
  </div>
</article>
<style>
  .session-card { position: relative; min-width: 0; padding: var(--space-2) var(--space-3); display: flex; flex-direction: column; gap: var(--space-1); box-shadow: none; }
  .session-card:hover, .session-card:focus-within { border-color: var(--accent); }
  .heading { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
  .main { border: 0; background: none; padding: 0; text-align: left; color: var(--accent); font-weight: 600; min-width: 0; cursor: pointer; flex: 1; }
  .key { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .main::after { content: ''; position: absolute; inset: 0; border-radius: var(--radius); }
  .chip { font-size: 0.7rem; padding: 0 var(--space-1); white-space: nowrap; }
  .mineral { display: flex; align-items: center; gap: 2px; max-width: 40%; text-transform: capitalize; }
  .mineral span { overflow: hidden; text-overflow: ellipsis; }
  .byline { display: flex; align-items: center; justify-content: space-between; gap: var(--space-1); min-width: 0; }
  .access { position: relative; z-index: 1; }
  p { margin: 0; }
  .ellipsis { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spot-details { position: relative; z-index: 1; }
  .spot-line { display: flex; align-items: center; gap: var(--space-1); color: var(--text-muted); cursor: pointer; list-style: none; }
  .spot-line::-webkit-details-marker { display: none; }
  .spot-line:hover { color: var(--accent); }
  .spot-line svg { height: 5px; width: 100%; min-width: 0; flex: 1; }
  .spot-line span { white-space: nowrap; font-size: 0.72rem; }
  .chevron { width: 5px; height: 5px; border: solid currentColor; border-width: 0 1px 1px 0; transform: translateY(-1px) rotate(45deg); margin-right: 2px; }
  details[open] .chevron { transform: translateY(1px) rotate(225deg); }
  .breakdown { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-2); padding: var(--space-1) 0 0; margin: 0; }
  .breakdown li { display: inline-flex; align-items: center; gap: var(--space-1); }
  .breakdown i { width: 0.6rem; height: 0.45rem; border-radius: 2px; }
  .footer { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); }
  .run { display: flex; align-items: center; gap: var(--space-1); min-width: 0; flex: 1 1 0; font-size: 0.74rem; }
  .dot { width: 0.45rem; height: 0.45rem; }
  .controls { position: relative; z-index: 1; display: flex; gap: var(--space-1); margin-left: auto; }
  .btn { padding: 0.1rem var(--space-2); font-size: 0.74rem; }
</style>
