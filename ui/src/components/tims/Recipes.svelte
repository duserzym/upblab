<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { identity } from '../../lib/identity.svelte';
  import { timsRights } from '../../lib/tims-rights.svelte';
  import { tims, type Mineral, type RecipeOut, type RecipeStep, type ListPage } from '../../lib/tims-api';
  import { minerals, reorder, recipeParameters, withDefaults, validateParameters, parameterDefinitions, type MethodCode } from '../../lib/tims-model';
  import { recipeDefaults } from '../../lib/tims-defaults';
  import { outbox, onlineOnlyReason } from '../../lib/outbox.svelte';
  import { OnlineAction, ReplyScope } from '../../lib/tims-requests';
  import ColumnProtocol from './ColumnProtocol.svelte';
  import { columnProtocol } from '../../lib/tims-protocol';
  import ParameterFields from './ParameterFields.svelte';
  import History from './History.svelte';
  let { lab, methods }: { lab: string; methods: MethodCode[] } = $props();
  let mineral = $state<Mineral>('zircon'), rows = $state.raw<RecipeOut[]>([]), page = $state.raw<ListPage<RecipeOut> | null>(null), busy = $state(false), error = $state('');
  let selected = $state<RecipeOut | null>(null), creating = $state(false), name = $state(''), active = $state(true), notes = $state(''), steps = $state.raw<RecipeStep[]>([]), method = $state('');
  const creation = new OnlineAction<RecipeOut>(); let generation = 0;
  const replies = new ReplyScope(() => [lab, mineral]);
  const formReplies = new ReplyScope(() => [lab, mineral, selected?.id, creating]);
  let saving = $state(false), formGeneration = $state(0);
  onDestroy(() => { replies.invalidate(); formReplies.invalidate(); });
  const editable = $derived(timsRights.canEdit(lab, selected ? `recipe:${selected.id}` : undefined));
  const shown = $derived(rows.map(row => ({ ...row, ...Object.assign({}, ...outbox.pending(`recipe:${row.id}`).map(e => e.body)) }) as RecipeOut));
  $effect(() => { void lab; void mineral; void identity.revision; untrack(() => { selected = null; creating = false; rows = []; page = null; void load(); }); });
  onMount(() => { const saved = (event: Event) => { const key = (event as CustomEvent<{ objectKey: string }>).detail?.objectKey; if (rows.some(row => key === `recipe:${row.id}`)) void load(); }; window.addEventListener('tims-saved', saved); return () => { generation++; window.removeEventListener('tims-saved', saved); }; });
  async function load(more = false) { const gen = ++generation, current = replies.capture(); busy = true; error = ''; try { const next = more ? await page?.more() : await tims.recipes({ lab, mineral }); if (gen !== generation || !current()) return; if (next) { page = next; rows = more ? [...rows, ...next.items] : next.items; } } catch (e) { if (gen === generation && current()) error = String(e); } finally { if (gen === generation && current()) busy = false; } }
  function close() { formGeneration++; formReplies.invalidate(); saving = false; selected = null; creating = false; }
  function edit(recipe: RecipeOut | null) { formGeneration++; formReplies.invalidate(); saving = false; selected = recipe; creating = !recipe; name = recipe?.name ?? `${mineral[0].toUpperCase()}${mineral.slice(1)} ID-TIMS`; active = recipe?.active ?? true; notes = recipe?.notes ?? ''; steps = structuredClone(recipe?.steps ?? recipeDefaults(mineral)); }
  async function save() {
    error = ''; const errors = steps.flatMap(s => validateParameters(parameterDefinitions(recipeParameters(s, methods)), s.parameters, true)); if (errors.length) { error = errors.join(' '); return; }
    const settled = formReplies.capture(), current = formReplies.capture(() => [name, active, notes, steps]); saving = true;
    try { if (selected) await tims.patchRecipe(selected.id, { name, active, notes, steps }); else await creation.send('/v1/tims/recipes', 'POST', { lab_id: lab, mineral, name, active, notes, steps }); if (!current()) return; close(); void load(); }
    catch (e) { if (current()) error = String(e); } finally { if (settled()) saving = false; }
  }
</script>
<section class="stack" aria-label="Recipes"><div class="row"><h2>Recipes</h2><label>Mineral <select bind:value={mineral}>{#each minerals as m}<option value={m}>{m}</option>{/each}</select></label><button class="btn" disabled={!editable || !!onlineOnlyReason()} title={onlineOnlyReason()} onclick={() => edit(null)}>New recipe</button></div>
{#if error}<p class="error" role="status">{error}</p>{/if}
{#each shown as recipe}<article class="panel row"><button class="btn" onclick={() => edit(recipe)}>{recipe.name}</button><span>Revision {recipe.revision} · {recipe.active ? 'active' : 'inactive'}</span>{#if outbox.pending(`recipe:${recipe.id}`).length}<span role="status">Saved here, not sent yet</span>{/if}</article>{:else}<p>{busy ? 'Loading recipes…' : 'No recipes for this mineral.'}</p>{/each}
{#if page?.nextCursor}<button class="btn" disabled={busy} onclick={() => void load(true)}>Load more recipes</button>{/if}
{#if selected || creating}{#key formGeneration}
<section class="panel stack" aria-label="Recipe editor"><div class="row"><h3>{selected ? `Revision ${selected.revision}` : 'New recipe from guidebook defaults'}</h3><button type="button" class="btn" onclick={close}>Close recipe</button>{#if selected}<History kind="recipe" id={selected.id} />{/if}</div>
<p class="small">Review before saving. Annealing allows 60 or 48 h; chloride conversion allows 12–24 h.</p>
<form class="stack" onsubmit={e => { e.preventDefault(); void save(); }}><label>Recipe name <input required bind:value={name} disabled={!editable} /></label><label><input type="checkbox" bind:checked={active} disabled={!editable} /> Active</label><label>Recipe notes <textarea bind:value={notes} disabled={!editable}></textarea></label>
<button class="btn" type="button" disabled={!editable || !recipeDefaults(selected?.mineral ?? mineral).length} onclick={() => steps = recipeDefaults(selected?.mineral ?? mineral)}>Reset to guidebook defaults</button>
{#each steps as step, index}<section class="panel stack"><div class="row"><h4>{index + 1}. {methods.find(m => m.code === step.method_code)?.name ?? step.method_code}</h4><button type="button" class="btn" disabled={!editable || index === 0} onclick={() => steps = reorder(steps, index, -1)} aria-label={`Move recipe step ${index + 1} up`}>↑</button><button type="button" class="btn" disabled={!editable || index === steps.length - 1} onclick={() => steps = reorder(steps, index, 1)} aria-label={`Move recipe step ${index + 1} down`}>↓</button><button type="button" class="btn" disabled={!editable} onclick={() => steps = steps.filter((_, i) => i !== index)}>Remove step {index + 1}</button></div>
<ParameterFields definitions={recipeParameters(step, methods)} values={withDefaults(recipeParameters(step, methods), step.parameters)} onchange={v => steps = steps.map((s, i) => i === index ? { ...s, parameters: v } : s)} disabled={!editable} {lab} />
{#if step.method_code === "SP-TIMS-COL"}<ColumnProtocol reference={columnProtocol(step.parameters.scheme, selected?.mineral ?? mineral)} context={name} />{/if}
</section>{/each}
<label>Recipe step method <select bind:value={method} disabled={!editable}><option value="">Choose method</option>{#each methods as m}<option value={m.code}>{m.name}</option>{/each}</select></label><button class="btn" type="button" disabled={!editable || !method} onclick={() => steps = [...steps, { method_code: method, parameters: withDefaults(methods.find(m => m.code === method)?.parameters ?? []) }]}>Add recipe step</button>
<button class="btn primary" disabled={!editable || saving || creating && !!onlineOnlyReason()}>{creating ? 'Create recipe' : 'Save recipe here'}</button>
</form></section>{/key}{/if}
</section>
<style>h2,h3,h4,p{margin:0}.row{flex-wrap:wrap}.panel{padding:10px;min-width:0}label{display:grid;gap:4px}label:has(input[type=checkbox]){display:flex}input:not([type=checkbox]),textarea,select{min-width:0;width:100%}section{overflow-wrap:anywhere;min-width:0}</style>
