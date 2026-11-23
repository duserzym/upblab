<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { identity } from '../../lib/identity.svelte';
  import { labProtocol, labProtocols, useLabProtocols } from '../../lib/tims-lab-protocols.svelte';
  import { tims, type ColumnProtocolOut, type ColumnScheme } from '../../lib/tims-api';
  import { timsRights } from '../../lib/tims-rights.svelte';
  import { onlineOnlyReason } from '../../lib/outbox.svelte';
  import { oversight, READ_ONLY_REASON, WriteError } from '../../lib/oversight.svelte';
  import { ReplyScope } from '../../lib/tims-requests';
  import { columnProtocol } from '../../lib/tims-protocol';
  import ColumnProtocol from './ColumnProtocol.svelte';
  import History from './History.svelte';

  let { lab }: { lab: string } = $props();
  useLabProtocols(() => lab);
  const schemes: ColumnScheme[] = ['HCl anion', 'HBr-HCl'];
  let scheme = $state<ColumnScheme | null>(null), selected = $state.raw<ColumnProtocolOut | null>(null);
  let title = $state(''), text = $state(''), attribution = $state(''), sourceUrl = $state('');
  let saving = $state(false), error = $state(''), stale = $state(false);
  const editable = $derived(timsRights.canEditLabProtocol(lab));
  const protocolState = $derived(labProtocols.state(lab));
  const refused = $derived(selected ? timsRights.recordReason(`column-protocol:${selected.id}`) : '');
  const replies = new ReplyScope(() => [lab, scheme, selected?.id]);
  let pending: ReturnType<typeof tims.patchColumnProtocol> | undefined, signature = '';
  onDestroy(() => replies.invalidate());
  $effect(() => { void lab; void identity.revision; untrack(close); });

  function close() {
    replies.invalidate(); scheme = null; selected = null; saving = false; error = ''; stale = false;
    pending = undefined; signature = '';
  }
  function edit(next: ColumnScheme) {
    close(); scheme = next; selected = labProtocol(lab, next);
    title = selected?.title ?? `${next} column protocol`; text = selected?.text ?? '';
    attribution = selected?.attribution ?? ''; sourceUrl = selected?.source_url ?? '';
  }
  async function reload() {
    const current = replies.capture(), editingScheme = scheme;
    await labProtocols.load(lab, true);
    if (current() && !labProtocols.state(lab).error && editingScheme) edit(editingScheme);
  }
  async function save() {
    if (!scheme || !editable || saving || stale || !text.trim()) return;
    const body = { title: title.trim(), text, attribution, source_url: sourceUrl.trim() };
    const next = JSON.stringify([lab, scheme, selected?.id, selected?.revision, body]);
    if (next !== signature) {
      signature = next;
      pending = selected ? tims.patchColumnProtocol(selected.id, { ...body, revision: selected.revision })
        : tims.createColumnProtocol({ ...body, lab_id: lab, scheme });
    }
    const current = replies.capture(() => [title, text, attribution, sourceUrl]);
    saving = true; error = '';
    try {
      const row = await pending!.send();
      if (!current()) return;
      await labProtocols.saved(row);
      if (current()) close();
    } catch (e) {
      if (!current()) return;
      error = String(e); stale = e instanceof WriteError && e.status === 409 && e.code === 'stale_revision';
    } finally { if (current()) saving = false; }
  }
</script>

<section class="stack" aria-label="Lab column protocols">
  <div class="row"><h3>Lab column protocols</h3><button class="btn" type="button" disabled={protocolState.busy || saving} onclick={() => void reload()}>Reload lab protocols</button></div>
  {#if !editable}<p class="small">{oversight.viewAs ? READ_ONLY_REASON : "Only lab owners can edit the lab's column protocol."}</p>{/if}
  {#if protocolState.error}<p class="error" role="status">{protocolState.error}</p>{/if}
  {#each schemes as item}
    {@const protocol = labProtocol(lab, item)}
    <article class="panel stack" aria-label={`${item} lab protocol`}>
      <div class="row"><h4>{item}</h4>
        {#if protocol}<span>{protocol.title} · Revision {protocol.revision} · Last updated {protocol.updated_at}</span><History kind="column-protocol" id={protocol.id} />
        {:else}<span>{protocolState.busy ? 'Loading lab protocol…' : 'No lab protocol saved.'}</span>{/if}
        {#if editable}<button class="btn" type="button" disabled={!protocolState.loaded || protocolState.busy || saving || !!onlineOnlyReason()} title={onlineOnlyReason()} onclick={() => edit(item)}>{protocol ? 'Edit' : 'Create'} {item} lab protocol</button>{/if}
      </div>
      <ColumnProtocol reference={columnProtocol(item)} labProtocol={protocol} />
    </article>
  {/each}
  {#if protocolState.page?.nextCursor}<button class="btn" type="button" disabled={protocolState.busy} onclick={() => void labProtocols.load(lab, false, true)}>Load more lab protocols</button>{/if}
  {#if scheme}
    <form class="panel stack" aria-label="Lab protocol editor" onsubmit={event => { event.preventDefault(); void save(); }}>
      <div class="row"><h4>{scheme} · {selected ? `Revision ${selected.revision}` : 'New lab protocol'}</h4><button class="btn" type="button" onclick={close}>Close lab protocol</button></div>
      <label>Protocol title <input required bind:value={title} disabled={!editable || saving || stale} /></label>
      <label>Lab protocol text <textarea rows="14" required bind:value={text} disabled={!editable || saving || stale}></textarea></label>
      <label>Protocol attribution <input bind:value={attribution} disabled={!editable || saving || stale} /></label>
      <label>Protocol source URL <input type="url" bind:value={sourceUrl} disabled={!editable || saving || stale} /></label>
      {#if error}<p class="error" role="status">{error}</p>{/if}
      {#if refused}<p class="error" role="status">{refused}</p>{/if}
      {#if onlineOnlyReason()}<p class="small" role="status">{onlineOnlyReason()}</p>{/if}
      <button class="btn primary" disabled={!editable || saving || stale || !!refused || !!protocolState.error || !text.trim() || !!onlineOnlyReason()}>Save lab protocol</button>
    </form>
  {/if}
</section>

<style>
  section, article, form { min-width: 0; overflow-wrap: anywhere; }
  h3, h4, p { margin: 0; }
  .row { flex-wrap: wrap; }
  .panel { padding: var(--space-2); }
  label { display: grid; gap: 4px; min-width: 0; }
  input, textarea { width: 100%; min-width: 0; }
</style>
