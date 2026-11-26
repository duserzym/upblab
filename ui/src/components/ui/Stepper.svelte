<!-- Usage: <Stepper {steps} label="Setup steps" onselect={chooseStep} trailing={actions} />. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { WorkflowStep } from '../../lib/ui-controls';
  import Icon from './Icon.svelte';
  let { steps, onselect, label, trailing }: { steps: WorkflowStep[]; onselect: (index: number) => void; label: string; trailing?: Snippet } = $props();
  const uid = $props.id();
</script>
<nav aria-label={label}>
  <ol>
    {#each steps as step, index}
      <li class:done={step.state === 'done'} class:current={step.state === 'current'}>
        <button type="button" aria-label={`${step.fullName}, ${step.detail}`} title={step.hint ? `${step.fullName}. ${step.hint}` : step.fullName}
          aria-current={step.state === 'current' ? 'step' : undefined} aria-describedby={step.hint ? `${uid}-${index}` : undefined}
          onclick={() => onselect(index)}>
          <span class="circle" aria-hidden="true">{#if step.state === 'done'}<Icon kind="check" />{:else}{index + 1}{/if}</span>
          <span class="label">{step.label}</span><span class="detail">{step.detail}</span>
        </button>
        {#if step.hint}<span class="description" id={`${uid}-${index}`}>{step.hint}</span>{/if}
      </li>
    {/each}
  </ol>
  {#if trailing}<div class="actions">{@render trailing()}</div>{/if}
</nav>
<style>
  nav { display: flex; align-items: center; gap: 8px; height: 54px; flex: none; min-width: 0; }
  ol { display: flex; flex: 1; min-width: 0; padding: 0; margin: 0; list-style: none; isolation: isolate; }
  li { flex: 1; min-width: 0; position: relative; }
  li + li::before { content: ''; position: absolute; height: 1px; top: 11px; left: -50%; width: 100%; background: var(--hairline); pointer-events: none; }
  button { position: relative; z-index: 1; display: grid; justify-items: center; gap: 0; width: 100%; padding: 0 3px; border: 0; border-radius: var(--radius-sm); background: transparent; cursor: pointer; }
  .circle { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: 1px solid var(--text-muted); border-radius: 50%; background: var(--bg); font-size: 12px; line-height: 20px; }
  .current .circle { border-color: var(--accent); background: var(--accent); color: var(--accent-contrast); }
  .done .circle { color: var(--accent); border-color: var(--accent); background: var(--bg); }
  .label { font-size: 12px; line-height: 16px; }
  .current .label { font-weight: 650; color: var(--accent); }
  .detail { font-size: 11px; line-height: 13px; color: var(--text-muted); }
  .label, .detail { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button:active { background-image: linear-gradient(var(--press), var(--press)); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .actions { display: flex; flex: none; align-items: center; gap: 4px; }
  .description { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
