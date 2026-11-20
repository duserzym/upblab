<script lang="ts">
  import GrainImage from '../tims/GrainImage.svelte';
  import OperatorName from '../tims/OperatorName.svelte';
  import { timsRights } from '../../lib/tims-rights.svelte';
  import { review } from '../../lib/review.svelte';
  import { spotFractions } from '../../lib/review-data';
  import { capsuleLabel, mineralWords, statusWords } from '../../lib/tims-api';
  import { fractionChemistry } from '../../lib/tims-display';
  import { outbox } from '../../lib/outbox.svelte';
  import { overlayBatch } from '../../lib/tims-overlay';
  import { oversight, READ_ONLY_REASON } from '../../lib/oversight.svelte';
  import { editInAtlas } from '../../lib/apps.svelte';
  import { shell } from '../../lib/shell.svelte';
  const spot = $derived(review.selected);
  const matches = $derived(spot ? spotFractions(spot, review.fractionIndex) : []);
</script>
{#if matches.length}
  <section class="stack tims" aria-label="TIMS fractions">
    <h3>TIMS fractions</h3>
    {#if review.fractionNotice}<p class="small muted">{review.fractionNotice}</p>{/if}
    {#each matches as match (match.fraction.id)}
      {@const original = match.fraction}
      {@const stored = original.batch_id ? review.batches[original.batch_id] : undefined}
      {@const pending = outbox.entries.filter(e => e.objectKey === `batch:${original.batch_id}` || e.objectKey === `fraction:${original.id}` || e.objectKey === `capsule_set:${stored?.capsule_set_id}` || e.objectKey.startsWith('spike_version:') && !!stored?.spike_versions[e.objectKey.slice('spike_version:'.length)])}
      {@const batch = stored ? overlayBatch(stored, pending).batch : undefined}
      {@const fraction = { ...(batch?.fractions.find(f => f.id === original.id) ?? original), ...Object.assign({}, ...pending.filter(e => e.path === `/v1/fractions/${original.id}`).map(e => e.body)) }}
      {@const project = spot?.atlasProjectId ?? review.mounts.find(m => m.id === (match.source.mount_id ?? spot?.mountId))?.atlas?.project_id ?? null}
      {@const reason = oversight.viewAs ? READ_ONLY_REASON : !project ? 'No grainatlas project is available for this mount.' : !match.source.atlas_grain_id ? 'No grainatlas grain identity is available for this source.' : ''}
      <article class="panel stack small">
        <GrainImage source={{ ...match.source, mount_id: match.source.mount_id ?? spot?.mountId ?? null }} size={120} loadGeometry enabled={!!stored || !original.batch_id || !!review.batchErrors[original.batch_id]} />
        {#if match.source.mount_label || match.source.grain_label}<p>{match.source.mount_label || 'Mount name unavailable'} · {match.source.grain_label || 'Grain name unavailable'}</p>{/if}
        <p><strong>{fraction.name}</strong> · {capsuleLabel(fraction)} · {batch?.capsule_set.name ?? fraction.capsule_set_name ?? 'No capsule set'}</p>
        <p class:warning={fraction.status === 'dissolved_in_ca'}>{statusWords(fraction.status)} · {fraction.sample.name} · {mineralWords(fraction.mineral)}</p>
        {#if match.fromGrain}<p class="muted">from this grain</p>{/if}
        {#if match.source.is_fragment}<p>Fragment · {match.source.fragment_note}</p>{/if}
        {#if match.source.note}<p>{match.source.note}</p>{/if}
        {#if timsRights.recordReason(`fraction:${fraction.id}`) || fraction.batch_id && timsRights.recordReason(`batch:${fraction.batch_id}`)}<p class="muted">Read-only · {timsRights.recordReason(`fraction:${fraction.id}`) || timsRights.recordReason(`batch:${fraction.batch_id}`)}</p>{/if}
        {#if fraction.notes}<p>{fraction.notes}</p>{/if}
        {#if pending.length}<p class="muted">Saved here, not sent yet · {pending.flatMap(e => Object.keys(e.body as object)).join(', ')}</p>{/if}
        {#if batch}
          <p>Batch {batch.started_on} · <OperatorName {batch} /></p>
          <ol class="stack">
            {#each fractionChemistry(batch, fraction) as step (step.id)}
              <li><strong>{step.name}</strong>{step.skipped ? ' · skipped' : ''}{step.performedOn ? ` · ${step.performedOn}` : ''}
                {#each step.values as value}<p>{value}</p>{/each}
                {#if step.spike}<p>{step.spike}</p>{/if}
                {#if step.outcome}<p class:warning={step.outcome === 'dissolved during CA'}>{step.outcome}</p>{/if}
                {#if step.outcomeNote}<p>{step.outcomeNote}</p>{/if}
                {#if step.note}<p>{step.note}</p>{/if}
              </li>
            {/each}
          </ol>
        {:else if original.batch_id}
          <p class="muted">{review.batchErrors[original.batch_id] ?? 'Loading batch chemistry…'}</p>
        {/if}
        <div class="row actions">
          <button class="btn" disabled={!!reason} title={reason || 'Open this source in grainatlas'} onclick={() => void editInAtlas({ project, mount: match.source.mount_id ?? spot!.mountId, grain: match.source.atlas_grain_id, spot: match.source.atlas_spot_id }, 'review')}>Open grain in grainatlas</button>
          {#if fraction.batch_id}<button class="btn" onclick={() => void shell.openTimsBatch(fraction.batch_id!)}>Open batch</button>{/if}
        </div>
      </article>
    {/each}
  </section>
{/if}
<style>
  .tims {min-width:0;gap:4px;overflow-wrap:anywhere;} h3 {font-size:0.65rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin:0;}
  .small {font-size:0.78rem;line-height:1.3;} p {margin:0;} .panel {min-width:0;padding:6px;gap:3px;}
  ol {padding-left:18px;margin:0;gap:4px;} li {min-width:0;} .actions {flex-wrap:wrap;gap:4px;}
  .btn {font-size:0.73rem;padding:3px 8px;white-space:normal;text-align:left;} .warning {color:var(--warning);font-weight:600;}
</style>
