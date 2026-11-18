<script lang="ts">
  import { oversight, READ_ONLY_REASON } from '../../lib/oversight.svelte';
  import { ownerName } from '../../lib/records.svelte';
  import { localInventory } from '../../lib/local-sessions.svelte';
  import type { LocalSession } from '../../lib/platform';
  import { openInStudio } from '../../lib/apps.svelte';
  import type { SessionRow } from '../../lib/overview.svelte';
  import PinButton from './PinButton.svelte';
  import MineralIcon from './MineralIcon.svelte';
  import { plural } from '../../lib/plural';
  import { day, kindColor, kindLabel, kindSegments, runStatus } from '../../lib/home';
  import { shell } from '../../lib/shell.svelte';
  import { review } from '../../lib/review.svelte';
  let { row, maximum, local, dense = false, pinned = false, togglePin }: { row: SessionRow; maximum: number; local?: LocalSession; dense?: boolean; pinned?: boolean; togglePin?: () => void } = $props();
  const s = $derived(row.session);
  const status = $derived(runStatus(row));
  const segments = $derived(kindSegments(s.acquisition_count, maximum, row.kindCounts));
  const counts = $derived(segments.map(({ kind, count }) => `${kindLabel(kind)}: ${count}`).join(' · ') || 'No spots');
  const date = $derived(day(s.started_at));
  const people = $derived([dense && ownerName(s) ? `Owner: ${ownerName(s)}` : null, s.analyst, s.instrument?.name].filter(Boolean).join(' · '));
  const byline = $derived([date, people].filter(Boolean).join(' · ') || 'Date and analyst not recorded');
</script>
<article class="glass panel session-card" class:dense data-testid="session-card">
  <div class="heading">
    <button class="main mono" title={`${s.session_key} · ${counts} · ${status.text}`} aria-label="Open session {s.session_key}" onclick={() => void shell.handleLink(`upbdb://session/${s.id}`, 'home')}><span class="key">{s.session_key}</span></button>
    {#if togglePin}<PinButton label={s.session_key} {pinned} toggle={togglePin} />{/if}
    <span class="chip mineral"><MineralIcon mineral={s.material} /><span>{s.material || 'Unspecified'}</span></span>
  </div>
  <div class="byline">
    <p class="muted small byline-text" title={byline}>{#if date || people}{#if date}<span class="date">{date}</span>{/if}{#if date && people}<span aria-hidden="true">·</span>{/if}{#if people}<span class="ellipsis">{people}</span>{/if}{:else}<span class="ellipsis">{byline}</span>{/if}</p>
    {#if local}<span class="chip">Local copy</span>{/if}
    {#if row.access}<span class="chip access" title={row.access.owner ? `Session owner: ${row.access.owner}` : 'Your session access'}>{row.access.role}</span>{/if}
  </div>
  <details class="spot-details">
    <summary class="spot-line" title={counts} aria-label={`Spot breakdown for ${s.session_key}, ${plural(s.acquisition_count, 'spot')}`}>
      <svg viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true">
        <rect width="100" height="5" rx="2" fill="var(--hairline)"/>
        {#each segments as segment (segment.kind)}
          <rect x={segment.x} width={segment.width} height="5" fill={kindColor(segment.kind)}>
            <title>{kindLabel(segment.kind)}: {segment.count}</title>
          </rect>
        {/each}
      </svg>
      <span>{plural(s.acquisition_count, 'spot')}</span>
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
  {#if !dense && ownerName(s)}<p class="muted small ellipsis">Owner: {ownerName(s)}</p>{/if}
  <div class="footer">
    <p class="run small" title={status.text}><span class="dot" style:background={`var(--${status.tone})`} aria-hidden="true"></span><span class="ellipsis">{status.text}</span></p>
    <div class="controls">
      {#if row.runs && row.runs > 0}<button class="btn" onclick={(e) => { e.stopPropagation(); shell.show('review'); void review.open({ kind: 'session', id: s.id }); }}>Review</button>{/if}
      {#if local && local.openable !== false}<button class="btn" disabled={!!localInventory.opening || !!oversight.viewAs} title={oversight.viewAs ? READ_ONLY_REASON : undefined} onclick={() => void localInventory.open(local)}>Open in UPbRPy Studio</button>
      {:else if !local}<button class="btn" disabled={!!oversight.viewAs} title={oversight.viewAs ? READ_ONLY_REASON : undefined} onclick={(e) => { e.stopPropagation(); void openInStudio({ session: s.id, run: null }, 'home'); }}>Reduce</button>{/if}
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
  .chip { font-size: 0.72rem; padding: 0 var(--space-1); white-space: nowrap; }
  .mineral { display: flex; align-items: center; gap: 2px; max-width: 40%; text-transform: capitalize; }
  .mineral span { overflow: hidden; text-overflow: ellipsis; }
  .byline { display: flex; align-items: center; justify-content: space-between; gap: var(--space-1); min-width: 0; }
  .access { position: relative; z-index: 1; }
  p { margin: 0; }
  .byline-text { display: flex; gap: 0.3em; min-width: 0; }
  .date { flex: none; white-space: nowrap; }
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
  .controls { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: var(--space-1); margin-left: auto; }
  .btn { padding: 0.1rem var(--space-2); font-size: 0.74rem; }
  .dense { border: 0; border-bottom: 1px solid var(--hairline); border-radius: 0; background: transparent; padding: var(--space-2) 0; gap: var(--space-1); }
  .dense:hover { background: var(--row-hover); }
  .dense .footer { min-height: 26px; }
</style>
