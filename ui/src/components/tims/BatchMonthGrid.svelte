<script lang="ts">
  import { tick } from 'svelte';
  import { formatCalendarDate } from '../../lib/calendar-date';
  import { monthGrid } from '../../lib/tims-batch-list';
  import { scheduleTitle, type BatchEvent } from '../../lib/tims-schedule';
  import type { BatchOut } from '../../lib/tims-api';
  let { month, today, events, name, eventLabel, chipText = eventLabel, openEvent, label = 'Batch calendar', overflowId = 'calendar-overflow', resetKey = '', overflowText = eventLabel, eventTitle = item => scheduleTitle(item, name(item.batch)) }: {
    month: string; today: string; events: BatchEvent[]; name: (batch: BatchOut) => string;
    eventLabel: (item: BatchEvent) => string; chipText?: (item: BatchEvent) => string;
    openEvent: (item: BatchEvent) => void; label?: string; overflowId?: string; resetKey?: string; overflowText?: (item: BatchEvent) => string; eventTitle?: (item: BatchEvent) => string;
  } = $props();
  let overflowDay = $state(''), overflowRegion = $state<HTMLDivElement>();
  let returnFocus: HTMLButtonElement | undefined;
  const days = $derived(monthGrid(month, true));
  const dayRows = $derived(new Map(days.map(day => [day, events.filter(item => item.date === day)])));
  $effect(() => { void month; void resetKey; overflowDay = ''; });
  async function showMore(day: string, button: HTMLButtonElement) {
    overflowDay = overflowDay === day ? '' : day; returnFocus = button;
    if (overflowDay) { await tick(); overflowRegion?.focus({ preventScroll: true }); }
  }
  function closeMore() { overflowDay = ''; returnFocus?.focus({ preventScroll: true }); }
</script>
<svelte:window onkeydown={event => { if (event.key === 'Escape' && overflowDay) closeMore(); }} />
    <section class="calendar" aria-label={label}>
      <div class="weekdays" aria-hidden="true">{#each ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as day}<span>{day}</span>{/each}</div>
      <div class="month-grid">
        {#each days as day (day)}
          {@const batches = dayRows.get(day) ?? []}
          <div class="day" class:outside={day.slice(0, 7) !== month.slice(0, 7)} class:today={day === today}>
            <time datetime={day} aria-current={day === today ? 'date' : undefined} title={formatCalendarDate(day)}>{Number(day.slice(8))}</time>
            {#each batches.slice(0, 2) as item (item.key)}<button class="calendar-chip" data-kind={item.kind} aria-label={eventLabel(item)} title={eventTitle(item)} onclick={() => openEvent(item)}>{chipText(item)}</button>{/each}
            {#if batches.length > 2}<button class="more-chip" aria-expanded={overflowDay === day} aria-controls={overflowId} aria-label={`${batches.length - 2} more steps on ${day}`} onclick={event => showMore(day, event.currentTarget)}>+{batches.length - 2} more</button>{/if}
          </div>
        {/each}
      </div>
      <div id={overflowId} class="calendar-overflow" bind:this={overflowRegion} role="region" aria-label={overflowDay ? `More steps on ${overflowDay}` : 'Calendar overflow'} tabindex="-1">
        {#if overflowDay}<div class="row"><strong>{formatCalendarDate(overflowDay)}</strong><button class="btn small" onclick={closeMore}>Close</button></div>
          {#each (dayRows.get(overflowDay) ?? []).slice(2) as item (item.key)}<button class="calendar-chip" data-kind={item.kind} aria-label={eventLabel(item)} title={eventTitle(item)} onclick={() => openEvent(item)}>{overflowText(item)}</button>{/each}
        {/if}
      </div>
    </section>
<style>
.calendar .weekdays{flex:none}.calendar .month-grid{flex:0 1 360px;min-height:0;overflow:auto}
.calendar{min-width:0;min-height:0;display:flex;flex-direction:column;flex:1}.weekdays,.month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}.weekdays{font-size:12px;color:var(--text-muted);text-align:center;padding:4px}.month-grid{flex:none;height:360px;grid-template-rows:repeat(6,60px);border-top:1px solid var(--hairline);border-left:1px solid var(--hairline)}.day{min-width:0;overflow:hidden;padding:2px;display:flex;flex-direction:column;gap:1px;border-right:1px solid var(--hairline);border-bottom:1px solid var(--hairline);background:var(--glass)}.day time{font-size:11px;line-height:12px;flex:none}.outside{background:transparent;color:var(--text-muted)}.today{box-shadow:inset 0 0 0 2px var(--accent)}.calendar-chip,.more-chip{display:block;min-width:0;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;font-size:11px;line-height:12px;padding:0 3px;flex:none;border:1px solid var(--hairline);border-radius:var(--radius-sm);cursor:pointer;background:var(--glass-strong);color:var(--text-muted)}.more-chip{border:0;background:transparent;color:var(--accent)}.calendar-overflow{height:76px;flex:none;overflow:auto;border:1px solid var(--hairline);padding:4px;box-sizing:border-box;display:flex;flex-wrap:wrap;align-content:flex-start;gap:4px}.calendar-overflow .row{width:100%}.calendar-overflow .calendar-chip{width:auto;max-width:100%;padding:3px 6px}.calendar-chip{--step-colour:var(--text-muted);color:var(--text);background:color-mix(in srgb,var(--step-colour) 16%,var(--glass-strong));border:1px solid color-mix(in srgb,var(--step-colour) 65%,var(--hairline));border-left:3px solid var(--step-colour)}[data-kind=abrasion]{--step-colour:var(--warning)}[data-kind=dissolution]{--step-colour:var(--danger)}[data-kind=conversion]{--step-colour:var(--kind-sample_registered)}[data-kind=cleaning]{--step-colour:var(--accent)}[data-kind=loading]{--step-colour:var(--ok)}
.calendar-overflow .row{flex-wrap:wrap}button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}@media(max-width:1100px){.calendar-chip,.more-chip{font-size:10px;padding:0 2px}.day{padding:2px;gap:1px}}
</style>
