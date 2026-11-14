<script lang="ts">
  import { editInAtlas, openInStudio } from '../../lib/apps.svelte';
  import AtlasGuidance from '../AtlasGuidance.svelte';
  import StudioGuidance from '../StudioGuidance.svelte';
  import { review } from '../../lib/review.svelte';
  import { shell } from '../../lib/shell.svelte';
  import { dateLabel, number } from '../../lib/review-data';
  const spot = $derived(review.selected);
  const run = $derived(spot?.runId ? review.runInfo[spot.runId] : null);
  const metrics = ['206Pb/238U_age', '207Pb/206Pb_age', '206Pb/238U', '207Pb/206Pb', '207Pb/235U', '238U/206Pb', 'U', 'Th', 'Pb', 'Th/U', 'disc%'];
  const names: Record<string, string> = { '206Pb/238U_age': '206Pb/238U date (Ma)', '207Pb/206Pb_age': '207Pb/206Pb date (Ma)', 'disc%': 'Discordance (%)', 'U': 'U (ppm)', 'Th': 'Th (ppm)', 'Pb': 'Pb (ppm)' };
  const fmt = (v: unknown) => { const n = number(v); return n === null ? '—' : Number(n.toPrecision(4)).toString(); };
  /** A value with its 2se, both rounded to two significant figures of the uncertainty. */
  const pair = (v: unknown, e: unknown) => {
    const n = number(v), u = number(e);
    if (n === null) return '—';
    if (u === null || u <= 0) return fmt(n);
    const d = Math.min(8, Math.max(0, 1 - Math.floor(Math.log10(u))));
    return `${n.toFixed(d)} ± ${u.toFixed(d)}`;
  };
</script>
{#if spot}
  <div class="details">
    <header class="identity">
      <div class="identity-actions">
        <h2>{spot.label}</h2>
        <div class="openers row">
        <button class="btn" disabled={!spot.atlasProjectId} title={spot.atlasProjectId ? 'Edit in grainatlas (E)' : 'No published images'} onclick={() => void editInAtlas({ project: spot!.atlasProjectId, mount: spot!.mountId, spot: spot!.atlasSpotId }, 'review')}>Edit in grainatlas</button>
        <button class="btn" disabled={!spot.runId && !spot.sessionId} title={spot.runId || spot.sessionId ? 'Open in Studio (S)' : 'Not measured yet'} onclick={() => void openInStudio({ session: spot!.sessionId, run: spot!.runId, acquisition: spot!.acquisitionId }, 'review')}>Open in Studio</button>
        </div>
      </div>
      <p class="small">{spot.isReference ? `${spot.sampleName} · ${spot.kind.replaceAll('_', ' ')}` : spot.sampleName} · grain {spot.grainLabel??'none'}</p>
      <p class="small muted">{review.mounts.find(m=>m.id===spot.mountId)?.label??spot.mountId??'No mount'} · {spot.sessionKey??spot.sessionId??'no session'}</p>
      <AtlasGuidance mount={spot.mountId} from="review" />
      <StudioGuidance from="review" />
    </header>
    {#if !spot.acquisitionId || !spot.runId}
      <p class="muted">{spot.acquisitionId?'no result in this run':'not measured yet · no result in this run'}</p>
    {:else}
      <section class="date">
        <h3>Preferred date</h3>
        <p class="value">{dateLabel(spot)}{spot.date?' Ma':''}</p>
        <p class="small muted">{spot.date?.method??'No stored method'} · 2σ (2se) · {spot.date?.passes===true?'pass':spot.date?.passes===false?'does not pass':'pass not recorded'}</p>
      </section>
      <section class="values">
        <h3>Dates, ratios and concentrations (± 2se)</h3>
        <dl class="grid-kv small">
          {#each metrics.filter(metric => !spot.date?.method || metric !== `${spot.date.method}_age`) as metric}
            <dt>{names[metric]??metric}</dt><dd class="num">{pair(spot.values[metric], spot.values[metric+'_2e'])}</dd>
          {/each}
        </dl>
      </section>
      <section class="flags">
        <h3>Flags</h3>
        {#if spot.flags.length}<ul class="small warning">{#each spot.flags as flag}<li>{flag}</li>{/each}</ul>{:else}<p class="small faint">None recorded</p>{/if}
      </section>
    {/if}
    <div class="more row">
      {#if spot.acquisitionId}<button class="btn" onclick={()=>void shell.handleLink(`laicpmsdb://acquisition/${spot!.acquisitionId}`,'review')}>Raw sweeps in Sessions</button>{/if}
    </div>
    {#if spot.acquisitionId && spot.runId}
      <section class="run-info" data-testid="spot-run">
        <h3>Run</h3><p class="mono small run" title={spot.runId}>{spot.runId.slice(0,12)} · {run?.is_preferred?'preferred':'not preferred'}</p>
        <p class="small muted">Pipeline {run?.pipeline_version??'not recorded'} · {run?.run_by??'operator not recorded'}</p>
      </section>
    {/if}
  </div>
{:else}<p class="muted">Select a spot to see its stored results.</p>{/if}
<style>
  .details {display:grid;gap:4px;min-width:0;}
  h2,h3,p {margin:0;} h2 {font-size:1rem;overflow-wrap:anywhere;min-width:0;}
  h3 {font-size:0.65rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin:0 0 2px;}
  .small,.grid-kv {font-size:0.78rem;line-height:1.3;}
  .identity {display:grid;gap:2px;min-width:0;} .identity p {overflow-wrap:anywhere;}
  .identity-actions {display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;min-width:0;}
  .identity-actions h2 {flex:1 1 auto;}
  .openers, .more {flex-wrap:wrap;gap:4px;} .btn {font-size:0.73rem;padding:3px 8px;white-space:normal;text-align:left;}
  .value {font-size:1.1rem;font-weight:600;white-space:nowrap;}
  dd {min-width:0;} dt {min-width:0;overflow-wrap:normal;word-break:keep-all;} .num {white-space:nowrap;overflow-wrap:normal;}
  .run {overflow-wrap:anywhere;}
  ul {margin:0;padding-left:16px;} .warning {color:var(--warning);}
  .grid-kv {grid-template-columns:minmax(min-content,1fr) max-content;gap:1px 8px;margin:0;}
  /* The dock body is the query container for the grid itself. */
  @container (min-width: 560px) {
    .details {grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);grid-template-areas:"id id" "date values" "flags values" "more values" "run run";align-items:start;column-gap:8px;}
    .identity {grid-area:id;} .date {grid-area:date;} .values {grid-area:values;} .flags {grid-area:flags;} .more {grid-area:more;} .run-info {grid-area:run;}
    .run-info h3 {display:inline;margin-right:8px;} .run-info .run {display:inline;}
  }
  @container (min-width: 900px) {
    .details {grid-template-columns:minmax(0,1fr) minmax(0,1.3fr) minmax(0,0.9fr);grid-template-areas:"id values flags" "date values more" "run run run";}
  }
</style>
