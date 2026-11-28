<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import IconButton from '../ui/IconButton.svelte';
  import BatchMonthGrid from './BatchMonthGrid.svelte';
  import { identity } from '../../lib/identity.svelte';
  import { shell } from '../../lib/shell.svelte';
  import { tims, type BatchOut, type CapsuleOut, type ListPage } from '../../lib/tims-api';
  import { ReplyScope } from '../../lib/tims-requests';
  import { monthWindow, shiftMonth, viewQuery } from '../../lib/tims-batch-list';
  import { emptyBatchFilters } from '../../lib/tims-model';
  import { batchEvents, scheduleTitle, type BatchEvent } from '../../lib/tims-schedule';
  let { lab, capsuleSet, active }: { lab: string; capsuleSet: CapsuleOut; active: boolean } = $props();
  const today = new Date().toISOString().slice(0, 10);
  let month = $state(`${today.slice(0, 7)}-01`);
  let rows = $state.raw<BatchOut[]>([]), page = $state.raw<ListPage<BatchOut> | null>(null);
  let busy = $state(false), error = $state('');
  let generation = 0;
  const replies = new ReplyScope(() => [lab, capsuleSet.id, month, active]);
  const period = $derived(monthWindow(month));
  const filters = $derived({ ...emptyBatchFilters(), capsule_set: capsuleSet.id });
  const events = $derived(batchEvents(rows, filters, period));
  const legacy = $derived(rows.some(row => row.schedule === undefined));
  const monthTitle = $derived(new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}T00:00:00Z`)));
  const chipText = (item: BatchEvent) => item.legacy ? 'Batch start' : `${item.label} · ${item.capsule_count}`;
  const batchName = (row: BatchOut) => `Batch ${row.id} · started ${row.started_on}`;
  const eventLabel = (item: BatchEvent) => `${chipText(item)}${item.legacy ? '' : ' capsules'} · ${batchName(item.batch)} · ${item.date}`;
  const eventTitle = (item: BatchEvent) => item.legacy ? `${batchName(item.batch)} · Batch start · ${item.date}` : scheduleTitle(item, batchName(item.batch));
  $effect(() => {
    void lab; void capsuleSet.id; void month; void identity.revision; const visible = active;
    untrack(() => {
      generation++; replies.invalidate(); rows = []; page = null; error = ''; busy = false;
      if (visible) void load();
    });
    return () => { generation++; replies.invalidate(); };
  });
  onDestroy(() => { generation++; replies.invalidate(); });
  async function load(more = false) {
    if (!active || busy) return;
    const gen = ++generation, current = replies.capture();
    const owner = capsuleSet.id, nextPage = page;
    busy = true; error = '';
    try {
      // Shared identity GET revalidates each exact page with its ETag. No local
      // month cache and no eager cursor walk: a page is read only on demand.
      const next = more ? await nextPage?.more() : await tims.batches(viewQuery(lab, filters, 'calendar', period));
      if (gen !== generation || !current() || !next) return;
      const scoped = next.items.filter(row => row.capsule_set_id === owner);
      rows = more ? [...new Map([...rows, ...scoped].map(row => [row.id, row])).values()] : scoped;
      page = next;
    } catch (e) { if (gen === generation && current()) error = String(e); }
    finally { if (gen === generation && current()) busy = false; }
  }
  function jump(value: string) {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= '0001-01' && value <= '9998-12') month = `${value}-01`;
  }
</script>
<section class="stack usage-calendar" aria-label="Capsule set usage calendar">
  <h4>Usage calendar</h4>
  <p class="small muted">Counts show how many capsules were recorded for each step in this set.</p>
  <div class="row month-controls">
    <IconButton icon="chevron-left" label="Previous month" disabled={month <= '0001-01-01'} onclick={() => month = shiftMonth(month, -1)} />
    <strong class="month-title">{monthTitle}</strong>
    <IconButton icon="chevron-right" label="Next month" disabled={month >= '9998-12-01'} onclick={() => month = shiftMonth(month, 1)} />
    <IconButton icon="calendar" label="Current month" onclick={() => month = `${today.slice(0, 7)}-01`} />
    <label>Month / year <input type="month" min="0001-01" max="9998-12" value={month.slice(0, 7)} onchange={event => jump(event.currentTarget.value)} /></label>
  </div>
  <div class="read-status" aria-live="polite">
    {#if busy}<p role="status">{rows.length ? 'Loading more usage…' : 'Loading usage…'}</p>{/if}
    {#if error}<p class="error" role="status">{error}</p><button class="btn small" disabled={busy} onclick={() => void load(!!page)}>Retry usage</button>{/if}
    {#if legacy}<p class="small muted">Only loaded batch start dates are shown for this month. Step dates require a newer server.</p>{/if}
    {#if !busy && !error && page && !events.length}<p>{legacy ? 'No loaded batch starts in this month.' : 'No recorded usage in the loaded batches for this month.'}</p>{/if}
    {#if page?.nextCursor}<p class="small muted">Showing {rows.length} loaded batches. More batches may contain usage dates.</p>{/if}
  </div>
  <BatchMonthGrid resetKey={JSON.stringify([capsuleSet.id, active])} {month} {today} {events} name={batchName} {eventLabel} {chipText} {eventTitle} overflowText={chipText} label="Set usage month" overflowId="set-usage-overflow" openEvent={item => void shell.openTimsBatch(item.batch.id, item.step_id || null)} />
  {#if page?.nextCursor}<button class="btn" disabled={busy} onclick={() => void load(true)}>Load more usage</button>{/if}
</section>
<style>
  h4,p{margin:0}.usage-calendar{min-width:0;gap:8px}.row{flex-wrap:wrap}.month-controls{gap:8px}.month-title{min-width:10rem}label{display:flex;align-items:center;gap:6px;font-size:12px;min-width:0}input{min-width:0;max-width:100%;width:10rem}.read-status:empty{display:none}.read-status{display:grid;gap:4px;overflow-wrap:anywhere}
</style>
