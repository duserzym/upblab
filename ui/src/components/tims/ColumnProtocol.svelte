<script lang="ts">
  import { isDesktop, openExternal } from '../../lib/platform';
  import { resolveColumnProtocol, type ColumnProtocolReference } from '../../lib/tims-protocol';
  import type { ColumnProtocolOut } from '../../lib/tims-api';

  let { reference, value = '', inherited = '', saved = false, context = '', loadError = '', labProtocol = null, layer = 'batch', onchange }: {
    reference: ColumnProtocolReference | null; value?: string; inherited?: string; saved?: boolean; context?: string; loadError?: string;
    labProtocol?: ColumnProtocolOut | null; layer?: 'batch' | 'capsule'; onchange?: (value: string) => void;
  } = $props();
  let editing = $state(false), printable = $state<HTMLElement>();
  const resolved = $derived(resolveColumnProtocol(layer === 'capsule' ? value : '', layer === 'batch' ? value : inherited, labProtocol));
  const current = $derived(resolved.text);
  const canPrint = $derived(!!current && (resolved.source === 'lab' || saved));
  const sourceLink = $derived(labProtocol?.source_url || reference?.url);
  const sourceTitle = $derived(labProtocol?.title || reference?.title);
  const lines = $derived(current.split('\n'));
  function print() {
    if (!canPrint || !printable) return;
    const target = printable;
    target.dataset.print = '';
    window.addEventListener('afterprint', () => { delete target.dataset.print; }, { once: true });
    window.print();
  }
</script>

{#if current || reference || onchange}
<details class="protocol">
  <summary>Column protocol{resolved.source === 'lab' ? ` · lab protocol rev ${labProtocol?.revision}` : resolved.source ? ' · edited' : ''}</summary>
  {#if resolved.source === 'lab'}<p class="small screen-only provenance">From {#if sourceLink}<a href={sourceLink} target="_blank" rel="noreferrer" onclick={event => {
    if (isDesktop) { event.preventDefault(); void openExternal(sourceLink); }
  }}>{sourceTitle}</a>{:else}{sourceTitle}{/if}</p>{/if}
  {#if loadError}<p class="small error screen-only" role="status">Lab protocol unavailable: {loadError}</p>{/if}
  <div class="row screen-only actions">
    {#if canPrint}<button class="btn small" type="button" onclick={print}>Print column protocol</button>{/if}
    {#if onchange}
      <button class="btn small" type="button" aria-expanded={editing} onclick={() => {
        if (!editing && !value) onchange?.(current);
        editing = !editing;
      }}>{editing ? 'Preview protocol' : value || inherited ? 'Edit protocol copy' : 'Add protocol copy'}</button>
      {#if value}<button class="btn small" type="button" onclick={() => { onchange?.(''); editing = false; }}>Use inherited protocol</button>{/if}
    {/if}
  </div>
  {#if editing && onchange}
    <label class="screen-only">Protocol text
      <textarea rows="10" value={value} oninput={e => onchange?.(e.currentTarget.value)}></textarea>
    </label>
  {/if}
  {#if !current && reference}
    <p class="screen-only"><a href={reference.url} target="_blank" rel="noreferrer" onclick={event => {
      if (isDesktop) { event.preventDefault(); void openExternal(reference.url); }
    }}>{reference.title}</a></p>
  {/if}
  {#if current}
  <article class="column-protocol" class:editing bind:this={printable}>
    {#if context}<p class="print-context">{context}</p>{/if}
    <h4>{lines[0]}</h4>
    {#each lines.slice(1) as line}
      {#if !line.trim()}<div class="space" aria-hidden="true"></div>
      {:else if line.endsWith(':') || line.startsWith('U Column chemistry (')}<h5>{line}</h5>
      {:else if line.includes('\t')}<p class="protocol-line">{#each line.trim().split(/\t+/) as item}<span>{item}</span>{/each}</p>
      {:else}<p>{line}</p>{/if}
    {/each}
    <p class="small attribution">{resolved.attribution}</p>
  </article>
  {/if}
</details>
{/if}

<style>
  .protocol { border: 1px solid var(--hairline); border-radius: var(--radius-sm); padding: var(--space-2); min-width: 0; }
  summary { cursor: pointer; font-weight: 600; }
  .actions { flex-wrap: wrap; margin-block: var(--space-2); }
  label { display: grid; gap: 4px; }
  textarea { width: 100%; min-width: 0; }
  article { margin-top: var(--space-2); min-width: 0; line-height: 1.45; }
  h4, h5, p { margin: 0; }
  h5 { font-size: inherit; }
  .space { height: .6em; }
  .protocol-line { display: flex; flex-wrap: wrap; column-gap: .75em; }
  .protocol-line span:first-child { font-weight: 550; }
  .provenance { margin-top: var(--space-2); overflow-wrap: anywhere; }
  article { overflow-wrap: anywhere; }
  .attribution { margin-top: var(--space-2); }
  .editing, .print-context { display: none; }
  @media print {
    :global(body:has(.column-protocol[data-print]) *:not(:has(.column-protocol[data-print])):not(.column-protocol[data-print], .column-protocol[data-print] *)) { display: none !important; }
    :global(html:has(.column-protocol[data-print])), :global(body:has(.column-protocol[data-print])),
    :global(body:has(.column-protocol[data-print]) *:has(.column-protocol[data-print])) {
      display: block !important; position: static !important; height: auto !important;
      max-height: none !important; overflow: visible !important; padding: 0 !important;
      border: 0 !important; background: white !important; box-shadow: none !important;
    }
    :global(.column-protocol[data-print]) { display: block; color: black; font-size: 10.5pt; }
    .print-context { display: block; margin-bottom: .5em; }
    h4, h5 { break-after: avoid; }
    p { break-inside: avoid; }
  }
</style>
