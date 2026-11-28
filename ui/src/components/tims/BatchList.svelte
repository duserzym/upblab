<script lang="ts">
  import BatchMonthGrid from './BatchMonthGrid.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import { onDestroy, tick, untrack, type Snippet } from 'svelte';
  import { identity } from '../../lib/identity.svelte';
  import { shell } from '../../lib/shell.svelte';
  import { tims, type BatchOut, type CapsuleOut, type RecipeOut, type ListPage } from '../../lib/tims-api';
  import type { BatchFilters } from '../../lib/tims-model';
  import type { Viewer } from '../../lib/tims-picker-context';
  import { loadListView, saveListView, type ListView } from '../../lib/tims-guidance';
  import { formatCalendarDate } from '../../lib/calendar-date';
  import { operatorName } from '../../lib/tims-display';
  import { axisTicks, daysBetween, monthWindow, shiftMonth, defaultLaneWindow, extendLaneWindow, batchState, batchSetName, batchSamples, hasBatchSummary, viewQuery, visibleBatches } from '../../lib/tims-batch-list';
  import { batchEvents, packScheduleLane, scheduleTitle, type BatchEvent } from '../../lib/tims-schedule';
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
  let monthHeading = $state<HTMLElement>();
  let laneScroll = $state<HTMLDivElement>();
  const period = $derived(view === 'calendar' ? monthWindow(month) : window);
  const query = $derived(viewQuery(lab, filters, view, period));
  const visible = $derived(visibleBatches(rows, filters, 'rows', period, today));
  const events = $derived(batchEvents(rows, filters, period));
  const eventLabel = (item: BatchEvent) => item.legacy ? label(item.batch) : `${name(item.batch)} · ${item.label} · ${item.capsule_count}`;
  const openEvent = (item: BatchEvent) => void shell.openTimsBatch(item.batch.id, item.step_id || null);
  const name = (row: BatchOut) => batchSetName(row, sets);
  const label = (row: BatchOut) => `${name(row)} · ${row.started_on} · ${batchState(row).text}`;
  const sorted = $derived(sort === 'date' && !ascending && !legacy ? visible : [...visible].sort((a, b) => {
    const comparison = sort === 'set' ? name(a).localeCompare(name(b)) : a.started_on.localeCompare(b.started_on);
    return (ascending ? comparison : -comparison) || a.id.localeCompare(b.id);
  }));
  const missingSchedule = $derived(view !== 'rows' && rows.some(row => row.schedule === undefined));
  const monthTitle = $derived(new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}T00:00:00Z`)));
  const dayWidth = $derived(zoom === 'weeks' ? 22 : 8);
  const axisWidth = $derived((daysBetween(window.start, window.end) + 1) * dayWidth);
  const ticks = $derived(axisTicks(window, zoom));
  const lanes = $derived([...sets.filter(set => (set.active || events.some(item => item.batch.capsule_set_id === set.id)) && (!filters.capsule_set || set.id === filters.capsule_set)),
    ...[...new Set(events.map(item => item.batch.capsule_set_id))].filter(id => !sets.some(set => set.id === id)).map(id => ({ id, name: name(events.find(item => item.batch.capsule_set_id === id)!.batch), code: '' }))]
    .map(set => ({ set, ...packScheduleLane(events.filter(item => item.batch.capsule_set_id === set.id), dayWidth) })));
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
      if ((request.started_after && request.started_before && request.started_after > request.started_before) || (request.schedule_after && request.schedule_before && request.schedule_after > request.schedule_before)) { rows = []; page = null; return; }
      const cached = selectedView === 'calendar' && !revalidate ? batchMonths.get(key) : undefined;
      if (cached) { applySnapshot(cached); return; }
      const first = await tims.batches(request);
      if (!current()) return;
      const older = first.items.length > 0 && first.items.every(row => !hasBatchSummary(row));
      if (selectedView === 'rows') { applySnapshot({ rows: first.items, page: first, truncated: false, legacy: older }); return; }
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
  async function selectMonth(value: string) {
    month = value;
    await tick(); monthHeading?.focus({ preventScroll: true });
  }
</script>
<div class="batch-views stack" class:calendar-view={view === 'calendar'}>
  <div class="row view-toolbar">
    <SegmentedControl label="Batch list view" options={[{ value: 'rows', label: 'Rows' }, { value: 'calendar', label: 'Calendar' }, { value: 'lanes', label: 'Lanes' }]} value={view} onchange={selectView} size="small" />
    {@render filterControls?.()}
  </div>
  {#if view !== 'rows' || busy}
  <div class="row view-toolbar period-toolbar">
    {#if view === 'calendar'}
      <IconButton icon="chevron-left" label="Previous month" onclick={() => selectMonth(shiftMonth(month, -1))} /><strong class="month-title" bind:this={monthHeading} tabindex="-1">{monthTitle}</strong><IconButton icon="chevron-right" label="Next month" onclick={() => selectMonth(shiftMonth(month, 1))} /><IconButton icon="calendar" label="Today" onclick={() => selectMonth(`${today.slice(0, 7)}-01`)} />
    {:else if view === 'lanes'}
      <SegmentedControl label="Lane zoom" options={[{ value: 'weeks', label: 'Weeks' }, { value: 'months', label: 'Months' }]} bind:value={zoom} size="small" />
      <IconButton icon="chevron-left" label="Earlier" onclick={() => window = extendLaneWindow(window, -1)} /><IconButton icon="chevron-right" label="Later" onclick={() => window = extendLaneWindow(window, 1)} /><IconButton icon="calendar" label="Today" onclick={scrollLanesToToday} />
    {/if}
    <span class="small muted loading-status" role="status">{busy ? 'Loading batches…' : ''}</span>
  </div>
  {/if}
  {#if error}<p class="error" role="status">{error}</p><button class="btn" onclick={() => void load(undefined, undefined, undefined, undefined, true)}>Retry batches</button>{/if}
  {#if missingSchedule}<p class="small muted">Older server: step dates are unavailable; showing batch start dates.</p>{/if}
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
    <BatchMonthGrid resetKey={JSON.stringify([viewer, query, refresh])} {month} {today} {events} {name} {eventLabel} chipText={item => item.legacy ? name(item.batch) : eventLabel(item)} {openEvent} />
  {:else}
    <!-- The scrollable region is a keyboard scroll target as well as containing tabbable bars. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="lane-scroll" bind:this={laneScroll} role="region" aria-label="Batch lanes" tabindex="0">
      <div class="lane-canvas" style:width={`${axisWidth + 278}px`}>
        <div class="lane-row axis"><strong class="lane-label">Capsule set</strong><div class="lane-track">{#each ticks as tick}<time style:left={`${daysBetween(window.start, tick) * dayWidth}px`} title={tick}>{zoom === 'months' ? formatCalendarDate(tick).replace(/^\d+ /, '') : formatCalendarDate(tick).replace(` ${tick.slice(0, 4)}`, '')}</time>{/each}<span class="today-line" style:left={`${daysBetween(window.start, today) * dayWidth}px`} title="Today"></span></div></div>
        {#each lanes as lane (lane.set.id)}
          <div class="lane-row" data-testid="tims-batch-lane" style:height={`${lane.tracks * 32 + 12}px`}>
            <div class="lane-label"><strong>{lane.set.name}</strong> <span class="small muted">{lane.set.code}</span>{#if !lane.bars.length}<span class="secondary muted small">free</span>{/if}</div>
            <div class="lane-track">
              <span class="today-line" style:left={`${daysBetween(window.start, today) * dayWidth}px`} title="Today"></span>
              {#each lane.bars as bar (bar.item.key)}
                <button class="lane-bar" data-testid="tims-batch-bar" data-track={bar.track} data-kind={bar.item.kind} style:left={`${daysBetween(window.start, bar.item.date) * dayWidth}px`} style:width="148px" style:top={`${bar.track * 32 + 6}px`} aria-label={eventLabel(bar.item)} title={scheduleTitle(bar.item, name(bar.item.batch))} onclick={() => openEvent(bar.item)}>{eventLabel(bar.item)}</button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
<style>
  /* Keep month navigation and loading in one reserved row, even in a short window. */
  .view-toolbar.period-toolbar { flex-wrap: nowrap; min-height: 30px; }
  .month-title { flex: none; width: 10rem; white-space: nowrap; }
  .loading-status { flex: 0 1 10rem; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .batch-views{min-width:0;gap:8px}.batch-table{border:1px solid var(--hairline);border-radius:var(--radius-sm);overflow:hidden;background:var(--glass)}.batch-views.calendar-view{flex:1;min-height:430px}.view-toolbar{flex:none;flex-wrap:wrap;gap:8px;box-shadow:0 1px var(--hairline)}p{margin:0}table{width:100%;table-layout:fixed;border-collapse:collapse}th{text-align:left;font-size:12px;font-weight:500;color:var(--text-muted);padding:4px 8px;border-bottom:1px solid var(--hairline);background:var(--glass-strong)}th:nth-child(1){width:22%}th:nth-child(2){width:17%}th:nth-child(3){width:19%}th:nth-child(4){width:17%}th:nth-child(5){width:25%}th button{border:0;background:transparent;color:inherit;cursor:pointer;padding:2px 0}td{padding:0;border-bottom:1px solid var(--hairline)}.batch-row{display:grid;grid-template-columns:22fr 17fr 19fr 17fr 25fr;width:100%;gap:0;align-items:center;padding:8px 0;border:0;background:transparent;text-align:left;cursor:pointer;overflow-wrap:anywhere}.batch-row>*{min-width:0;padding:0 8px}.batch-row strong{font-size:13px;font-weight:600}.batch-row time{font-size:12px;font-variant-numeric:tabular-nums}.batch-row .truncate{font-size:13px}tbody tr:last-child td{border-bottom:0}.batch-row:hover{background:var(--row-hover)}button:focus-visible,.lane-scroll:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}.secondary{display:block;margin-top:3px;font-size:12px}.truncate{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.lane-bar{--step-colour:var(--text-muted);color:var(--text);background:color-mix(in srgb,var(--step-colour) 16%,var(--glass-strong));border:1px solid color-mix(in srgb,var(--step-colour) 65%,var(--hairline));border-left:3px solid var(--step-colour)}[data-kind=abrasion]{--step-colour:var(--warning)}[data-kind=dissolution]{--step-colour:var(--danger)}[data-kind=conversion]{--step-colour:var(--kind-sample_registered)}[data-kind=cleaning]{--step-colour:var(--accent)}[data-kind=loading]{--step-colour:var(--ok)}.lane-scroll{max-width:100%;overflow:auto;max-height:calc(100dvh - 370px);border:1px solid var(--hairline);border-radius:var(--radius-sm)}.lane-row{display:grid;grid-template-columns:130px minmax(0,1fr);border-bottom:1px solid var(--hairline)}.lane-label{position:sticky;left:0;z-index:2;background:var(--glass-strong);backdrop-filter:blur(20px);padding:6px;overflow-wrap:anywhere;border-right:1px solid var(--hairline);font-size:12px}.lane-track{position:relative;min-width:0;overflow:hidden}.axis{height:32px;position:sticky;top:0;z-index:3;background:var(--glass-strong)}.axis time{position:absolute;font-size:10px;white-space:nowrap;top:7px}.today-line{position:absolute;top:0;bottom:0;width:2px;background:var(--accent);pointer-events:none;z-index:1}.lane-bar{position:absolute;height:26px;padding:2px 5px;border-radius:var(--radius-sm);text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;font-size:11px}@media(max-width:1100px){.batch-row{grid-template-columns:repeat(3,minmax(0,1fr));row-gap:6px}.batch-row>span:nth-child(4){grid-column:2}.batch-row>span:nth-child(5){grid-column:3}thead th:nth-child(n+4){display:none}th:nth-child(n){width:33%}}
</style>
