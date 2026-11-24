<script lang="ts">
  import { type VersionOut } from '../../lib/tims-api';
  import { formatSpikeValue, isotopeLabel, subfractionLabel, uncertaintyLabel, versionStatusLabel } from '../../lib/spike-format';
  import { spikeDois } from '../../lib/spike-reference';
  import { isDesktop, openExternal } from '../../lib/platform';
  let { version }: { version: VersionOut } = $props();
  let fullPrecision = $state(false);
  const doi = $derived(spikeDois.get(version.source));
</script>
<section class="panel stack composition" aria-label="Spike composition">
  <header class="stack">
    <div class="row">
      <h4>{version.solution_name} · {subfractionLabel(version.subfraction, version.subfraction_name)} · {version.version}</h4>
      <span class="badge" class:current={version.status === 'current'} class:warning={version.status === 'withdrawn'} class:muted={version.status === 'superseded'}>{versionStatusLabel(version.status)}</span>
    </div>
    {#if !version.is_current}<p class="warning small">This version is not current.</p>{/if}
  </header>
  <label class="small precision"><input type="checkbox" bind:checked={fullPrecision} /> Full precision</label>
  {#each ['concentrations', 'ratios'] as group}
    <table class="data composition-table">
      <caption>{group === 'concentrations' ? 'Concentrations (mol/g)' : 'Ratios'}</caption>
      <colgroup><col class="isotope-column" /><col /><col /><col class="type-column" /></colgroup>
      <thead><tr><th scope="col">{group === 'concentrations' ? 'Isotope' : 'Ratio'}</th><th scope="col" class="num">Value</th><th scope="col" class="num" aria-label="Uncertainty">±</th><th scope="col">Type</th></tr></thead>
      <tbody>
        {#each Object.entries(version.composition[group as 'ratios' | 'concentrations']) as [name, entry]}
          {@const formatted = formatSpikeValue(entry, fullPrecision)}
          <tr>
            <th scope="row" aria-label={name}>{isotopeLabel(name)}</th>
            <td class="num" title={String(entry.value)}>{formatted.value}</td>
            <td class="num" title={entry.uncertainty === undefined ? 'Uncertainty not given' : String(entry.uncertainty)}>
              {#if formatted.uncertainty !== undefined}± {formatted.uncertainty}{:else}<span class="muted"><span class="sr-only">uncertainty{' '}</span>not given</span>{/if}
            </td>
            <td class="small muted">{entry.uncertainty === undefined ? '—' : entry.uncertainty_type ? uncertaintyLabel(entry.uncertainty_type) : 'Type not given'}</td>
          </tr>
        {:else}<tr><td colspan="4" class="muted">None recorded</td></tr>{/each}
      </tbody>
    </table>
  {/each}
  <section class="stack small reference" aria-label="Reference">
    <h4>Reference</h4>
    <p>{version.source_display || version.source || 'Source not given'}</p>
    {#if version.locator}<p class="muted">{version.locator}</p>{/if}
    <div class="row">
      {#if version.calibrated}<span class="muted">Calibrated {version.calibrated}</span>{/if}
      {#if doi}<a href={doi} target="_blank" rel="noreferrer" onclick={event => { if (isDesktop) { event.preventDefault(); void openExternal(doi); } }}>DOI</a>{/if}
    </div>
  </section>
  {#if version.notes}<p class="small muted">{version.notes}</p>{/if}
</section>
<style>
  h4,p{margin:0}h4{font-size:0.95rem;font-weight:600}
  .composition{position:relative;min-width:0;padding:var(--space-4);gap:var(--space-4);overflow-wrap:anywhere;container-type:inline-size}
  header.stack,.reference{gap:var(--space-2)}
  .precision{display:flex;align-items:center;gap:var(--space-2);align-self:flex-start}
  .badge.current{color:var(--accent);background:var(--accent-soft)}.warning{color:var(--warning)}
  .composition-table{table-layout:fixed}
  caption{text-align:left;font-weight:600;padding-bottom:var(--space-2)}
  .composition-table th,.composition-table td{padding:var(--space-2);overflow-wrap:anywhere}
  .composition-table th{position:static;background:none;text-transform:none;letter-spacing:normal}
  .composition-table tbody th{font-size:0.85rem;font-weight:500;color:var(--text)}
  .composition .composition-table .num{text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
  .composition-table tbody tr{cursor:default}.composition-table tbody tr:hover{background:none}
  .composition-table{max-width:40rem}.isotope-column{width:30%}.type-column{width:14%}
  .reference{text-align:left;border-top:1px solid var(--hairline);padding-top:var(--space-3)}
  .reference .row:empty{display:none}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
  @container (max-width:400px){.composition-table{font-size:0.78rem}.composition-table th,.composition-table td{padding:var(--space-2) 3px}.composition-table tbody th{font-size:0.78rem}.type-column{width:17%}.isotope-column{width:25%}}
</style>
