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
    return `${n.toFixed(d)} ± ${u.toFixed(d)} (2se)`;
  };
</script>
{#if spot}
  <h2>{spot.label}</h2>
  <dl class="grid-kv small">
    <dt>{spot.isReference ? 'Reference material' : 'Sample'}</dt><dd>{spot.sampleName}</dd>
    {#if spot.isReference}<dt>Role</dt><dd>{spot.kind.replaceAll('_', ' ')}</dd>{/if}
    <dt>Grain</dt><dd>{spot.grainLabel??'No grain'}</dd>
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
        <dt>{names[metric]??metric}</dt><dd>{pair(spot.values[metric], spot.values[metric+'_2e'])}</dd>
      {/each}
    </dl>
    <h3>Flags</h3>
    {#if spot.flags.length}<ul class="small warning">{#each spot.flags as flag}<li>{flag}</li>{/each}</ul>{:else}<p class="small faint">None recorded</p>{/if}
    <h3>Run</h3><p class="mono small" title={spot.runId}>{spot.runId.slice(0,12)} · {run?.is_preferred?'preferred':'not preferred'}</p>
    <p class="small muted">Pipeline {run?.pipeline_version??'not recorded'} · {run?.run_by??'operator not recorded'}</p>
  {/if}
  <div class="stack">
    <button class="btn" disabled={!spot.atlasProjectId} title={spot.atlasProjectId ? 'Edit in grainatlas (E)' : 'No published images'} onclick={() => void editInAtlas({ project: spot!.atlasProjectId, mount: spot!.mountId, spot: spot!.atlasSpotId }, 'review')}>Edit in grainatlas</button>
    <button class="btn" disabled={!spot.runId && !spot.sessionId} title={spot.runId || spot.sessionId ? 'Open in Studio (S)' : 'Not measured yet'} onclick={() => void openInStudio({ session: spot!.sessionId, run: spot!.runId, acquisition: spot!.acquisitionId }, 'review')}>Open in Studio</button>
    <AtlasGuidance mount={spot.mountId} from="review" />
    <StudioGuidance from="review" />
    <button class="btn" disabled={!spot.atlasProjectId||!spot.atlasSpotId} onclick={()=>void review.focus(spot!,true)}>Show in Images</button>
    {#if spot.acquisitionId}<button class="btn" onclick={()=>void shell.handleLink(`laicpmsdb://acquisition/${spot!.acquisitionId}`,'review')}>Raw sweeps in Sessions</button>{/if}
  </div>
{:else}<p class="muted">Select a spot to see its stored results.</p>{/if}
<style>
  h2,h3,p {margin:0;} h3 {font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-top:4px;} dd {min-width:0;overflow-wrap:anywhere;} dt {min-width:0;}
  .stack {gap:8px;} .btn {font-size:0.78rem;white-space:normal;text-align:left;}
  ul {margin:0;padding-left:18px;} .warning {color:var(--warning);}
  .grid-kv {grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);margin:0;}
</style>
