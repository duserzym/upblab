<!-- Usage: <ProgressBar value={ready} total={count} noun="capsules" />; null value means unknown. -->
<script lang="ts">
  import { progressState } from '../../lib/ui-controls';
  let { value, total, noun }: { value?: number | null; total: number; noun: string } = $props();
  const progress = $derived(progressState(value, total, noun));
</script>
<div class="progress">
  <span class="caption">{progress.caption}</span>
  <div class="track" role="progressbar" aria-label={noun} aria-valuemin="0" aria-valuemax={progress.max} aria-valuenow={progress.now} aria-valuetext={progress.caption}>
    <span class="fill" style:width={`${progress.percent}%`}></span>
  </div>
</div>
<style>
  .progress { min-width: 0; }
  .caption { font-size: 11px; color: var(--text-muted); }
  .track { height: 5px; border-radius: var(--radius-sm); overflow: hidden; background: var(--hairline); }
  .fill { display: block; height: 100%; background: var(--accent); }
</style>
