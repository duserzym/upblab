<script module lang="ts">
  // Kept across plot/tab remounts for this app session.
  let channelsOpen = $state(false);
</script>
<script lang="ts">
  import Plot from './Plot.svelte';
  import { color } from './plot-data';
  import { review } from '../../lib/review.svelte';
  import { depthColumnLabel, groupDepthColumns, number, profileAxes, profileColumns } from '../../lib/review-data';
  import type { Point } from '../../lib/concordia';

  let channelButton = $state<HTMLButtonElement>();
  function escape(event: KeyboardEvent) {
    if (event.key === 'Escape' && channelsOpen && channelButton?.getClientRects().length && !event.defaultPrevented && !document.querySelector(':popover-open')) {
      channelsOpen = false; event.preventDefault(); channelButton?.focus();
    }
  }
  let chosen = $state<string[] | null>(null);
  let x = $state('signal_relative_time');
  let search = $state('');
  const profile = $derived(review.depth);
  const columns = $derived(profile ? profileColumns(profile) : []);
  const axes = $derived(profile ? profileAxes(profile) : []);
  const xKey = $derived(axes.includes(x) ? x : axes.includes('signal_relative_time') ? 'signal_relative_time' : axes.includes('Time') ? 'Time' : axes[0]);
  const catalogue = $derived(groupDepthColumns(columns));
  const groups = $derived(groupDepthColumns(columns, search));
  const defaults = $derived.by(() => {
    const ages = ['206Pb/238U', '207Pb/206Pb'].flatMap(ratio => {
      const match = [`${ratio}_age`, `${ratio}_date`].find(k => columns.includes(k));
      return match ? [match] : [];
    });
    return ages.length ? ages : catalogue[0]?.keys.slice(0, 1) ?? [];
  });
  const visible = $derived((chosen ?? defaults).filter(c => columns.includes(c)));
  const hiddenColumns = $derived.by(() => {
    const hidden = new Set(columns);
    for (const column of visible) hidden.delete(column);
    return hidden;
  });
  const marks = $derived(profile && review.selected && xKey ? visible.map(c => ({
    seriesKey: c,
    spot: { ...review.selected!, key: c, sampleName: depthColumnLabel(c) },
    path: profile.data[xKey].map((v, i) => {
      const a = number(v), b = number(profile.data[c]?.[i]);
      return a === null || b === null ? null : [a, b] as Point;
    })
  })) : []);
  const bands = $derived(profile && xKey ? visible.flatMap(c => {
    const uncertainty = ['_2e', '_2s', '_95CI'].map(s => c + s).find(k => profile.data[k]);
    if (!uncertainty) return [];
    const bound = (sign: number) => profile.data[xKey].map((v, i) => {
      const a = number(v), b = number(profile.data[c]?.[i]), e = number(profile.data[uncertainty]?.[i]);
      return a === null || b === null || e === null ? null : [a, b + sign * e] as Point;
    });
    return [{ seriesKey: c, upper: bound(1), lower: bound(-1), color: color(depthColumnLabel(c)) }];
  }) : []);
  function toggle(column: string, checked: boolean) {
    const previous = chosen ?? defaults;
    chosen = checked ? [...new Set([...previous, column])] : previous.filter(c => c !== column);
  }
  function toggleGroup(keys: string[]) {
    chosen = keys.every(c => visible.includes(c))
      ? visible.filter(c => !keys.includes(c)) : [...new Set([...visible, ...keys])];
  }
  const axisLabel = (axis: string) => ({
    signal_relative_time: 'Time from signal start (s)', time: 'Acquisition time (s)', time_s: 'Acquisition time (s)', depth_um: 'Depth (µm)',
  })[axis.toLowerCase()] ?? axis;
</script>
<svelte:window onkeydown={escape} />
{#if review.depthState==='loading'}<p class="muted">Loading stored depth profile…</p>
{:else if review.depthState==='error'}<p class="error">Could not read the depth profile: {review.depthError}</p>
{:else if !profile?.columns.length}<p class="muted">This run has no stored depth profile for the selected spot.</p>
{:else if !xKey}<p class="muted">This profile has no stored time or depth axis.</p>
{:else}
  <div class="depth-area">
    <div class="row wrap depth-controls">
      <label>Against <select aria-label="Depth profile axis" value={xKey} onchange={e => x = e.currentTarget.value}>
        {#each axes as c}<option value={c}>{axisLabel(c)}</option>{/each}
      </select></label>
      <button class="chip" bind:this={channelButton} aria-expanded={channelsOpen} aria-controls="depth-channel-picker" onclick={() => channelsOpen = !channelsOpen}>Channels ({visible.length})</button>
      <span class="faint small">Stored sweeps and uncertainty bands</span>
    </div>
    <div class="depth-layout">
      {#if channelsOpen}
        <div id="depth-channel-picker" class="channel-picker" role="group" aria-label="Depth profile channels">
          <div class="picker-heading">
            <strong>Depth profile channels</strong>
            <button class="chip" aria-label="Close channel picker" onclick={() => channelsOpen = false}>×</button>
          </div>
          <input type="search" aria-label="Search depth channels" placeholder="Find a ratio, element or date…" bind:value={search} />
          {#each groups as { group, keys } (group)}
            {@const count = keys.filter(c => visible.includes(c)).length}
            <fieldset>
              <legend>{group}</legend>
              <button class="chip group-toggle" role="checkbox" aria-label={`Select all ${group} channels`} aria-checked={count === keys.length ? true : count ? 'mixed' : false} onclick={() => toggleGroup(keys)}>{count === keys.length ? 'Select none' : 'Select all'}</button>
              {#each keys as c (c)}
                <label title={c}><input type="checkbox" checked={visible.includes(c)} onchange={e => toggle(c, e.currentTarget.checked)} /><i style:background={color(depthColumnLabel(c))}></i>{depthColumnLabel(c)}</label>
              {/each}
            </fieldset>
          {:else}<p class="faint small">No channels match this search.</p>{/each}
          <div class="row wrap">
            <button class="chip" onclick={() => chosen = null}>Restore defaults</button>
            <button class="chip" disabled={!visible.length} onclick={() => chosen = []}>Clear channels</button>
          </div>
          <p class="faint small">Use channels with compatible units on the same plot.</p>
        </div>
      {/if}
      <div class="depth-result">
        {#if !channelsOpen && visible.length}
          <div class="row wrap active-channels" aria-label="Plotted depth channels">
            {#each visible as c (c)}
              <button class="chip" title={c} aria-label={`Remove ${depthColumnLabel(c)}`} onclick={() => toggle(c, false)}><i style:background={color(depthColumnLabel(c))}></i>{depthColumnLabel(c)} <span aria-hidden="true">×</span></button>
            {/each}
          </div>
        {/if}
        <Plot sharedHover={false} legend={false} {marks} {bands} hidden={hiddenColumns} selected={null} onselect={()=>{}} xLabel={axisLabel(xKey)} yLabel="Stored values" />
      </div>
    </div>
  </div>
{/if}
<style>
  .depth-area {display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;gap:8px;container:depth / inline-size;}
  .depth-controls {gap:7px;flex:none;}
  .depth-layout {display:flex;flex:1;min-height:0;min-width:0;gap:8px;}
  .depth-result {display:flex;flex-direction:column;flex:1;min-height:150px;min-width:0;gap:8px;}
  .channel-picker {display:flex;flex-direction:column;gap:8px;flex:0 0 240px;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px;background:var(--plot-bg);color:var(--text);border:1px solid var(--hairline);border-radius:var(--radius-sm);}
  .channel-picker > * {flex-shrink:0;}
  .channel-picker input[type="search"] {width:100%;min-width:0;}
  .picker-heading {display:flex;justify-content:space-between;align-items:center;gap:4px;font-size:0.8rem;}
  fieldset {margin:0;padding:4px 8px;border:1px solid var(--hairline);min-width:0;}
  legend {font-size:0.74rem;color:var(--text-muted);}
  fieldset label {display:flex;align-items:center;gap:6px;padding:3px 0;overflow-wrap:anywhere;width:100%;}
  .group-toggle {font-size:0.72rem;margin-bottom:4px;}
  .active-channels {gap:4px;max-height:80px;overflow:auto;flex:none;}
  .active-channels .chip {font-size:0.72rem;padding:2px 6px;gap:4px;max-width:100%;overflow-wrap:anywhere;}
  i {display:inline-block;width:8px;height:8px;flex:none;border-radius:50%;}
  @container depth (max-width:620px) {
    .depth-layout {flex-direction:column;}
    .channel-picker {flex:0 1 auto;max-height: min(240px, 45%);}
  }
</style>
