<script lang="ts">
  import IconButton from '../ui/IconButton.svelte';
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import { identity } from '../../lib/identity.svelte';
  import { shell } from '../../lib/shell.svelte';
  import { tims, type BatchOut, type CapsuleOut, type RecipeOut, type ListPage } from '../../lib/tims-api';
  import type { BatchFilters } from '../../lib/tims-model';
  import type { Viewer } from '../../lib/tims-picker-context';
  import { loadListView, saveListView, type ListView } from '../../lib/tims-guidance';
  import { formatCalendarDate } from '../../lib/calendar-date';
  import { operatorName } from '../../lib/tims-display';
  import { axisTicks, daysBetween, monthWindow, monthGrid, shiftMonth, defaultLaneWindow, extendLaneWindow, packLane, barPosition, batchState, batchSetName, batchSamples, batchProgress, hasBatchSummary, viewQuery, visibleBatches } from '../../lib/tims-batch-list';
  import { batchMonths, collectBatchPages, type BatchSnapshot } from '../../lib/tims-batch-pages';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import ProgressBar from '../ui/ProgressBar.svelte';
  import StatusChip from '../ui/StatusChip.svelte';
  let { lab, filters, sets, recipes, viewer, refresh, filterControls }: { filterControls?: Snippet; lab: string; filters: BatchFilters; sets: CapsuleOut[]; recipes: RecipeOut[]; viewer: Viewer; refresh: number } = $props();
  let view = $state<ListView>(untrack(() => loadListView(viewer)));
  const today = new Date().toISOString().slice(0, 10);
  let month = $state(`${today.slice(0, 7)}-01`), window = $state(defaultLaneWindow(today)), zoom = $state('weeks');
  let rows = $state.raw<BatchOut[]>([]), page = $state.raw<ListPage<BatchOut> | null>(null), busy = $state(false), error = $state(''), truncated = $state(false), legacy = $state(false);
  let sort = $state<'date' | 'set'>('date'), ascending = $state(false), generation = 0;
  let dialog: HTMLDialogElement, returnFocus: HTMLButtonElement | undefined;
  let overflowDay = $state('');
  let laneScroll = $state<HTMLDivElement>();
  const period = $derived(view === 'calendar' ? monthWindow(month) : window);
  const query = $derived(viewQuery(lab, filters, view, period));
  const visible = $derived(visibleBatches(rows, filters, view, period, today));
  const name = (row: BatchOut) => batchSetName(row, sets);
  const label = (row: BatchOut) => `${name(row)} · ${row.started_on} · ${batchState(row).text}`;
  const sorted = $derived(sort === 'date' && !ascending && !legacy ? visible : [...visible].sort((a, b) => {
    const comparison = sort === 'set' ? name(a).localeCompare(name(b)) : a.started_on.localeCompare(b.started_on);
    return (ascending ? comparison : -comparison) || a.id.localeCompare(b.id);
  }));
  const days = $derived(monthGrid(month));
  const dayRows = $derived(new Map(days.map(day => [day, visible.filter(row => row.started_on === day)])));
  const monthTitle = $derived(new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}T00:00:00Z`)));
  const dayWidth = $derived(zoom === 'weeks' ? 22 : 8);
  const axisWidth = $derived((daysBetween(window.start, window.end) + 1) * dayWidth);
  const ticks = $derived(axisTicks(window, zoom));
  const lanes = $derived([...sets.filter(set => set.active && (!filters.capsule_set || set.id === filters.capsule_set)),
    ...[...new Set(visible.map(row => row.capsule_set_id))].filter(id => !sets.some(set => set.id === id)).map(id => ({ id, name: name(visible.find(row => row.capsule_set_id === id)!), code: '' }))]
    .map(set => ({ set, ...packLane(visible.filter(row => row.capsule_set_id === set.id), today) })));
  $effect(() => {
    const request = { ...query }, selectedView = view, key = JSON.stringify([viewer, request]); void refresh;
    const gen = ++generation;
    untrack(() => { rows = []; page = null; error = ''; busy = true; truncated = false; legacy = false; });
    // Coalesce date typing and consecutive filter changes into one read.
    const timer = setTimeout(() => { void load(request, selectedView, key, gen); }, 300);
    return () => { clearTimeout(timer); generation++; };
  });
  $effect(() => {
    if (view !== 'lanes' || !laneScroll) return;
    // Wait for the axis and its scroll viewport to reflect the new zoom/window.
    void dayWidth; void window.start; void window.end;
    const frame = requestAnimationFrame(scrollLanesToToday);
    return () => cancelAnimationFrame(frame);
  });
  function scrollLanesToToday() {
    if (!laneScroll) return;
    const todayLeft = 130 + daysBetween(window.start, today) * dayWidth;
    laneScroll.scrollLeft = Math.max(0, todayLeft - laneScroll.clientWidth * 2 / 3);
  }
  onDestroy(() => { generation++; });
  function selectView(value: string) { view = value as ListView; saveListView(viewer, view); }
  function applySnapshot(snapshot: BatchSnapshot) { rows = snapshot.rows; page = snapshot.page; truncated = snapshot.truncated; legacy = snapshot.legacy; }
  async function load(request = { ...query }, selectedView = view, key = JSON.stringify([viewer, request]), gen = ++generation, revalidate = false) {
    const current = () => gen === generation;
    busy = true; error = '';
    try {
      if (request.started_after && request.started_before && request.started_after > request.started_before) { rows = []; page = null; return; }
      const cached = selectedView === 'calendar' && !revalidate ? batchMonths.get(key) : undefined;
      if (cached) { applySnapshot(cached); return; }
      let first = await tims.batches(request);
      if (!current()) return;
      const older = first.items.length > 0 && first.items.every(row => !hasBatchSummary(row));
      if (selectedView === 'rows') { applySnapshot({ rows: first.items, page: first, truncated: false, legacy: older }); return; }
      if (selectedView === 'lanes' && older) {
        applySnapshot({ rows: first.items, page: first, truncated: false, legacy: true });
        // Older servers ignore active_after. Bound their start-date scan to 120
        // days before the window; very old open batches may be absent there.
        first = await tims.batches(viewQuery(lab, filters, 'lanes', period, true));
        if (!current()) return;
      }
      const result = await collectBatchPages(first, current, snapshot => { if (current()) applySnapshot(snapshot); }, older);
      if (current() && result && selectedView === 'calendar') {
        if (batchMonths.size >= 24) batchMonths.delete(batchMonths.keys().next().value!);
        batchMonths.set(key, result);
      }
    } catch (e) { if (current()) error = String(e); }
    finally { if (current()) busy = false; }
  }
  async function more() {
    if (busy || !page?.nextCursor) return;
    const gen = generation; busy = true; error = '';
    try { const next = await page.more(); if (gen === generation && next) { rows = [...new Map([...rows, ...next.items].map(row => [row.id, row])).values()]; page = next; } }
    catch (e) { if (gen === generation) error = String(e); }
    finally { if (gen === generation) busy = false; }
  }
  function toggleSort(column: 'date' | 'set') { ascending = column === sort ? !ascending : column === 'set'; sort = column; }
  function showMore(day: string, button: HTMLButtonElement) { overflowDay = day; returnFocus = button; dialog.showModal(); }
</script>
<div class="batch-views stack">
  <div class="row view-toolbar">
    <SegmentedControl label="Batch list view" options={[{ value: 'rows', label: 'Rows' }, { value: 'calendar', label: 'Calendar' }, { value: 'lanes', label: 'Lanes' }]} value={view} onchange={selectView} size="small" />
    {@render filterControls?.()}
  </div>
  {#if view !== 'rows' || busy}
  <div class="row view-toolbar">
    {#if view === 'calendar'}
      <IconButton icon="chevron-left" label="Previous month" onclick={() => month = shiftMonth(month, -1)} /><strong>{monthTitle}</strong><IconButton icon="chevron-right" label="Next month" onclick={() => month = shiftMonth(month, 1)} /><IconButton icon="calendar" label="Today" onclick={() => month = `${today.slice(0, 7)}-01`} />
    {:else if view === 'lanes'}
      <SegmentedControl label="Lane zoom" options={[{ value: 'weeks', label: 'Weeks' }, { value: 'months', label: 'Months' }]} bind:value={zoom} size="small" />
      <IconButton icon="chevron-left" label="Earlier" onclick={() => window = extendLaneWindow(window, -1)} /><IconButton icon="chevron-right" label="Later" onclick={() => window = extendLaneWindow(window, 1)} /><IconButton icon="calendar" label="Today" onclick={scrollLanesToToday} />
    {/if}
    {#if busy}<span class="small muted" role="status">Loading batches…</span>{/if}
  </div>
  {/if}
  {#if error}<p class="error" role="status">{error}</p><button class="btn" onclick={() => void load(undefined, undefined, undefined, undefined, true)}>Retry batches</button>{/if}
  {#if truncated}<p class="small muted" role="status">Showing first {rows.length} batches; narrow the filters to see more.</p>{/if}
  {#if view === 'rows'}
    {#if page?.nextCursor && (legacy || sort !== 'date' || ascending)}<p class="small muted">Sorting loaded batches only. Load more to include later pages.</p>{/if}
    <section class="batch-table" aria-label="Batch list">
      <table>
        <thead><tr><th aria-sort={sort === 'set' ? ascending ? 'ascending' : 'descending' : 'none'}><button onclick={() => toggleSort('set')}>Capsule set ↕</button></th><th aria-sort={sort === 'date' ? ascending ? 'ascending' : 'descending' : 'none'}><button onclick={() => toggleSort('date')}>Start date ↕</button></th><th>Samples</th><th>Progress</th><th>State / analyst / recipe</th></tr></thead>
        <tbody>{#each sorted as row (row.id)}
          {@const state = batchState(row)}
          <tr><td colspan="5"><button class="batch-row" data-testid="tims-batch-row" aria-label={`${name(row)} · ${row.started_on}`} aria-describedby={`batch-state-${row.id}`} onclick={() => void shell.openTimsBatch(row.id)}>
            <span><strong>{name(row)}</strong> <span class="muted small">{row.capsule_set_code ?? sets.find(set => set.id === row.capsule_set_id)?.code ?? ''}</span></span>
            <time datetime={row.started_on} title={row.started_on}>{formatCalendarDate(row.started_on)}</time>
            <span class="truncate" title={batchSamples(row)}>{batchSamples(row)}</span>
            <span>{#if row.counts}<ProgressBar value={row.counts.spike} total={row.counts.capsules} noun="spiked" />{:else}<span aria-label="Spike progress unavailable">—</span>{/if}</span>
            <span id={`batch-state-${row.id}`}><StatusChip {...state} /><span class="secondary muted small">{operatorName(row, identity.account)} · {row.recipe_name ?? recipes.find(recipe => recipe.id === row.recipe_id)?.name ?? (row.recipe_id ? 'Recipe name not supplied' : 'No recipe')}</span></span>
          </button></td></tr>
        {:else}<tr><td colspan="5">{busy ? 'Loading batches…' : 'No batches match these filters.'}</td></tr>{/each}</tbody>
      </table>
    </section>
    {#if page?.nextCursor}<button class="btn" disabled={busy} onclick={() => void more()}>Load more batches</button>{/if}
  {:else if view === 'calendar'}
    <section class="calendar" aria-label="Batch calendar">
      <div class="weekdays" aria-hidden="true">{#each ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as day}<span>{day}</span>{/each}</div>
      <div class="month-grid" style:grid-template-rows={`repeat(${days.length / 7}, minmax(0, 1fr))`}>
        {#each days as day (day)}
          {@const batches = dayRows.get(day) ?? []}
          <div class="day" class:outside={day.slice(0, 7) !== month.slice(0, 7)} class:today={day === today}>
            <time datetime={day} aria-current={day === today ? 'date' : undefined} title={formatCalendarDate(day)}>{Number(day.slice(8))}</time>
            {#each batches.slice(0, 2) as row (row.id)}<button class="calendar-chip" data-tone={batchState(row).tone} aria-label={label(row)} title={`${label(row)} · ${batchProgress(row)}`} onclick={() => void shell.openTimsBatch(row.id)}>{name(row)}{row.counts ? ` · ${row.counts.capsules}` : ''}</button>{/each}
            {#if batches.length > 2}<button class="more-chip" aria-label={`${batches.length - 2} more batches on ${day}`} onclick={event => showMore(day, event.currentTarget)}>+{batches.length - 2} more</button>{/if}
          </div>
        {/each}
      </div>
    </section>
  {:else}
    {#if legacy}<p class="small muted">Older server: scanning starts up to 120 days before the window. Earlier open batches may be absent.</p>{/if}
    <!-- The scrollable region is a keyboard scroll target as well as containing tabbable bars. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="lane-scroll" bind:this={laneScroll} role="region" aria-label="Batch lanes" tabindex="0">
      <div class="lane-canvas" style:width={`${axisWidth + 130}px`}>
        <div class="lane-row axis"><strong class="lane-label">Capsule set</strong><div class="lane-track">{#each ticks as tick}<time style:left={`${daysBetween(window.start, tick) * dayWidth}px`} title={tick}>{zoom === 'months' ? formatCalendarDate(tick).replace(/^\d+ /, '') : formatCalendarDate(tick).replace(` ${tick.slice(0, 4)}`, '')}</time>{/each}<span class="today-line" style:left={`${daysBetween(window.start, today) * dayWidth}px`} title="Today"></span></div></div>
        {#each lanes as lane (lane.set.id)}
          <div class="lane-row" data-testid="tims-batch-lane" style:height={`${lane.tracks * 32 + 12}px`}>
            <div class="lane-label"><strong>{lane.set.name}</strong> <span class="small muted">{lane.set.code}</span>{#if !lane.bars.length}<span class="secondary muted small">free</span>{/if}</div>
            <div class="lane-track">
              <span class="today-line" style:left={`${daysBetween(window.start, today) * dayWidth}px`} title="Today"></span>
              {#each lane.bars as bar (bar.row.id)}
                {@const position = barPosition(bar.start, bar.end, window, dayWidth)}
                <button class="lane-bar" data-testid="tims-batch-bar" data-track={bar.track} data-tone={batchState(bar.row).tone} style:left={`${position.left}px`} style:width={`${position.width}px`} style:top={`${bar.track * 32 + 6}px`} aria-label={label(bar.row)} title={`${label(bar.row)} · ${batchProgress(bar.row)} · ${bar.end}`} onclick={() => void shell.openTimsBatch(bar.row.id)}>{batchState(bar.row).text} · {batchProgress(bar.row)}</button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
<dialog bind:this={dialog} aria-label={`More batches on ${overflowDay}`} onclose={() => returnFocus?.focus()}>
  <div class="stack"><strong>{formatCalendarDate(overflowDay)}</strong>{#each (dayRows.get(overflowDay) ?? []).slice(2) as row (row.id)}<button class="btn" aria-label={label(row)} onclick={() => { dialog.close(); void shell.openTimsBatch(row.id); }}>{name(row)} · {batchState(row).text}</button>{/each}<button class="btn" onclick={() => dialog.close()}>Close</button></div>
</dialog>
<style>
  .batch-views{min-width:0;gap:8px}.batch-table{border:1px solid var(--hairline);border-radius:var(--radius-sm);overflow:hidden;background:var(--glass)}.batch-views:has(.calendar){flex:1;min-height:430px}.view-toolbar{flex-wrap:wrap;gap:8px;box-shadow:0 1px var(--hairline)}p{margin:0}table{width:100%;table-layout:fixed;border-collapse:collapse}th{text-align:left;font-size:12px;font-weight:500;color:var(--text-muted);padding:4px 8px;border-bottom:1px solid var(--hairline);background:var(--glass-strong)}th:nth-child(1){width:22%}th:nth-child(2){width:17%}th:nth-child(3){width:19%}th:nth-child(4){width:17%}th:nth-child(5){width:25%}th button{border:0;background:transparent;color:inherit;cursor:pointer;padding:2px 0}td{padding:0;border-bottom:1px solid var(--hairline)}.batch-row{display:grid;grid-template-columns:22fr 17fr 19fr 17fr 25fr;width:100%;gap:0;align-items:center;padding:8px 0;border:0;background:transparent;text-align:left;cursor:pointer;overflow-wrap:anywhere}.batch-row>*{min-width:0;padding:0 8px}.batch-row strong{font-size:13px;font-weight:600}.batch-row time{font-size:12px;font-variant-numeric:tabular-nums}.batch-row .truncate{font-size:13px}tbody tr:last-child td{border-bottom:0}.batch-row:hover{background:var(--row-hover)}button:focus-visible,.lane-scroll:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}.secondary{display:block;margin-top:3px;font-size:12px}.truncate{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.calendar{min-width:0;min-height:0;display:flex;flex-direction:column;flex:1}.weekdays,.month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}.weekdays{font-size:12px;color:var(--text-muted);text-align:center;padding:4px}.month-grid{flex:1;min-height:354px;border-top:1px solid var(--hairline);border-left:1px solid var(--hairline)}.day{min-width:0;overflow:hidden;padding:2px;display:flex;flex-direction:column;gap:1px;border-right:1px solid var(--hairline);border-bottom:1px solid var(--hairline);background:var(--glass)}.day time{font-size:11px;line-height:12px;flex:none}.outside{background:transparent;color:var(--text-muted)}.today{box-shadow:inset 0 0 0 2px var(--accent)}.calendar-chip,.more-chip{display:block;min-width:0;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;font-size:11px;line-height:12px;padding:0 3px;flex:none;border:1px solid var(--hairline);border-radius:var(--radius-sm);cursor:pointer;background:var(--glass-strong);color:var(--text-muted)}.more-chip{border:0;background:transparent;color:var(--accent)}.calendar-chip[data-tone=success],.lane-bar[data-tone=success]{color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,var(--glass));border-color:color-mix(in srgb,var(--ok) 30%,var(--hairline))}.calendar-chip[data-tone=warning],.lane-bar[data-tone=warning]{color:var(--warning);background:color-mix(in srgb,var(--warning) 12%,var(--glass));border-color:color-mix(in srgb,var(--warning) 30%,var(--hairline))}.lane-scroll{max-width:100%;overflow:auto;max-height:calc(100dvh - 370px);border:1px solid var(--hairline);border-radius:var(--radius-sm)}.lane-row{display:grid;grid-template-columns:130px minmax(0,1fr);border-bottom:1px solid var(--hairline)}.lane-label{position:sticky;left:0;z-index:2;background:var(--glass-strong);backdrop-filter:blur(20px);padding:6px;overflow-wrap:anywhere;border-right:1px solid var(--hairline);font-size:12px}.lane-track{position:relative;min-width:0;overflow:hidden}.axis{height:32px;position:sticky;top:0;z-index:3;background:var(--glass-strong)}.axis time{position:absolute;font-size:10px;white-space:nowrap;top:7px}.today-line{position:absolute;top:0;bottom:0;width:2px;background:var(--accent);pointer-events:none;z-index:1}.lane-bar{position:absolute;height:26px;padding:2px 5px;border:1px solid var(--hairline);border-radius:var(--radius-sm);background:var(--glass-strong);color:var(--text-muted);text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;font-size:11px}dialog{max-width:min(440px,90vw);max-height:70dvh;overflow:auto;border:1px solid var(--hairline);border-radius:var(--radius);padding:16px;color:var(--text);background:var(--glass-strong)}dialog::backdrop{background:var(--press)}@media(max-width:1100px){.batch-row{grid-template-columns:repeat(3,minmax(0,1fr));row-gap:6px}.batch-row>span:nth-child(4){grid-column:2}.batch-row>span:nth-child(5){grid-column:3}thead th:nth-child(n+4){display:none}th:nth-child(n){width:33%}.calendar-chip,.more-chip{font-size:10px;padding:0 2px}.day{padding:2px;gap:1px}}
</style>
