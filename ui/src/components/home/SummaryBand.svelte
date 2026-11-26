<script lang="ts">
  import { overview } from '../../lib/overview.svelte';
  import { day, mountHomeLink, notReduced, sessionsShown } from '../../lib/home';
  import type { HomePin } from '../../lib/home-pins';
  import { shell } from '../../lib/shell.svelte';
  let { pins, canPin, togglePin, showPending, showWithoutAtlas }: {
    pins: HomePin[]; canPin: boolean; togglePin: (pin: HomePin) => void;
    showPending: () => void; showWithoutAtlas: () => void;
  } = $props();
  let expanded = $state(false);
  let pinArea = $state<HTMLDivElement>();
  let pinMeasure = $state<HTMLDivElement>();
  let visiblePins = $state(0);
  const hiddenPins = $derived(Math.max(0, pins.length - visiblePins));
  const latest = $derived(sessionsShown(overview.sessions, '', 'newest')[0]);
  const pending = $derived(overview.sessions.filter(notReduced).length);
  const withoutAtlas = $derived(overview.mounts.filter(row => !row.detailsPending && row.atlas === null).length);
  const sessionIds = $derived(new Set(overview.sessions.map(row => row.session.id)));
  const mounts = $derived(new Map(overview.mounts.map(row => [row.mount.id, row])));
  const loaded = (pin: HomePin) => pin.kind === 'session' ? sessionIds.has(pin.id) : mounts.has(pin.id);
  function open(pin: HomePin) {
    const mount = pin.kind === 'mount' ? mounts.get(pin.id) : undefined;
    void shell.handleLink(mount ? mountHomeLink(mount) : `upbdb://${pin.kind}/${pin.id}`, 'home');
  }

  $effect(() => {
    const area = pinArea, measure = pinMeasure, count = pins.length;
    if (!area || !measure) return;
    let frame = 0;
    const fit = () => {
      frame = 0;
      // Read all geometry together, once per resize or pin change. The measuring
      // row stays independent of the visible count and expanded layout.
      const available = area.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(area).columnGap) || 0;
      const widths = [...measure.querySelectorAll('.pinned-chip')].map(el => el.getBoundingClientRect().width);
      const overflowWidths = [...measure.querySelectorAll('.pin-overflow')].map(el => el.getBoundingClientRect().width);
      const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, count - 1) * gap;
      let fitting = count;
      if (total > available) {
        fitting = 0;
        let used = 0;
        for (let i = 0; i < count - 1; i++) {
          used += widths[i] + (i ? gap : 0);
          if (used + gap + overflowWidths[count - i - 2] <= available) fitting = i + 1;
        }
      }
      visiblePins = fitting;
    };
    function schedule() {
      if (!frame) frame = requestAnimationFrame(fit);
    }
    const observer = new ResizeObserver(schedule);
    observer.observe(area);
    for (const child of measure.children) observer.observe(child);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  });
</script>

{#snippet pinChip(pin: HomePin, measuring = false)}
  <span class="chip pinned-chip" data-testid={measuring ? undefined : 'pinned-item'}>
    <button class="linkish pin-label" title={pin.label} onclick={() => open(pin)}>{pin.label}{#if !loaded(pin)} <span class="muted">· not loaded</span>{/if}</button>
    <button class="unpin" aria-label="Unpin {pin.label}" onclick={() => togglePin(pin)}>×</button>
  </span>
{/snippet}
<section class="glass panel summary-band" aria-label="Pinned lab summary" data-testid="home-summary">
  <div class="summary-cells">
    <div class="summary-cell"><span class="small muted">Inventory</span><strong>{overview.totalSessions} <span>sessions</span> / {overview.totalMounts} <span>mounts</span></strong></div>
    <div class="summary-cell"><span class="small muted" title="Latest among loaded sessions">Latest session</span>
      {#if latest}<button class="linkish mono latest" title={latest.session.session_key} onclick={() => void shell.handleLink(`upbdb://session/${latest.session.id}`, 'home')}>{latest.session.session_key}</button><span class="small muted">{day(latest.session.started_at)}</span>
      {:else}<span class="small muted">No loaded sessions</span>{/if}
    </div>
    <div class="summary-cell"><span class="small muted" title="Pending reductions among loaded sessions">Pending reductions</span><strong>{pending}</strong><button class="linkish small" onclick={showPending}>Show not reduced →</button></div>
    <div class="summary-cell"><span class="small muted" title="Mounts without atlas among loaded mounts">Mounts without atlas</span><strong>{withoutAtlas}</strong><button class="linkish small" onclick={showWithoutAtlas}>Show without atlas →</button></div>
  </div>
  {#if canPin}
    <div class="pinned-row" data-testid="home-pins">
      <strong class="small">Pinned</strong>
      <div class="pin-area" bind:this={pinArea}>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (Focusable overflow list supports keyboard scrolling.) -->
        <div class="pin-strip" class:expanded tabindex="0" role="group" aria-label="Pinned items">
          {#each expanded ? pins : pins.slice(0, visiblePins) as pin (`${pin.kind}|${pin.id}`)}
            {@render pinChip(pin)}
          {/each}
          {#if !pins.length}<span class="small faint">Pin sessions and mounts to keep them here.</span>{/if}
        </div>
        {#if expanded || hiddenPins > 0}<button class="chip pin-overflow" aria-expanded={expanded} onclick={() => expanded = !expanded}>{expanded ? 'Show fewer' : `+${hiddenPins}`}</button>{/if}
        <div class="pin-measure" bind:this={pinMeasure} aria-hidden="true" inert>
          {#each pins as pin (`${pin.kind}|${pin.id}`)}{@render pinChip(pin, true)}{/each}
          <!-- Reserve the exact width of each possible +N label. Pins are capped at 50. -->
          {#each pins as _, i}<button class="chip pin-overflow">+{i + 1}</button>{/each}
        </div>
      </div>
      {#if pins.length >= 50}<span class="small muted">50 pin limit</span>{/if}
    </div>
  {/if}
</section>
<style>
  .summary-band { flex: none; padding: var(--space-2) var(--space-3); min-width: 0; box-shadow: none; border-width: 0 0 1px; border-color: var(--hairline); border-radius: 0; background: transparent; backdrop-filter: none; -webkit-backdrop-filter: none; }
  .summary-cells { display: grid; grid-template-columns: 1fr 1.4fr 1fr 1fr; min-width: 0; }
  .summary-cell { min-width: 0; padding: 0 var(--space-3); border-right: 1px solid var(--hairline); display: flex; flex-direction: column; gap: 2px; }
  .summary-cell:first-child { padding-left: 0; }
  .summary-cell:last-child { border: 0; }
  .summary-cell strong { font-size: 1.1rem; font-weight: 550; font-variant-numeric: tabular-nums; }
  .summary-cell strong span { font-size: 0.78rem; font-weight: 400; }
  .small { font-size: 0.74rem; }
  .linkish { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; font: inherit; text-align: left; min-width: 0; }
  .linkish.small { font-size: 0.74rem; }
  .linkish:hover { text-decoration: underline; }
  .latest { font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pinned-row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; margin-top: var(--space-2); border-top: 1px solid var(--hairline); padding-top: var(--space-1); }
  .pinned-row > strong, .pinned-row > button, .pinned-row > span { flex: none; white-space: nowrap; }
  .pin-area { position: relative; display: flex; align-items: center; gap: var(--space-2); min-width: 0; flex: 1; }
  .pin-overflow { flex: none; white-space: nowrap; }
  .pin-measure { position: absolute; inset: 0; display: flex; align-items: center; gap: var(--space-2); overflow: hidden; visibility: hidden; pointer-events: none; }
  .pin-strip { height: 26px; overflow: hidden; min-width: 0; flex: 1; display: flex; gap: var(--space-2); align-items: center; }
  .pin-strip.expanded { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 26px; gap: 0 var(--space-2); overflow-y: auto; }
  .pinned-chip { display: inline-flex; flex: none; align-items: center; min-width: 0; max-width: 20rem; padding: 0 var(--space-1) 0 var(--space-2); }
  .pin-strip.expanded .pinned-chip { max-width: 100%; }
  .pin-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.78rem; }
  .unpin { flex: none; min-width: 24px; min-height: 24px; border: 0; background: transparent; color: var(--text-muted); cursor: pointer; }
</style>
