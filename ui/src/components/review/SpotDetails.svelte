<script lang="ts">
  import { review } from '../../lib/review.svelte';
  import { shell } from '../../lib/shell.svelte';
  import { dateLabel, number } from '../../lib/review-data';
  const spot = $derived(review.selected);
  const run = $derived(spot?.runId ? review.runInfo[spot.runId] : null);
  const metrics = ['206Pb/238U_age', '207Pb/206Pb_age', '206Pb/238U', '207Pb/206Pb', '207Pb/235U', '238U/206Pb', 'U', 'Th', 'Pb', 'Th/U', 'disc%'];
  const names: Record<string, string> = { '206Pb/238U_age': '206Pb/238U date (Ma)', '207Pb/206Pb_age': '207Pb/206Pb date (Ma)', 'disc%': 'Discordance (%)', 'U': 'U (ppm)', 'Th': 'Th (ppm)', 'Pb': 'Pb (ppm)' };
  const fmt = (v: unknown) => { const n = number(v); return n === null ? '—' : Number(n.toPrecision(6)).toString(); };
</script>
{#if spot}
  <h2>{spot.label}</h2>
  <dl class="grid-kv small">
    <dt>Sample</dt><dd>{spot.sampleName}</dd><dt>Grain</dt><dd>{spot.grainLabel??'No grain'}</dd>
    <dt>Mount</dt><dd>{review.mounts.find(m=>m.id===spot.mountId)?.label??spot.mountId??'—'}</dd>
    <dt>Session</dt><dd>{spot.sessionKey??spot.sessionId??'—'}</dd>
  </dl>
  {#if !spot.acquisitionId || !spot.runId}
    <p class="muted">{spot.acquisitionId?'no result in this run':'not measured yet · no result in this run'}</p>
  {:else}
    <h3>Preferred date</h3>
    <p>{dateLabel(spot)}{spot.date?' Ma':''}</p>
    <p class="small muted">{spot.date?.method??'No stored method'} · 2σ (2se) · {spot.date?.passes===true?'pass':spot.date?.passes===false?'does not pass':'pass not recorded'}</p>
    <dl class="grid-kv small">
      {#each metrics as metric}
        <dt>{names[metric]??metric}</dt><dd>{fmt(spot.values[metric])}{#if number(spot.values[metric+'_2e'])!==null} ± {fmt(spot.values[metric+'_2e'])} (2se){/if}</dd>
      {/each}
    </dl>
    <h3>Flags</h3>
    {#if spot.flags.length}<ul class="small warning">{#each spot.flags as flag}<li>{flag}</li>{/each}</ul>{:else}<p class="small faint">None recorded</p>{/if}
    <h3>Run</h3><p class="mono small" title={spot.runId}>{spot.runId.slice(0,12)} · {run?.is_preferred?'preferred':'not preferred'}</p>
    <p class="small muted">Pipeline {run?.pipeline_version??'not recorded'} · {run?.run_by??'operator not recorded'}</p>
  {/if}
  <div class="stack">
    <button class="btn" disabled={!spot.atlasProjectId||!spot.atlasSpotId} onclick={()=>void review.focus(spot!,true)}>Show in Images</button>
    {#if spot.acquisitionId}<button class="btn" onclick={()=>void shell.handleLink(`laicpmsdb://acquisition/${spot!.acquisitionId}`,'review')}>Raw sweeps in Sessions</button>{/if}
    {#if spot.runId}<button class="btn" onclick={()=>void shell.handleLink(`upbr://run/${spot!.runId}`,'review')}>Open run in Studio</button>{/if}
  </div>
{:else}<p class="muted">Select a spot to see its stored results.</p>{/if}
<style>
  h2,h3,p {margin:0;} h3 {font-size:0.9rem;} dd {min-width:0;overflow-wrap:anywhere;} dt {min-width:0;}
  ul {margin:0;padding-left:18px;} .warning {color:var(--warning);}
  .grid-kv {grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);margin:0;}
</style>
