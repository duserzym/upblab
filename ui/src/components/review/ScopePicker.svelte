<script module lang="ts">
  // Survives tab switches and component remounts, but resets with the app session.
  let prompted = false;
</script>
<script lang="ts">
  import { plural } from '../../lib/plural';
  import { tick, untrack, type Snippet } from 'svelte';
  import { review } from '../../lib/review.svelte';
  import { settings } from '../../lib/settings.svelte';
  import { completeRuns, formatRunTime, listboxMove, resolvedRun, runBadge, scopeRows, sessionStatus } from '../../lib/review-header';
  let { active, actions }: { active: boolean; actions: Snippet } = $props();
  let open = $state<'scope' | 'run' | null>(null);
  let query = $state('');
  let drawer = $state<HTMLDivElement>();
  let search = $state<HTMLInputElement>();
  let sessionField = $state<HTMLButtonElement>(), runField = $state<HTMLButtonElement>();
  let cursor = $state({ column: 0, index: 0 });
  const session = $derived(review.sessions.find(s => review.scope?.kind === 'session' && s.id === review.scope.id));
  const mount = $derived(review.mounts.find(m => review.scope?.kind === 'mount' && m.id === review.scope.id));
  const name = $derived(session?.session_key ?? mount?.label ?? 'Choose a session or mount');
  const matching = $derived(scopeRows(review.sessions, review.mounts, query));
  const columns = $derived([
    matching.sessions.map(s => ({ id: s.id, kind: 'session' as const, name: s.session_key, facts: `${s.material} · ${plural(s.acquisition_count, 'spot')} · ${sessionStatus(s)}` })),
    matching.mounts.map(m => ({ id: m.id, kind: 'mount' as const, name: m.label, facts: plural(m.spot_count, 'spot') })),
  ]);
  const runs = $derived(completeRuns(review.runs));
  const resolved = $derived(resolvedRun(runs, review.scope?.kind === 'session' ? review.scope.run : undefined));
  const preferred = $derived(resolvedRun(runs));
  const runChoices = $derived(preferred ? [{ value: 'preferred', run: preferred, alias: true }, ...runs.map(run => ({ value: run.id, run, alias: false }))] : []);
  const lengths = $derived(open === 'scope' ? columns.map(c => c.length) : [runChoices.length]);
  const runValue = $derived(resolved ? `${formatRunTime(resolved.started_at)} · ${resolved.id.slice(0, 8)}` : 'No complete runs');
  $effect(() => {
    if (active && settings.loaded && review.state === 'ready' && !review.scope && !prompted) {
      prompted = true;
      untrack(() => { if (open !== 'scope') void toggle('scope'); });
    }
    if (!active) untrack(() => close());
  });
  async function toggle(kind: 'scope' | 'run') {
    if (open === kind) { close(); return; }
    open = kind;
    query = '';
    cursor = { column: 0, index: 0 };
    await tick();
    if (open !== kind) return;
    if (kind === 'scope') search?.focus();
    else focusRow({ column: 0, index: Math.max(0, runChoices.findIndex(r => r.value === (review.scope?.kind === 'session' ? review.scope.run : 'preferred'))) });
  }
  function close(restore = false) {
    const field = open === 'run' ? runField : sessionField;
    open = null;
    if (restore) field?.focus();
  }
  function outside(event: PointerEvent) {
    const target = event.target as Node;
    if (open && !drawer?.contains(target) && !sessionField?.contains(target) && !runField?.contains(target)) close();
  }
  function escape(event: KeyboardEvent) {
    if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
  }
  function focusRow(next: { column: number; index: number }) {
    cursor = next;
    drawer?.querySelector<HTMLElement>(`[data-column="${next.column}"][data-index="${next.index}"]`)?.focus();
  }
  function navigate(event: KeyboardEvent, column: number, index: number) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    focusRow(listboxMove(lengths, column, index, event.key));
  }
  function searchKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    const column = lengths.findIndex(n => n > 0);
    if (column >= 0) focusRow({ column, index: 0 });
  }
  function chooseScope(kind: 'session' | 'mount', id: string) {
    close(true);
    void review.open({ kind, id });
  }
  function chooseRun(run: string) {
    if (review.scope?.kind !== 'session') return;
    const scope = review.scope;
    close(true);
    void review.open({ ...scope, run });
  }
</script>
<svelte:window onpointerdown={outside} onblur={() => close()} onkeydown={escape} />
{#snippet icon(path: string, cls = '')}<svg class={cls} viewBox="0 0 20 20" aria-hidden="true"><path d={path} /></svg>{/snippet}
<div class="picker-header">
  <div class="scope-row">
    <h1>Review</h1>
    {#if review.sessionCursor || review.mountCursor}<button class="btn small" disabled={review.listsLoading} onclick={() => void review.loadMoreLists()}>{review.listsLoading ? 'Loading…' : 'Load more sessions and mounts'}</button>{/if}
    <div class="fields">
      <button class="btn picker-field session-field" class:primary={!review.scope} class:open={open === 'scope'}
        aria-label="Choose review scope" aria-expanded={open === 'scope'} aria-controls="review-picker-drawer"
        title={name} bind:this={sessionField} onclick={() => void toggle('scope')}>
        {@render icon('m2 6 8-4 8 4-8 4zm0 4 8 4 8-4M2 14l8 4 8-4', 'leading')}
        <span class="field-text"><small>{review.scope?.kind === 'mount' ? 'Mount' : 'Session'}</small><span class="value">{name}</span></span>
        {#if review.scope}<span class="facts">{session ? `${session.material} · ${plural(session.acquisition_count, 'spot')}` : plural(mount?.spot_count ?? review.rows.length, 'spot')}</span>{/if}
        {@render icon('m5 7 5 5 5-5', 'chevron')}
      </button>
      {#if review.scope?.kind === 'session'}
        <span class="breadcrumb" aria-hidden="true">›</span>
        <button class="btn picker-field run-field" class:open={open === 'run'} aria-label="Review run"
          aria-expanded={open === 'run'} aria-controls="review-picker-drawer" title={runValue} bind:this={runField} onclick={() => void toggle('run')}>
          {@render icon('M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16m0 3v5l3 2', 'leading')}
          <span class="field-text"><small>Run</small><span class="value">{runValue}</span></span>
          {#if resolved}{@const badge = runBadge(resolved, runs)}<span class="badge facts {badge.tone}">{badge.text}</span>{/if}
          {@render icon('m5 7 5 5 5-5', 'chevron')}
        </button>
      {/if}
    </div>
    <div class="header-actions">{@render actions()}</div>
  </div>
  {#if open}
    <div id="review-picker-drawer" class="drawer surface-opaque" data-testid="review-picker-drawer" bind:this={drawer}>
      {#if open === 'scope'}
        <div class="search-row">
          <input type="search" aria-label="Search scopes" placeholder="Zircon_demoB, Demo_XS…" bind:value={query} bind:this={search}
            oninput={() => cursor = { column: 0, index: 0 }} onkeydown={searchKey} />
          <small class="muted key-hint">↑↓ move · Enter open · Esc close</small>
        </div>
        <div class="scope-columns">
          {#each columns as rows, column}
            <section>
              <h2>{column === 0 ? 'Sessions, newest first' : 'Mounts'}</h2>
              <div role="listbox" aria-label={column === 0 ? 'Sessions' : 'Mounts'}>
                {#each rows as row, index (row.id)}
                  {@const selected = review.scope?.kind === row.kind && review.scope.id === row.id}
                  <button role="option" aria-selected={selected} class="option" title={row.name}
                    tabindex={(cursor.column === column && cursor.index === index) || (cursor.column !== column && index === 0) ? 0 : -1}
                    data-column={column} data-index={index} onfocus={() => cursor = { column, index }}
                    onkeydown={e => navigate(e, column, index)} onclick={() => chooseScope(row.kind, row.id)}>
                    <span class="option-name">{row.name}</span><small class="muted option-facts">{row.facts}</small><span class="check" aria-hidden="true">{selected ? '✓' : ''}</span>
                  </button>
                {/each}
              </div>
            </section>
          {/each}
        </div>
        {#if !columns.some(c => c.length)}<p class="muted empty">No session or mount matches “{query}”</p>{/if}
      {:else}
        <div class="run-heading"><h2>Runs, newest first</h2><small class="muted key-hint">↑↓ move · Enter open · Esc close</small></div>
        <div role="listbox" aria-label="Runs">
          {#each runChoices as choice, index (choice.value)}
            {@const r = choice.run}
            <button role="option" class="option run-option" aria-selected={review.scope?.kind === 'session' && review.scope.run === choice.value}
              tabindex={cursor.index === index ? 0 : -1} data-column="0" data-index={index} data-run={choice.value}
              onfocus={() => cursor = { column: 0, index }} onkeydown={e => navigate(e, 0, index)} onclick={() => chooseRun(choice.value)}>
              <span class="run-description">
                <span>{choice.alias ? (r.is_preferred_for_session ? 'Preferred run' : 'Newest run, not preferred') : `${formatRunTime(r.started_at)} · ${r.id.slice(0, 8)}`}</span>
                <small class="muted">{choice.alias ? `${formatRunTime(r.started_at)} · ${r.id.slice(0, 8)} · ` : ''}{[r.run_by, r.upbrpy_version || r.pipeline_version].filter(Boolean).join(' · ')} · {plural(r.result_count, 'spot')}</small>
                {#if r.parsing_changed_at}<small class="warning">made before spot names were re-parsed</small>{/if}
              </span>
              <span class="run-badges">{#if r.is_preferred_for_session}<span class="badge success">Preferred</span>{/if}{#if r.id === runs[0]?.id}<span class="badge warning">Newest</span>{/if}</span>
              <span class="check" aria-hidden="true">{review.scope?.kind === 'session' && review.scope.run === choice.value ? '✓' : ''}</span>
            </button>
          {/each}
        </div>
        {#if !runChoices.length}<p class="muted empty">No complete runs</p>{/if}
      {/if}
    </div>
  {/if}
</div>
<style>
  .picker-header {container-type:inline-size;min-width:0;}
  .scope-row {display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;}
  h1 {font-size:1rem;flex:none;}
  .fields {display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0;flex:1 1 580px;}
  .picker-field {height:40px;padding:3px 8px;gap:8px;border-radius:var(--radius-sm);min-width:0;max-width:100%;flex:1 1 260px;text-align:left;}
  .session-field {background:var(--accent-soft);border-color:var(--accent);}
  .session-field.primary {background:var(--accent);color:var(--accent-contrast);}
  .picker-field.open {border-color:var(--accent);background:var(--accent-soft);color:var(--text);}
  .picker-field:hover {background:var(--row-hover);border-color:var(--accent);}
  .session-field.primary:hover {background:var(--accent);filter:brightness(1.08);}
  .picker-field:focus-visible {outline:2px solid var(--accent);outline-offset:2px;}
  .field-text {display:flex;flex-direction:column;min-width:16ch;flex:1;line-height:1.15;}
  .field-text small {font-size:0.64rem;opacity:0.85;}
  .value {font-size:0.83rem;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .facts {font-size:0.7rem;white-space:nowrap;}
  svg {width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5;flex:none;}
  .chevron {width:14px;height:14px;transition:transform var(--motion);}
  .open .chevron {transform:rotate(180deg);}
  .breadcrumb {color:var(--text-muted);font-size:1.2rem;}
  .header-actions {display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap;min-width:0;}
  .drawer {margin-top:6px;padding:10px;max-height:300px;overflow:auto;overscroll-behavior:contain;border-color:var(--accent);border-top-left-radius:0;}
  .search-row,.run-heading {display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px;}
  .search-row input {flex:1 1 250px;width:0;min-width:0;font-size:0.8rem;}
  .key-hint {font-size:0.68rem;}
  .scope-columns {display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:12px;}
  section {min-width:0;}
  h2 {font-size:0.75rem;font-weight:550;color:var(--text-muted);margin:0 0 5px;}
  .option {display:flex;align-items:center;gap:8px;width:100%;min-width:0;text-align:left;border:1px solid transparent;border-radius:var(--radius-sm);background:transparent;padding:7px 8px;font-size:0.8rem;cursor:pointer;}
  .option:hover {background:var(--row-hover);}
  .option[aria-selected='true'] {background:var(--accent-soft);}
  .option:focus-visible {outline:2px solid var(--accent);outline-offset:-2px;}
  .option-name {overflow-wrap:anywhere;min-width:0;}
  .option-facts {margin-left:auto;text-align:right;font-size:0.7rem;}
  .check {color:var(--accent);flex:none;width:1em;margin-left:auto;}
  .run-description {display:flex;flex-direction:column;min-width:0;overflow-wrap:anywhere;}
  .run-description small {font-size:0.7rem;}
  .run-badges {display:flex;gap:5px;margin-left:auto;flex-wrap:wrap;}
  .success {color:var(--ok);background:color-mix(in srgb,var(--ok) 10%,transparent);}
  .warning {color:var(--warning);}
  .badge.warning {background:color-mix(in srgb,var(--warning) 10%,transparent);}
  .neutral {color:var(--text-muted);}
  .empty {font-size:0.8rem;margin:8px 0;}
  @container (max-width:1200px) {.picker-field .facts {display:none;}}
  @container (max-width:1000px) {.leading {display:none;}}
  @container (max-width:700px) {.scope-columns {grid-template-columns:minmax(0,1fr);}.option {flex-wrap:wrap;}.run-badges {margin-left:0;}}
</style>
