<!-- Usage: <SegmentedControl {options} bind:value label="Views" />; view switches only. -->
<script lang="ts">
  import { segmentedIndex, type SegmentedOption } from '../../lib/ui-controls';
  let { options, value = $bindable(), label, onchange, size = 'normal' }: {
    options: SegmentedOption[]; value: string; label: string; onchange?: (value: string) => void; size?: 'small' | 'normal';
  } = $props();
  let buttons: HTMLButtonElement[] = [];
  const active = $derived(Math.max(0, options.findIndex(option => option.value === value)));
  function select(index: number) { value = options[index].value; onchange?.(value); }
  function keyboard(event: KeyboardEvent, index: number) {
    const next = segmentedIndex(event.key, index, options.length);
    if (next === null || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault(); select(next); buttons[next]?.focus();
  }
</script>
<div class="segments" class:small={size === 'small'} role="radiogroup" aria-label={label}>
  {#each options as option, index (option.value)}
    <button type="button" role="radio" aria-checked={value === option.value} aria-label={option.ariaLabel ?? option.label}
      title={option.title ?? option.ariaLabel ?? option.label} tabindex={index === active ? 0 : -1}
      bind:this={buttons[index]} onclick={() => select(index)} onkeydown={event => keyboard(event, index)}>{option.label}</button>
  {/each}
</div>
<style>
  .segments { display: inline-flex; flex: none; border: 1px solid var(--hairline); border-radius: var(--radius-sm); background: var(--glass-strong); }
  button { border: 0; border-radius: 0; padding: 5px 12px; background: transparent; cursor: pointer; white-space: nowrap; }
  button + button { border-left: 1px solid var(--hairline); }
  button:first-child { border-radius: calc(var(--radius-sm) - 1px) 0 0 calc(var(--radius-sm) - 1px); }
  button:last-child { border-radius: 0 calc(var(--radius-sm) - 1px) calc(var(--radius-sm) - 1px) 0; }
  button[aria-checked=true] { background: var(--accent-soft); color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  button:hover { background-color: var(--row-hover); }
  button:active { background-image: linear-gradient(var(--press), var(--press)); }
  button:focus-visible { position: relative; z-index: 1; outline: 2px solid var(--accent); outline-offset: 2px; }
  .small button { height: 28px; padding: 2px 8px; font-size: 12px; }
</style>
