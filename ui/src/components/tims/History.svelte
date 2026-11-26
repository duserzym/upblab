<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import { tims, type HistoryRow, type ListPage } from '../../lib/tims-api';
  import { identity } from '../../lib/identity.svelte';
  import { historyChanges } from '../../lib/tims-model';
  import { ReplyScope } from '../../lib/tims-requests';
  import IconButton from '../ui/IconButton.svelte';
  let { kind, id, iconOnly = false }: { kind: 'batch' | 'recipe' | 'capsule_set' | 'column-protocol'; id: string; iconOnly?: boolean } = $props();
  let open = $state(false), busy = $state(false), error = $state('');
  let rows = $state.raw<HistoryRow[]>([]), page = $state.raw<ListPage<HistoryRow> | null>(null);
  let generation = 0;
  const replies = new ReplyScope(() => [kind, id]);
  onDestroy(() => replies.invalidate());
  $effect(() => { void id; void identity.revision; untrack(() => { generation++; rows = []; page = null; open = false; }); });
  async function load(more = false) {
    const gen = ++generation, current = replies.capture(); busy = true; error = '';
    try { const next = more ? await page?.more() : await tims.history(kind, id); if (gen !== generation || !current()) return; if (next) { rows = more ? [...rows, ...next.items] : next.items; page = next; } }
    catch (e) { if (gen === generation && current()) error = String(e); } finally { if (gen === generation && current()) busy = false; }
  }
  function toggle() { open = !open; if (open) void load(); }
</script>
{#if iconOnly}<IconButton icon="history" label="History" aria-expanded={open} onclick={toggle} />
{:else}<button type="button" class="btn" aria-expanded={open} onclick={toggle}>History</button>{/if}
{#if open}<section class="panel stack small" aria-label="History">
  {#each rows as row (row.id)}<article><p>{String(row.actor ?? row.who ?? 'Unknown account')} · {String(row.at ?? row.created_at ?? '')} · {String(row.action ?? 'Changed')}</p>{#each historyChanges(row) as line}<p>{line}</p>{/each}</article>{:else}<p>{busy ? 'Loading history…' : 'No history returned.'}</p>{/each}
  {#if error}<p class="error" role="status">{error}</p>{/if}
  {#if page?.nextCursor}<button class="btn" type="button" disabled={busy} onclick={() => void load(true)}>Load more history</button>{/if}
</section>{/if}
<style>section{padding:8px;max-height:260px;overflow:auto;overflow-wrap:anywhere}p{margin:0}article{border-bottom:1px solid var(--hairline);padding:6px}</style>
