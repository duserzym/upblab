<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { identity } from '../../lib/identity.svelte';
  import { timsRights } from '../../lib/tims-rights.svelte';
  import { tims, type CapsuleOut, type ListPage } from '../../lib/tims-api';
  import { outbox, onlineOnlyReason } from '../../lib/outbox.svelte';
  import { missingBsuDefaults } from '../../lib/tims-defaults';
  import { OnlineAction, ReplyScope } from '../../lib/tims-requests';
  import History from './History.svelte';
  import Confirm from './Confirm.svelte';
  let { lab, active: visible = true }: { lab: string; active?: boolean } = $props();
  let rows = $state.raw<CapsuleOut[]>([]), page = $state.raw<ListPage<CapsuleOut> | null>(null), busy = $state(false), error = $state('');
  let selected = $state<CapsuleOut | null>(null), creating = $state(false), name = $state(''), code = $state(''), positions = $state(15), active = $state(true), notes = $state(''), confirm = $state(false);
  const creation = new OnlineAction<CapsuleOut>(); const defaultActions = new Map<string, OnlineAction<CapsuleOut>>();
  let generation = 0, suggestionGeneration = 0;
  const replies = new ReplyScope(() => lab);
  const formReplies = new ReplyScope(() => [lab, selected?.id, creating]);
  let saving = $state(false);
  onDestroy(() => { replies.invalidate(); formReplies.invalidate(); });
  const shown = $derived(rows.map(row => ({ ...row, ...Object.assign({}, ...outbox.pending(`capsule_set:${row.id}`).map(e => e.body)) }) as CapsuleOut));
  const missing = $derived(missingBsuDefaults(shown));
  const editable = $derived(timsRights.canEdit(lab, selected ? `capsule_set:${selected.id}` : undefined));
  $effect(() => { void lab; void identity.revision; untrack(() => { generation++; suggestionGeneration++; selected = null; creating = false; confirm = false; rows = []; page = null; defaultActions.clear(); void load(); }); });
  onMount(() => { const saved = (event: Event) => { const key = (event as CustomEvent<{ objectKey: string }>).detail?.objectKey; if (rows.some(row => key === `capsule_set:${row.id}`)) void load(); }; window.addEventListener('tims-saved', saved); return () => { generation++; suggestionGeneration++; window.removeEventListener('tims-saved', saved); }; });
  async function load(more = false) { const gen = ++generation, current = replies.capture(); busy = true; error = ''; try { const next = more ? await page?.more() : await tims.capsuleSets({ lab }); if (gen !== generation || !current()) return; if (next) { page = next; rows = more ? [...rows, ...next.items] : next.items; } } catch (e) { if (gen === generation && current()) error = String(e); } finally { if (gen === generation && current()) busy = false; } }
  function close() { formReplies.invalidate(); suggestionGeneration++; saving = false; selected = null; creating = false; }
  function edit(row: CapsuleOut | null) { formReplies.invalidate(); suggestionGeneration++; saving = false; selected = row; creating = !row; name = row?.name ?? ''; code = row?.code ?? ''; positions = row?.positions ?? 15; active = row?.active ?? true; notes = row?.notes ?? ''; }
  async function suggest() { const gen = ++suggestionGeneration, input = name, originalCode = code, current = formReplies.capture(() => [name, code]); if (!input || !creating || onlineOnlyReason()) return; try { const reply = await tims.suggestCode(lab, input); if (gen === suggestionGeneration && current()) code = reply.suggestion; } catch (e) { if (gen === suggestionGeneration && current()) error = String(e); } }
  async function save() {
    const settled = formReplies.capture(), current = formReplies.capture(() => [name, code, positions, active, notes]); saving = true; error = '';
    try { if (selected) await tims.patchCapsuleSet(selected.id, { name, code, positions, active, notes }); else await creation.send('/v1/tims/capsule-sets', 'POST', { lab_id: lab, name, code, positions, positions_per_puck: 5, active, notes }); if (!current()) return; close(); void load(); }
    catch (e) { if (current()) error = String(e); } finally { if (settled()) saving = false; }
  }
  async function seed() {
    const current = replies.capture(); busy = true; error = '';
    try { for (const d of missing) { if (!current()) return; let action = defaultActions.get(d.code); if (!action) { action = new OnlineAction<CapsuleOut>(); defaultActions.set(d.code, action); } const created = await action.send('/v1/tims/capsule-sets', 'POST', { lab_id: lab, ...d, positions: 15, positions_per_puck: 5 }); if (!current()) return; rows = [...rows, created]; } confirm = false; await load(); }
    catch (e) { if (!current()) return; confirm = false; const reason = String(e); await load(); if (current()) error = reason; } finally { if (current()) busy = false; }
  }
</script>
<section class="stack" aria-label="Capsule sets"><div class="row"><h2>Capsule sets</h2><button class="btn" disabled={!editable || !!onlineOnlyReason()} title={onlineOnlyReason()} onclick={() => edit(null)}>New capsule set</button><button class="btn" disabled={!editable || busy || !!onlineOnlyReason() || !!page?.nextCursor || !missing.length} title={page?.nextCursor ? 'Load the remaining capsule sets before checking missing defaults.' : onlineOnlyReason()} onclick={() => confirm = true}>Add BSU-IGL defaults</button></div>
{#if error}<p class="error" role="status">{error}</p>{/if}
{#each shown as row}<article class="panel row"><button class="btn" onclick={() => edit(row)}>{row.name} {row.code}</button><span>{row.positions} positions · {row.active ? 'active' : 'inactive'}</span>{#if outbox.pending(`capsule_set:${row.id}`).length}<span role="status">Saved here, not sent yet</span>{/if}</article>{:else}<p>{busy ? 'Loading capsule sets…' : 'No capsule sets.'}</p>{/each}
{#if page?.nextCursor}<button class="btn" disabled={busy} onclick={() => void load(true)}>Load more capsule sets</button>{/if}
{#if selected || creating}<section class="panel stack" aria-label="Capsule set editor"><div class="row"><h3>{creating ? 'New capsule set' : `${selected?.name} ${selected?.code}`}</h3><button class="btn" type="button" onclick={close}>Close set</button>{#if selected}<History kind="capsule_set" id={selected.id} />{/if}</div>
<form class="stack" onsubmit={e => { e.preventDefault(); void save(); }}><label>Set name <input required bind:value={name} onblur={() => void suggest()} disabled={!editable} /></label><label>Set code <input required bind:value={code} disabled={!editable} /></label><label>Positions <input type="number" min="1" max="60" step="1" required bind:value={positions} disabled={!editable} /></label><p>5 positions per puck for new sets.</p><label><input type="checkbox" bind:checked={active} disabled={!editable} /> Active</label><label>Set notes <textarea bind:value={notes} disabled={!editable}></textarea></label><button class="btn primary" disabled={!editable || saving || creating && !!onlineOnlyReason()}>{creating ? 'Create capsule set' : 'Save capsule set here'}</button></form></section>{/if}
{#if confirm && visible}<Confirm title="Add BSU-IGL defaults" text={`Create these missing capsule sets: ${missing.map(d => `${d.name} ${d.code}`).join(', ')}. Existing sets are kept.`} {busy} confirm={() => void seed()} cancel={() => confirm = false} />{/if}
</section>
<style>h2,h3,p{margin:0}.row{flex-wrap:wrap}.panel{padding:10px;min-width:0}label{display:grid;gap:4px}label:has(input[type=checkbox]){display:flex}input:not([type=checkbox]),textarea{min-width:0;width:100%}section{overflow-wrap:anywhere}</style>
