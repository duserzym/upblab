<!-- Usage: <StatusChip tone="warning" text="Needs attention" />; short status facts. -->
<script lang="ts">
  let { tone = 'neutral', text }: { tone?: 'neutral' | 'warning' | 'success'; text: string } = $props();
</script>
<span class="status" class:warning={tone === 'warning'} class:success={tone === 'success'}>{text}</span>
<style>
  .status { display: inline-block; max-width: 100%; padding: 2px 6px; border: 1px solid var(--hairline); border-radius: var(--radius-sm); font-size: 12px; color: var(--text-muted); background: var(--glass); overflow-wrap: anywhere; }
  .warning { color: var(--warning); background: color-mix(in srgb, var(--warning) 12%, transparent); border-color: color-mix(in srgb, var(--warning) 30%, transparent); }
  .success { color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); border-color: color-mix(in srgb, var(--ok) 30%, transparent); }
</style>
