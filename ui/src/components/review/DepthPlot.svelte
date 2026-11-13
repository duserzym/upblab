<script lang="ts">
  import { containedPopover } from '../../lib/contained-popover';
  import Plot from './Plot.svelte';
  import { color } from './plot-data';
  import { review } from '../../lib/review.svelte';
  import { depthColumnLabel, groupDepthColumns, number, profileAxes, profileColumns } from '../../lib/review-data';
  import type { Point } from '../../lib/concordia';

  let channelAnchor = $state<HTMLButtonElement>();
  let chosen = $state<string[] | null>(null);
  let x = $state('signal_relative_time');
  let search = $state('');
  let category = $state('');
  const profile = $derived(review.depth);
  const columns = $derived(profile ? profileColumns(profile) : []);
  const axes = $derived(profile ? profileAxes(profile) : []);
  const xKey = $derived(axes.includes(x) ? x : axes.includes('signal_relative_time') ? 'signal_relative_time' : axes.includes('Time') ? 'Time' : axes[0]);
  const catalogue = $derived(groupDepthColumns(columns));
  const groups = $derived(groupDepthColumns(columns, search).filter(g => !category || g.group === category));
  const defaults = $derived.by(() => {
    const ages = ['206Pb/238U', '207Pb/206Pb'].flatMap(ratio => {
      const match = [`${ratio}_age`, `${ratio}_date`].find(k => columns.includes(k));
      return match ? [match] : [];
    });
    return ages.length ? ages : catalogue[0]?.keys.slice(0, 1) ?? [];
  });
  const visible = $derived((chosen ?? defaults).filter(c => columns.includes(c)));
  const marks = $derived(profile && review.selected && xKey ? visible.map(c => ({
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
    return [{ upper: bound(1), lower: bound(-1), color: color(depthColumnLabel(c)) }];
  }) : []);
  function toggle(column: string, checked: boolean) {
    const previous = chosen ?? defaults;
    chosen = checked ? [...previous, column] : previous.filter(c => c !== column);
  }
  const axisLabel = (axis: string) => ({
    signal_relative_time: 'Time from signal start (s)', time: 'Acquisition time (s)', time_s: 'Acquisition time (s)', depth_um: 'Depth (µm)',
  })[axis.toLowerCase()] ?? axis;
</script>
{#if review.depthState==='loading'}<p class="muted">Loading stored depth profile…</p>
{:else if review.depthState==='error'}<p class="error">Could not read the depth profile: {review.depthError}</p>
{:else if !profile?.columns.length}<p class="muted">This run has no stored depth profile for the selected spot.</p>
{:else if !xKey}<p class="muted">This profile has no stored time or depth axis.</p>
{:else}
  <div class="row wrap depth-controls">
    <label>Against <select aria-label="Depth profile axis" value={xKey} onchange={e => x = e.currentTarget.value}>
      {#each axes as c}<option value={c}>{axisLabel(c)}</option>{/each}
    </select></label>
    <button class="chip" popovertarget="depth-channel-picker" bind:this={channelAnchor}>Channels ({visible.length})</button>
    <span class="faint small">Stored sweeps and uncertainty bands</span>
  </div>
  <div id="depth-channel-picker" class="channel-picker" use:containedPopover={{anchor: () => channelAnchor, w: 420, h: 460}} popover="auto" role="group" aria-label="Depth profile channels">
    <div class="picker-heading">
      <strong>Depth profile channels</strong>
      <button class="chip" aria-label="Close channel picker" popovertarget="depth-channel-picker" popovertargetaction="hide">×</button>
    </div>
    <input type="search" aria-label="Search depth channels" placeholder="Find a ratio, element or date…" bind:value={search} />
    <label>Category <select aria-label="Depth channel category" bind:value={category}>
      <option value="">All categories</option>
      {#each catalogue as { group, keys }}<option value={group}>{group} ({keys.length})</option>{/each}
    </select></label>
    <div class="channel-list">
      {#each groups as { group, keys } (group)}
        <fieldset>
          <legend>{group}</legend>
          {#each keys as c (c)}
            <label title={c}><input type="checkbox" checked={visible.includes(c)} onchange={e => toggle(c, e.currentTarget.checked)} /> {depthColumnLabel(c)}</label>
          {/each}
        </fieldset>
      {:else}<p class="faint small">No channels match this search.</p>{/each}
    </div>
    <div class="row wrap">
      <button class="chip" onclick={() => chosen = null}>Restore defaults</button>
      <button class="chip" disabled={!visible.length} onclick={() => chosen = []}>Clear channels</button>
    </div>
    <p class="faint small">Use channels with compatible units on the same plot.</p>
  </div>
  {#if visible.length}
    <div class="row wrap active-channels" aria-label="Plotted depth channels">
      {#each visible as c (c)}
        <button class="chip" title={c} aria-label={`Remove ${depthColumnLabel(c)}`} onclick={() => toggle(c, false)}><i style:background={color(depthColumnLabel(c))}></i>{depthColumnLabel(c)} <span aria-hidden="true">×</span></button>
      {/each}
    </div>
  {/if}
  <Plot sharedHover={false} legend={false} {marks} {bands} selected={null} onselect={()=>{}} xLabel={axisLabel(xKey)} yLabel="Stored values" />
{/if}
<style>
  .depth-controls {gap:7px;}
  .channel-picker {width:min(420px,calc(100vw - 24px));padding:12px;background:var(--plot-bg);color:var(--text);border:1px solid var(--hairline);border-radius:var(--radius);box-shadow:var(--glass-shadow);}
  .channel-picker:popover-open {display:grid;gap:8px;}
  .picker-heading {display:flex;justify-content:space-between;align-items:center;}
  .channel-list {max-height:min(42vh,320px);overflow:auto;overscroll-behavior:contain;}
  fieldset {margin:4px 0 8px;padding:4px 8px;border:1px solid var(--hairline);min-width:0;}
  legend {font-size:0.74rem;color:var(--text-muted);}
  fieldset label {display:flex;align-items:center;gap:6px;padding:3px 0;overflow-wrap:anywhere;}
  .active-channels {gap:4px;max-height:80px;overflow:auto;}
  .active-channels .chip {font-size:0.72rem;padding:2px 6px;gap:4px;max-width:100%;overflow-wrap:anywhere;}
  i {width:8px;height:8px;flex:none;border-radius:50%;}
</style>
