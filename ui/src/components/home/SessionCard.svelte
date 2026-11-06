<script lang="ts">
  import type { SessionRow } from '../../lib/overview.svelte';
  import { day, kindColor, kindSegments, runStatus } from '../../lib/home';
  import { shell } from '../../lib/shell.svelte';
  import { review } from '../../lib/review.svelte';
  let { row, maximum }: { row: SessionRow; maximum: number } = $props();
  const s = $derived(row.session);
  const status = $derived(runStatus(row));
  const segments = $derived(kindSegments(s.acquisition_count, maximum, row.kindCounts));
  const counts = $derived(row.kindCounts ? Object.entries(row.kindCounts).map(([k, n]) => `${k.replaceAll('_', ' ')}: ${n}`).join(', ') : `${s.acquisition_count} spots`);
</script>
<article class="glass panel session-card" data-testid="session-card">
  <div class="heading">
    <button class="main mono" title={`${s.session_key} · ${counts} · ${status.text}`} aria-label="Open session {s.session_key}" onclick={() => void shell.handleLink(`laicpmsdb://session/${s.id}`, 'home')}><span class="key">{s.session_key}</span></button>
    <span class="chip" title={s.material}>{s.material}</span>
  </div>
  <p class="muted small ellipsis" title={[day(s.started_at), s.analyst, s.instrument?.name].filter(Boolean).join(' · ')}>{[day(s.started_at), s.analyst, s.instrument?.name].filter(Boolean).join(' · ') || 'Date and analyst not recorded'}</p>
  <div class="spot-line small">
    <svg viewBox="0 0 100 5" preserveAspectRatio="none" role="img" aria-label={counts}>
      <title>{counts}</title><rect width="100" height="5" rx="2" fill="var(--hairline)"/>
      {#each segments as segment}<rect x={segment.x} width={segment.width} height="5" fill={kindColor(segment.kind)}/>{/each}
    </svg>
    <span>{s.acquisition_count} spots</span>
  </div>
  <div class="footer">
    <p class="run small" title={status.text}><span class="dot" style:background={`var(--${status.tone})`} aria-hidden="true"></span><span class="ellipsis">{status.text}</span></p>
    <div class="controls">
      {#if row.runs && row.runs > 0}<button class="btn" onclick={(e) => { e.stopPropagation(); shell.show('review'); void review.open({ kind: 'session', id: s.id }); }}>Review</button>{/if}
      <button class="btn" title="Open this session in UPbRPy Studio" onclick={(e) => { e.stopPropagation(); void shell.handleLink(`upbr://session/${s.id}`, 'home'); }}>Reduce</button>
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
  .chip { font-size: 0.7rem; padding: 0 var(--space-1); cursor: inherit; max-width: 35%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  p { margin: 0; }
  .ellipsis { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spot-line { display: flex; align-items: center; gap: var(--space-2); color: var(--text-muted); }
  .spot-line svg { height: 5px; width: 100%; min-width: 0; flex: 1; }
  .spot-line span { white-space: nowrap; font-size: 0.72rem; }
  .footer { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); }
  .run { display: flex; align-items: center; gap: var(--space-1); min-width: 0; flex: 1 1 0; font-size: 0.74rem; }
  .dot { width: 0.45rem; height: 0.45rem; }
  .controls { position: relative; z-index: 1; display: flex; gap: var(--space-1); margin-left: auto; }
  .btn { padding: 0.1rem var(--space-2); font-size: 0.74rem; }
</style>
