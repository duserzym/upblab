<script lang="ts">
  import BatchList from '../components/tims/BatchList.svelte';
  import { batchMonths } from '../lib/tims-batch-pages';
  import { untrack, onMount, onDestroy } from 'svelte';
  import { identity } from '../lib/identity.svelte';
  import { shell } from '../lib/shell.svelte';
  import { oversight, READ_ONLY_REASON } from '../lib/oversight.svelte';
  import { timsRights } from '../lib/tims-rights.svelte';
  import { firstPage, tims, read, statusWords, type BatchOut, type CapsuleOut, type RecipeOut, type ListPage } from '../lib/tims-api';
  import { onlineOnlyReason } from '../lib/outbox.svelte';
  import { clearTimsNames, OnlineAction, ReplyScope } from '../lib/tims-requests';
  import { emptyBatchFilters, preferenceKey, fractionStatuses, minerals, type BatchFilters, type MethodCode } from '../lib/tims-model';
  import BatchEditor from '../components/tims/BatchEditor.svelte';
  import Recipes from '../components/tims/Recipes.svelte';
  import CapsuleSets from '../components/tims/CapsuleSets.svelte';
  import Spikes from '../components/tims/Spikes.svelte';
  import PickNotes from '../components/tims/PickNotes.svelte';
  let { active }: { active: boolean } = $props();
  const sections = ['Batches', 'Recipes', 'Capsule sets', 'Spikes', 'Import pick notes'] as const;
  let section = $state<typeof sections[number]>('Batches'), lab = $state(''), labs = $state.raw<Lab[]>([]), labPage = $state.raw<ListPage<Lab> | null>(null), labBusy = $state(false);
  interface Lab { id: string; name?: string; handle?: string; my_role: 'owner' | 'member' | null }
  let refresh = $state(0);
  let sets = $state.raw<CapsuleOut[]>([]), setPage = $state.raw<ListPage<CapsuleOut> | null>(null), recipes = $state.raw<RecipeOut[]>([]), recipePage = $state.raw<ListPage<RecipeOut> | null>(null), methods = $state.raw<MethodCode[]>([]);
  let filters = $state<BatchFilters>(emptyBatchFilters()), labError = $state(''), methodError = $state(''), catalogError = $state(''), error = $state(''), creating = $state(false), loadedSource = $state(''), prefLoaded = $state(false);
  let capsuleSetId = $state(''), started = $state(new Date().toISOString().slice(0, 10)), useAccount = $state(true), operator = $state(''), recipe = $state(''), mineral = $state('zircon'), notes = $state('');
  let formGeneration = 0, labsGeneration = 0, methodsGeneration = 0, setsGeneration = 0, recipesGeneration = 0;
  let formBusy = $state(false);
  const creation = new OnlineAction<BatchOut>();
  const replies = new ReplyScope();
  const listReplies = new ReplyScope(() => lab);
  const formReplies = new ReplyScope(() => [lab, creating, formGeneration, section, shell.timsRequest]);
  onDestroy(() => { replies.invalidate(); listReplies.invalidate(); formReplies.invalidate(); });
  const source = $derived(JSON.stringify([identity.target?.server, identity.account?.id, identity.revision, oversight.viewAs?.username]));
  const eligibleLabs = $derived(labs.filter(l => !!l.my_role || identity.account?.is_superuser || oversight.viewAs));
  const ready = $derived(!!shell.serverUrl && identity.signedIn && !!lab);
  const editable = $derived(timsRights.canEdit(lab));
  $effect(() => { void source; untrack(() => { clearTimsNames(); batchMonths.clear(); sets = []; recipes = []; methods = []; labs = []; lab = ''; loadedSource = ''; labPage = null; error = ''; labError = ''; methodError = ''; catalogError = ''; prefLoaded = false; creating = false; if (!active) shell.timsBatch = null; }); });
  $effect(() => { if (active && identity.signedIn && shell.serverUrl && loadedSource !== source) { const owner = source; untrack(() => { loadedSource = owner; void loadLabs(); void loadMethods(); }); } });
  $effect(() => { void shell.timsRequest; if (shell.timsBatch) untrack(() => section = 'Batches'); });
  $effect(() => { void lab; void source; untrack(() => { listReplies.invalidate(); formReplies.invalidate(); if (lab) { creating = false; capsuleSetId = ''; recipe = ''; operator = ''; notes = ''; setPage = null; recipePage = null; void catalogs(); void loadBatches(); } }); });
  $effect(() => { if (!prefLoaded || !identity.account?.id || !identity.target) return; const body = JSON.stringify({ lab, filters }); const key = preferenceKey(identity.target.server, identity.account.id); untrack(() => { try { localStorage.setItem(key, body); } catch { /* Settings may be unavailable in a private window. */ } }); });
  onMount(() => { const saved = (event: Event) => { const key = (event as CustomEvent<{ objectKey: string }>).detail?.objectKey; if (ready && section === 'Batches' && !shell.timsBatch && key?.startsWith('batch:')) void loadBatches(); }; window.addEventListener('tims-saved', saved); return () => { window.removeEventListener('tims-saved', saved); }; });
  async function loadLabs(more = false) {
    const gen = ++labsGeneration, current = replies.capture(); labBusy = true; labError = '';
    try { const next = more ? await labPage?.more() : await firstPage<Lab>('/v1/labs'); if (gen !== labsGeneration || !current() || !next) return; labs = more ? [...labs, ...next.items] : next.items; labPage = next; timsRights.rememberLabs(next.items);
      if (!more) { let saved: { lab?: string; filters?: Partial<BatchFilters> } = {}; try { saved = JSON.parse(localStorage.getItem(preferenceKey(identity.target!.server, identity.account!.id ?? identity.account!.username)) ?? '{}'); } catch { /* Start with clean preferences. */ }
        filters = { ...emptyBatchFilters(), ...Object.fromEntries(Object.entries(saved.filters ?? {}).filter(([k, v]) => k in emptyBatchFilters() && typeof v === 'string')) };
        lab = eligibleLabs.find(l => l.id === saved.lab)?.id ?? eligibleLabs[0]?.id ?? ''; prefLoaded = true;
      } else if (!lab) lab = eligibleLabs[0]?.id ?? '';
    } catch (e) { if (gen === labsGeneration && current()) labError = String(e); } finally { if (gen === labsGeneration && current()) labBusy = false; }
  }
  async function loadMethods() { const gen = ++methodsGeneration, current = replies.capture(); methodError = ''; try { const result = await read<MethodCode[]>('/v1/method-codes?q=SP-TIMS'); if (gen === methodsGeneration && current()) methods = result.filter(m => m.level === 'code' && ['active', 'proposed'].includes(m.status)); } catch (e) { if (gen === methodsGeneration && current()) methodError = String(e); } }
  async function catalogs(kind?: 'sets' | 'recipes') {
    const current = listReplies.capture(), owner = lab; catalogError = '';
    const load = async (which: 'sets' | 'recipes') => {
      const gen = which === 'sets' ? ++setsGeneration : ++recipesGeneration;
      const latest = () => current() && gen === (which === 'sets' ? setsGeneration : recipesGeneration);
      try {
        if (which === 'sets') { const p = kind ? await setPage?.more() : await tims.capsuleSets({ lab: owner }); if (latest() && p) { sets = kind ? [...sets, ...p.items] : p.items; setPage = p; } }
        else { const p = kind ? await recipePage?.more() : await tims.recipes({ lab: owner }); if (latest() && p) { recipes = kind ? [...recipes, ...p.items] : p.items; recipePage = p; } }
      } catch (e) { if (latest()) catalogError = String(e); }
    };
    await Promise.allSettled((kind ? [kind] : ['sets', 'recipes'] as const).map(load));
  }
  function loadBatches() { batchMonths.clear(); refresh++; }
  async function createBatch() {
    const settled = formReplies.capture(), current = formReplies.capture(() => [shell.view, capsuleSetId, started, useAccount, operator, recipe, mineral, notes]); formBusy = true; error = '';
    try {
      const row = await creation.send('/v1/tims/batches', 'POST', { capsule_set_id: capsuleSetId, started_on: started, operator_id: useAccount ? identity.account?.id : null, operator_name: useAccount ? identity.account?.display_name || identity.account?.username || '' : operator, recipe_id: recipe || null, notes });
      if (!current()) return;
      formBusy = false; creating = false; await shell.openTimsBatch(row.id);
    } catch (e) { if (current()) error = String(e); } finally { if (settled()) formBusy = false; }
  }
</script>
<div class="view tims" class:hidden={!active} data-testid="tims-view">
  <nav class="glass stack" aria-label="TIMS sections"><h1>TIMS</h1><ul role="list">{#each sections as item}<li><button class="section-link" aria-current={section === item ? 'page' : undefined} onclick={() => { section = item; formGeneration++; formBusy = false; if (item === 'Batches') { shell.timsBatch = null; if (lab) { void loadBatches(); void catalogs(); } } }}>{item}</button></li>{/each}</ul></nav>
  <div class="workspace stack">
  {#if !shell.serverUrl}<section class="panel stack"><h2>No UPbDB server</h2><p>Choose a server in Settings to use TIMS chemistry.</p></section>
  {:else if !identity.signedIn}<section class="panel stack"><h2>Sign in to UPbDB</h2><p>TIMS chemistry belongs to a lab. Sign in to see your labs.</p></section>
  {:else}
    {#if !shell.timsBatch || section !== 'Batches' || labs.length > 1 || labPage?.nextCursor}<div class="row lab-bar">{#if labs.length > 1}<label>Lab <select aria-label="Lab" bind:value={lab} onchange={() => { shell.timsBatch = null; }}><option value="">Choose lab</option>{#each eligibleLabs as l}<option value={l.id}>{l.name || l.handle || l.id}</option>{/each}</select></label>{:else if lab}<span class="muted small">Lab: {labs.find(l => l.id === lab)?.name || labs.find(l => l.id === lab)?.handle || lab}</span>{/if}{#if labPage?.nextCursor}<button class="btn small" disabled={labBusy} onclick={() => void loadLabs(true)}>Load more labs</button>{/if}</div>{/if}
    {#if oversight.viewAs}<p class="muted" role="status">{READ_ONLY_REASON}</p>{/if}
    {#if onlineOnlyReason()}<p class="muted small">{onlineOnlyReason()}</p>{/if}
    {#each [labError, methodError, catalogError, error].filter(Boolean) as issue}<p class="error" role="status">{issue}</p>{/each}
    {#if labError}<button class="btn" onclick={() => void loadLabs()}>Retry labs</button>{/if}
    {#if methodError}<button class="btn" onclick={() => void loadMethods()}>Retry step methods</button>{/if}
    {#if catalogError}<button class="btn" onclick={() => void catalogs()}>Retry capsule sets and recipes</button>{/if}
    {#if !lab}<section class="panel stack"><h2>{labBusy ? 'Loading labs…' : !labPage ? 'Labs unavailable' : 'No lab membership'}</h2><p>{labBusy ? 'Reading your lab memberships from UPbDB.' : !labPage ? 'Could not read lab membership from the server.' : 'Ask a lab owner to add your account to a lab.'}</p></section>
    {:else if section === 'Batches'}
      {#if shell.timsBatch}{#key source + shell.timsBatch}<BatchEditor id={shell.timsBatch} initialStep={shell.timsStep} {methods} {recipes} labName={labs.length === 1 ? labs.find(l => l.id === lab)?.name || labs.find(l => l.id === lab)?.handle || lab : ''} onback={() => { shell.timsBatch = null; void loadBatches(); void catalogs(); }} onlab={owner => { if (eligibleLabs.some(l => l.id === owner)) lab = owner; }} />{/key}{:else}
      <div class="row batch-heading"><h2>Batches</h2><button class="btn small" class:primary={!creating} disabled={!editable || !!onlineOnlyReason()} title={onlineOnlyReason()} onclick={() => { formGeneration++; formBusy = false; creating = !creating; void catalogs(); }}>New batch</button></div>
      {#if setPage?.nextCursor}<button class="btn" onclick={() => void catalogs('sets')}>Load more set choices</button>{/if}
      {#if creating}<form class="panel stack" aria-label="New batch" onsubmit={e => { e.preventDefault(); void createBatch(); }}><h3>New batch</h3><label>Active capsule set <select required bind:value={capsuleSetId}><option value="">Choose capsule set</option>{#each sets.filter(s => s.active) as s}<option value={s.id}>{s.name} {s.code}</option>{/each}</select></label><label>Started date <input type="date" required bind:value={started} /></label><label><input type="checkbox" bind:checked={useAccount} /> Use my account as operator</label><label>Operator name <input bind:value={operator} disabled={useAccount} /></label><label>Mineral <select bind:value={mineral} onchange={() => recipe = ''}>{#each minerals as m}<option value={m}>{m}</option>{/each}</select></label><label>Active recipe <select bind:value={recipe}><option value="">No recipe</option>{#each recipes.filter(r => r.active && r.mineral === mineral) as r}<option value={r.id}>{r.name}</option>{/each}</select></label>{#if recipePage?.nextCursor}<button class="btn" type="button" onclick={() => void catalogs('recipes')}>Load more recipe choices</button>{/if}<label>Notes <textarea bind:value={notes}></textarea></label><button class="btn primary" disabled={!editable || formBusy || !!onlineOnlyReason()}>Create batch</button></form>{/if}
      {#key source + lab}<BatchList {lab} {filters} {sets} {recipes} {refresh} viewer={{ server: identity.target?.server ?? shell.serverUrl, account: oversight.viewAs?.username ?? identity.account?.id ?? identity.account?.username ?? '' }}>
        {#snippet filterControls()}
          <form class="filters row" aria-label="Batch filters" onsubmit={e => e.preventDefault()}>
            <label><span class="sr-only">Capsule set</span><select aria-label="Capsule set" bind:value={filters.capsule_set}><option value="">All sets</option>{#each sets as s}<option value={s.id}>{s.name} {s.code}</option>{/each}</select></label>
            <label>After <input aria-label="Started after" title="After: batch start in Rows; step date in Calendar and Lanes" type="date" bind:value={filters.started_after} /></label>
            <label>Before <input aria-label="Started before" title="Before: batch start in Rows; step date in Calendar and Lanes" type="date" bind:value={filters.started_before} /></label>
            <label><span class="sr-only">Fraction status</span><select aria-label="Fraction status" bind:value={filters.status}><option value="">All statuses</option>{#each fractionStatuses as s}<option value={s}>{statusWords(s)}</option>{/each}</select></label>
          </form>
        {/snippet}
      </BatchList>{/key}
      {/if}
    {:else if section === 'Recipes'}{#key source + lab}<Recipes {lab} {methods} />{/key}
    {:else if section === 'Capsule sets'}{#key source + lab}<CapsuleSets {lab} {active} />{/key}
    {:else if section === 'Spikes'}{#key source + lab}<Spikes {lab} />{/key}
    {:else}{#key source + lab}<PickNotes {lab} {active} {sets} {recipes} />{/key}{/if}
  {/if}
  </div>
</div>
<style>.tims{flex-direction:row;gap:10px;padding:10px;overflow:hidden}.tims.hidden{display:none}nav{flex:none;width:156px;padding:10px;overflow:auto;border-radius:var(--radius);align-self:stretch;min-height:0}nav ul{list-style:none;margin:0;padding:0;display:grid;gap:2px}.section-link{width:100%;border:0;border-left:2px solid transparent;border-radius:0;padding:7px 6px;background:transparent;text-align:left;white-space:normal;color:var(--text-muted);cursor:pointer}.section-link:hover{background:var(--row-hover)}.section-link[aria-current=page]{color:var(--accent);background:var(--accent-soft);border-left-color:var(--accent)}.section-link:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}h1{font-size:1.1rem}h1,h2,h3,p{margin:0}.workspace{flex:1;min-width:0;min-height:0;overflow:auto;overflow-x:hidden;overflow-wrap:anywhere;padding-right:4px}.row{flex-wrap:wrap}.panel{padding:10px;min-width:0}.filters{gap:8px;margin:0}.filters label{display:flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap}.filters input[type=date],.filters select{height:29px;padding:3px 6px;font-size:12px;width:126px}.filters input[type=date]{width:122px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}label{display:grid;gap:4px;min-width:0}label:has(input[type=checkbox]){display:flex}input:not([type=checkbox]),select,textarea{min-width:0;max-width:100%;width:100%}.lab-bar{flex:none}.batch-heading{justify-content:space-between}.workspace :global(.btn){border-radius:var(--radius-sm)}.workspace > .btn{align-self:flex-start}.workspace :global(.btn:not(.capsule)){width:fit-content;max-width:100%}.workspace :global(.stack > .btn){align-self:flex-start}.workspace :global(form.stack > .btn.primary){align-self:flex-end}.workspace :global(select),.workspace :global(input:not([type=checkbox]):not([type=file])){max-width:28rem}@media(max-width:1100px){nav{width:132px;padding:6px}.tims{padding:6px;gap:6px}}</style>
