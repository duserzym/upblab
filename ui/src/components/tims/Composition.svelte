<script lang="ts">
  import { statusWords, type VersionOut } from '../../lib/tims-api';
  let { version }: { version: VersionOut } = $props();
</script>
<section class="panel stack small" aria-label="Spike composition">
  <h4>{version.solution_name} · {version.subfraction_name} · {version.version}</h4>
  <p class:warning={!version.is_current}>{statusWords(version.status)}{!version.is_current ? ' · This version is not current.' : ''}</p>
  <p>Source: {version.source_display || version.source || 'Not given'} · Locator: {version.locator || 'Not given'}</p>
  {#each ['concentrations', 'ratios'] as group}
    <h4>{group === 'concentrations' ? 'Concentrations (mol/g)' : 'Ratios'}</h4>
    {#each Object.entries(version.composition[group as 'ratios' | 'concentrations']) as [name, entry]}
      <p>{name}: {entry.value}{group === 'concentrations' ? ' mol/g' : ''} · {entry.uncertainty === undefined ? 'uncertainty not given' : `± ${entry.uncertainty} ${statusWords(entry.uncertainty_type ?? 'uncertainty type not given')}`}</p>
    {:else}<p class="muted">None recorded</p>{/each}
  {/each}
  {#if version.notes}<p>{version.notes}</p>{/if}
</section>
<style>h4,p{margin:0} section{overflow-wrap:anywhere;padding:8px} .warning{color:var(--warning)}</style>
