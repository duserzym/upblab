<script lang="ts">
  import { statusWords, type BatchDetail, type FractionStepRecord } from '../../lib/tims-api';
  import { capsulePucks, isLooseGrain, sourceNames, sourceSpotNames, type MountGeometry } from '../../lib/tims-geometry';
  import { capsulePreparations, readCapsulePreparation } from '../../lib/tims-capsule-intake';
  import { batchReadiness } from '../../lib/tims-readiness';
  import { puckBoardLayout, puckLabel, type Box } from '../../lib/tims-puck-layout';
  import GrainImage from './GrainImage.svelte';

  let { batch, geometry, geometryError, selected, selection = [], onselect, ongesture, compact = false }: {
    batch: BatchDetail; geometry: Record<string, MountGeometry>; geometryError: string;
    selection?: number[]; ongesture?: (position: number, gesture: 'one' | 'toggle' | 'range') => void; compact?: boolean; selected: number | null; onselect: (position: number) => void;
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

  // These bindings use ResizeObserver. The flex area depends only on the window,
  // never on selection, guidance content or geometry loading state. Keep 1 px
  // clear because clientWidth/clientHeight round fractional CSS measurements.
  let width = $state(284), height = $state(280), viewportWidth = $state(1280);
  const layout = $derived(puckBoardLayout({ pucks: pucks.length, perPuck: batch.capsule_set.positions_per_puck,
    width: Math.max(0, width - 1), height: Math.max(0, height - 1), columns: viewportWidth < 1280 ? 1 : 2 }));
  // Measure the rendered font, including fallback glyphs, rather than guessing
  // by character count. Both copies reserve their space, so text and image
  // arrival cannot move wells or label boxes.
  function looseLabelFit(node: HTMLButtonElement, _content: string) {
    let frame = 0, destroyed = false;
    const measure = () => {
      const mark = node.querySelector<HTMLElement>('.loose-grain-mark');
      const well = node.querySelector<HTMLElement>('.well');
      node.dataset.looseOverflow = String(!!mark && !!well && mark.getBoundingClientRect().width > well.clientWidth - 4);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    schedule();
    void document.fonts.ready.then(() => { if (!destroyed) schedule(); });
    return { update: schedule, destroy() { destroyed = true; observer.disconnect(); cancelAnimationFrame(frame); } };
  }
  function boxStyle(box: Box) {
    return `left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px`;
  }
</script>

<svelte:window bind:innerWidth={viewportWidth} />
<div class="puck-set" class:compact bind:clientWidth={width} bind:clientHeight={height}>
  <div class="puck-canvas" style={`width:${layout.width}px;height:${layout.height}px;--well-size:${layout.puck.wellSize}px;--label-font:${puckLabel.nameFont}px;--mark-font:${puckLabel.markFont}px;--loose-font:${puckLabel.looseFont}px`}>
  {#each pucks as puck, index (puck[0])}
    <section class="puck" aria-label={`Puck ${index + 1}`} style={boxStyle({ ...layout.offsets[index], width: layout.puck.width, height: layout.puck.height })}>
      <div class="positions" style={boxStyle(layout.puck.disc)} class:ring={batch.capsule_set.positions_per_puck <= 6} class:bsu={batch.capsule_set.positions_per_puck === 5}>
        {#if batch.capsule_set.positions_per_puck === 5}<span class="stem-bore" aria-hidden="true"></span>{/if}
      </div>
        {#each puck as position, slot (position)}
          {@const slotLayout = layout.puck.slots[slot]}
          {@const id = batch.capsule_map[String(position)]}
          {@const fraction = id ? fractions.get(id) : undefined}
          {@const source = fraction?.sources.find(s => !s.retired_at && s.mount_id)}
          {@const looseSource = fraction?.sources.find(s => !s.retired_at && isLooseGrain(s))}
          {@const looseLabel = looseSource ? sourceNames(looseSource).grain : ''}
          {@const looseDetail = looseSource ? `Loose grain ${looseLabel}` : ''}
          {@const label = batch.capsule_set.capsule_labels[position - 1] ?? batch.capsule_set.code + position}
          {@const state = fraction ? statusWords(fraction.status) : 'empty'}
          {@const spotNames = fraction ? sourceSpotNames(fraction.sources, geometry).join(', ') : ''}
          {@const preparation = fraction ? readCapsulePreparation(fraction.notes).preparation : null}
          {@const detail = fraction ? [preparation && capsulePreparations[preparation], looseDetail, fraction.sample.name, spotNames, state, ...(outcomes.get(fraction.id) ?? []).map(r => r.outcome === 'fully_dissolved' && methods.get(r.step_id) === 'SP-TIMS-CA' ? 'dissolved during CA' : statusWords(r.outcome)), ...(fraction.sources.some(s => !s.retired_at && s.is_fragment) ? ['fragment'] : [])].filter(Boolean).join(' · ') : 'Prepare this capsule'}
          <button class="capsule" class:filled={!!fraction} type="button" data-testid="tims-capsule"
            use:looseLabelFit={`${layout.puck.wellSize}:${looseLabel}`}
            aria-label={`${label} ${fraction?.name ?? 'empty'}${looseDetail ? ' · ' + looseDetail : ''}${preparation ? ' · ' + capsulePreparations[preparation] : ''}${spotNames ? ' · ' + spotNames : ''}`} aria-pressed={selection.length ? selection.includes(position) : selected === position}
            title={detail} style={boxStyle(slotLayout.well)} onclick={e => ongesture ? ongesture(position, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'one') : onselect(position)}
            onkeydown={e => {
              if (!ongesture) return;
              if (e.key === ' ') { e.preventDefault(); ongesture(position, 'toggle'); }
              if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
                e.preventDefault();
                const next = Math.max(1, Math.min(batch.capsule_set.positions, position + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1)));
                ongesture(next, e.shiftKey ? 'range' : 'one');
                const buttons = e.currentTarget.closest('.puck-canvas')?.querySelectorAll<HTMLButtonElement>('[data-testid=tims-capsule]'); buttons?.[next - 1]?.focus();
              }
            }}>
            <span class="well">
              {#if looseSource}<span class="fraction-mark loose-grain-mark" title={looseDetail}>{looseLabel}</span>
              {:else if source}<GrainImage {source} mount={source.mount_id ? geometry[source.mount_id] : undefined} size={layout.puck.wellSize - 2} lazy {geometryError} />
              {:else if fraction}<span class="fraction-mark">{preparation === 'lab-blank' ? 'Blank' : fraction.name}</span>
              {:else}<span class="empty-mark" aria-hidden="true">+</span>{/if}
            </span>
            <span class="capsule-label" style={boxStyle({ ...slotLayout.label, x: slotLayout.label.x - slotLayout.well.x, y: slotLayout.label.y - slotLayout.well.y })}>
            <strong title={label}>{label}</strong>
            <span class="readiness-mark" title={`${label}: grain ${readinessByPosition.get(position)?.grain ? 'complete' : 'pending'} · spike ${readinessByPosition.get(position)?.spike ? 'complete' : 'pending'}`}>G {readinessByPosition.get(position)?.grain ? '✓' : '·'} S {readinessByPosition.get(position)?.spike ? '✓' : '·'}</span>
            {#if looseSource}<span class="loose-label" title={looseDetail}>{looseLabel}</span>{/if}
            </span>
          </button>
        {/each}
      <div class="caption" style={boxStyle(layout.puck.caption)}><h4>Puck {index + 1}</h4><span class="small muted">{puck.filter(n => !!batch.capsule_map[String(n)]).length} / {puck.length} assigned</span></div>
    </section>
  {/each}
  </div>
</div>

<style>
  .puck-set { flex: 1 1 0; min-height: 0; min-width: 0; position: relative; }
  .puck-canvas { position: relative; }
  .puck, .positions, .caption { position: absolute; }
  .positions { border-radius: var(--radius); background: var(--row-hover); }
  .positions.ring { isolation: isolate; background: none; }
  .capsule-label { position: absolute; display: grid; grid-template-rows: 13px 11px 13px; justify-items: center; line-height: 13px; }
  .capsule-label strong { display: block; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--label-font); line-height: 13px; }
  .readiness-mark { display: block; width: 100%; height: 11px; font-size: var(--mark-font); line-height: 11px; white-space: nowrap; }
  .ring::before {
    content: ''; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
    z-index: -1;
    background: radial-gradient(circle at 40% 30%, var(--plot-bg), var(--glass-strong) 68%, var(--bg));
    border: 1px solid var(--hairline); box-shadow: inset 0 0 0 calc(var(--well-size) / 8) var(--glass);
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
    position: absolute; display: block; min-width: 0; padding: 0; background: transparent;
    border: 0; box-shadow: none; color: var(--text-muted); font-size: .72rem; line-height: 1;
  }
  .well {
    position: relative; overflow: hidden; display: grid; place-items: center; width: var(--well-size, 38px); aspect-ratio: 1; border-radius: 50%;
    background: var(--glass-edge); border: 1px solid var(--hairline);
    box-shadow: inset 0 3px 5px var(--glass-edge), 0 1px 0 var(--glass-border);
  }
  .filled .well { background: var(--plot-bg); border-color: var(--accent); box-shadow: inset 0 0 0 2px var(--accent-soft), 0 2px 4px var(--glass-edge); }
  .capsule:hover .well, .capsule[aria-pressed=true] .well { background: var(--accent-soft); border-color: var(--accent); }
  .capsule[aria-pressed=true] .well { outline: 2px solid var(--accent); outline-offset: 2px; }
  .capsule[aria-pressed=true] strong { color: var(--accent); }
  .empty-mark { font-size: 1rem; font-weight: 400; }
  .fraction-mark { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .caption { display: flex; justify-content: center; align-items: center; gap: 4px; white-space: nowrap; }
  .loose-grain-mark { position: absolute; left: 50%; transform: translateX(-50%); max-width: none; font-size: var(--loose-font); line-height: 13px; }
  .loose-label { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--loose-font); line-height: 13px; visibility: hidden; }
  .capsule:global([data-loose-overflow=true]) .loose-grain-mark { visibility: hidden; }
  .capsule:global([data-loose-overflow=true]) .loose-label { visibility: visible; }
  .caption span { font-size: 12px; line-height: 16px; }
  h4 { margin: 0; font-size: 12px; line-height: 16px; }
</style>
