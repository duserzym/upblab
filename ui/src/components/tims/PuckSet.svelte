<script lang="ts">
  import { statusWords, type BatchDetail, type FractionStepRecord } from '../../lib/tims-api';
  import { capsulePucks, puckSlotCoordinates, sourceSpotNames, type MountGeometry } from '../../lib/tims-geometry';
  import { capsulePreparations, readCapsulePreparation } from '../../lib/tims-capsule-intake';
  import { batchReadiness } from '../../lib/tims-readiness';
  import GrainImage from './GrainImage.svelte';

  let { batch, geometry, geometryError, selected, onselect, compact = false }: {
    batch: BatchDetail; geometry: Record<string, MountGeometry>; geometryError: string;
    compact?: boolean; selected: number | null; onselect: (position: number) => void;
  } = $props();

  const readiness = $derived(batchReadiness(batch));
  const readinessByPosition = $derived(new Map(readiness.capsules.map(c => [c.capsule_number, c])));
  const pucks = $derived(capsulePucks(batch.capsule_set.positions, batch.capsule_set.positions_per_puck));
  const fractions = $derived(new Map(batch.fractions.map(f => [f.id, f])));
  const methods = $derived(new Map(batch.steps.map(s => [s.id, s.method_code])));
  const outcomes = $derived.by(() => {
    const records = new Map<string, FractionStepRecord[]>();
    for (const record of batch.fraction_step_records) {
      if (!record.outcome) continue;
      const group = records.get(record.fraction_id) ?? [];
      group.push(record);
      records.set(record.fraction_id, group);
    }
    return records;
  });

  function location(index: number, capacity: number) {
    const { x, y } = puckSlotCoordinates(index, capacity);
    return `--x:${x}%;--y:${y}%`;
  }
</script>

<div class="puck-set" class:compact>
  {#each pucks as puck, index (puck[0])}
    <section class="puck" aria-label={`Puck ${index + 1}`}>
      <div class="positions" class:ring={batch.capsule_set.positions_per_puck <= 6} class:bsu={batch.capsule_set.positions_per_puck === 5}>
        {#if batch.capsule_set.positions_per_puck === 5}<span class="stem-bore" aria-hidden="true"></span>{/if}
        {#each puck as position, slot (position)}
          {@const id = batch.capsule_map[String(position)]}
          {@const fraction = id ? fractions.get(id) : undefined}
          {@const source = fraction?.sources.find(s => !s.retired_at && s.mount_id)}
          {@const label = batch.capsule_set.capsule_labels[position - 1] ?? batch.capsule_set.code + position}
          {@const state = fraction ? statusWords(fraction.status) : 'empty'}
          {@const spotNames = fraction ? sourceSpotNames(fraction.sources, geometry).join(', ') : ''}
          {@const preparation = fraction ? readCapsulePreparation(fraction.notes).preparation : null}
          {@const detail = fraction ? [preparation && capsulePreparations[preparation], fraction.sample.name, spotNames, state, ...(outcomes.get(fraction.id) ?? []).map(r => r.outcome === 'fully_dissolved' && methods.get(r.step_id) === 'SP-TIMS-CA' ? 'dissolved during CA' : statusWords(r.outcome)), ...(fraction.sources.some(s => !s.retired_at && s.is_fragment) ? ['fragment'] : [])].filter(Boolean).join(' · ') : 'Prepare this capsule'}
          <button class="btn capsule" class:filled={!!fraction} type="button" data-testid="tims-capsule"
            aria-label={`${label} ${fraction?.name ?? 'empty'}${preparation ? ' · ' + capsulePreparations[preparation] : ''}${spotNames ? ' · ' + spotNames : ''}`} aria-pressed={selected === position}
            title={detail} style={batch.capsule_set.positions_per_puck <= 6 ? location(slot, batch.capsule_set.positions_per_puck) : undefined} onclick={() => onselect(position)}>
            <span class="well">
              {#if source}<GrainImage {source} mount={source.mount_id ? geometry[source.mount_id] : undefined} size={36} lazy {geometryError} />
              {:else if fraction}<span class="fraction-mark">{preparation === 'lab-blank' ? 'Blank' : fraction.name}</span>
              {:else}<span class="empty-mark" aria-hidden="true">+</span>{/if}
            </span>
            <strong>{label}</strong>
            <span class="readiness-mark" title={`${label}: grain ${readinessByPosition.get(position)?.grain ? 'complete' : 'pending'} · spike ${readinessByPosition.get(position)?.spike ? 'complete' : 'pending'}`}>G {readinessByPosition.get(position)?.grain ? '✓' : '·'} S {readinessByPosition.get(position)?.spike ? '✓' : '·'}</span>
          </button>
        {/each}
      </div>
      <div class="caption"><h4>Puck {index + 1}</h4><span class="small muted">{puck.filter(n => !!batch.capsule_map[String(n)]).length} / {puck.length} assigned</span></div>
    </section>
  {/each}
</div>

<style>
  .puck-set { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr)); gap: var(--space-3); align-items: start; }
  .compact { grid-template-columns: minmax(0, 1fr); gap: var(--space-2); }
  .compact .puck { max-width: 116px; }
  .compact .positions.ring { --well-size: 32px; }
  .compact .caption { gap: 2px; margin-top: 4px; }
  .compact .caption span { font-size: .65rem; }
  .readiness-mark { width: 46px; height: 12px; font-size: .55rem; white-space: nowrap; }
  .compact .puck { width: 116px; min-height: 150px; }
  .puck { min-width: 0; width: 100%; max-width: 226px; justify-self: center; }
  .positions { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(48px, 100%), 1fr)); gap: 4px; padding: var(--space-2); border-radius: var(--radius); background: var(--row-hover); }
  .positions.ring { --well-size: 38px; position: relative; display: block; isolation: isolate; aspect-ratio: 1; padding: 0; background: none; }
  .ring::before {
    content: ''; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
    z-index: -1;
    background: radial-gradient(circle at 40% 30%, var(--plot-bg), var(--glass-strong) 68%, var(--bg));
    border: 1px solid var(--hairline); box-shadow: inset 0 0 0 4px var(--glass);
  }
  .bsu::before { clip-path: polygon(0 0, 100% 0, 100% 100%, 57% 100%, 57% 89%, 43% 89%, 43% 100%, 0 100%); }
  .bsu::after {
    content: ''; position: absolute; inset: 89% 43% 0; pointer-events: none;
    border: 1px solid var(--hairline); border-bottom: 0;
  }
  .stem-bore {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: 20%; aspect-ratio: 1; border-radius: 50%; background: var(--bg);
    border: 1px solid var(--hairline); box-shadow: inset 0 4px 6px var(--glass-edge), 0 1px 0 var(--glass-border);
  }
  .capsule {
    display: grid; justify-items: center; min-width: 0; padding: 0 2px; gap: 2px; background: transparent;
    border: 0; box-shadow: none; color: var(--text-muted); font-size: .72rem; line-height: 1;
  }
  .ring .capsule { position: absolute; top: var(--y); left: var(--x); transform: translate(-50%, calc(var(--well-size) / -2)); }
  .well {
    display: grid; place-items: center; width: var(--well-size, 38px); aspect-ratio: 1; border-radius: 50%;
    background: var(--glass-edge); border: 1px solid var(--hairline);
    box-shadow: inset 0 3px 5px var(--glass-edge), 0 1px 0 var(--glass-border);
  }
  .filled .well { background: var(--plot-bg); border-color: var(--accent); box-shadow: inset 0 0 0 2px var(--accent-soft), 0 2px 4px var(--glass-edge); }
  .capsule:hover .well, .capsule[aria-pressed=true] .well { background: var(--accent-soft); border-color: var(--accent); }
  .capsule[aria-pressed=true] .well { outline: 2px solid var(--accent); outline-offset: 2px; }
  .capsule[aria-pressed=true] strong { color: var(--accent); }
  .empty-mark { font-size: 1rem; font-weight: 400; }
  .fraction-mark { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .caption { display: flex; justify-content: center; align-items: baseline; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-2); }
  h4 { margin: 0; font-size: .9rem; }
</style>
