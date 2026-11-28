<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import { tims, type SpikeSolution, type VersionOut, type ListPage } from '../../lib/tims-api';
  import { identity } from '../../lib/identity.svelte';
  import { ReplyScope } from '../../lib/tims-requests';
  import { spikeVersionName } from '../../lib/tims-display';
  let { value = '', disabled = false, resolving = false, lab = '', knownVersions = {}, onchange, ondetail }: {
    value?: string; disabled?: boolean; resolving?: boolean; lab?: string; knownVersions?: Record<string, VersionOut>;
    ondetail?: (detail: VersionOut) => void;
    onchange?: (id: string, detail: VersionOut, spikeType?: string) => void;
  } = $props();
  let older = $state(false);
  let open = $state(false), error = $state(''), busy = $state(false);
  let solutions = $state.raw<SpikeSolution[]>([]), page = $state.raw<ListPage<SpikeSolution> | null>(null);
  let solution = $state(''), subfraction = $state(''), candidate = $state(''), detail = $state.raw<VersionOut | null>(null);
  let selectedDetail = $state.raw<VersionOut | null>(null);
  let generation = 0;
  // The catalogue belongs to the lab, not to the selected form value.
  const replies = new ReplyScope(() => lab);
  onDestroy(() => replies.invalidate());
  const selected = $derived(solutions.find(s => s.id === solution));
  const sub = $derived(selected?.subfractions.find(s => s.id === subfraction));
  const source = () => `${identity.target?.server}:${identity.revision}`;
  $effect(() => { void identity.revision; void identity.target?.server; void lab; untrack(() => { replies.invalidate(); generation++; open = false; solutions = []; page = null; detail = null; selectedDetail = null; solution = ''; subfraction = ''; candidate = ''; busy = false; error = ''; }); });
  const selectedVersion = $derived(detail?.id === value ? detail : knownVersions[value] ?? (selectedDetail?.id === value ? selectedDetail : null));
  $effect(() => { if (selectedVersion) ondetail?.(selectedVersion); });
  const selectedName = $derived(spikeVersionName(value, solutions, selectedVersion));
  $effect(() => {
    const id = value; void lab; void identity.revision; void identity.target?.server;
    untrack(() => {
      if (!id || selectedVersion) return;
      const current = replies.capture(() => value);
      void tims.version(id).then(v => { if (current()) selectedDetail = v; }).catch(() => { /* A readable fallback remains when details are not visible. */ });
    });
  });
  async function load(more = false) {
    const owner = source(), current = replies.capture(); busy = true; error = '';
    try { const next = more ? await page?.more() : await tims.spikes(); if (!current()) return; if (next) { page = next; solutions = more ? [...solutions, ...next.items] : next.items; } }
    catch (e) { if (owner === source() && current()) error = String(e); } finally { if (current()) busy = false; }
  }
  async function review(id: string) {
    candidate = id; detail = null; const gen = ++generation, current = replies.capture(() => [solution, subfraction, candidate, open]); error = '';
    if (!id) return;
    try { const v = knownVersions[id] ?? (selectedDetail?.id === id ? selectedDetail : await tims.version(id)); if (gen === generation && current()) detail = v; }
    catch (e) { if (gen === generation && current()) error = String(e); }
  }
</script>
<div class="stack picker">
  <div class="row spike-line"><p class="small selected-version" title={selectedName || value || undefined}>Spike: {value ? selectedVersion ? `${selectedVersion.solution_name} · ${selectedVersion.version}` : selectedName || 'Details unavailable' : resolving ? 'Loading default spike…' : 'Choose spike'}</p>
  {#if onchange}<button class="btn small" type="button" {disabled} aria-expanded={open} onclick={() => { open = !open; if (open && !solutions.length && !busy) void load(); }}>{value ? 'Change' : 'Choose spike'}</button>{/if}</div>
  <p class="small muted picker-note">{!value && !resolving ? 'Choose a registered spike; no unique current default is available.' : ''}</p>
  {#if open && onchange}
    <section class="panel stack" aria-label="Spike version picker">
      {#if busy}<p class="small" role="status">Loading spike solutions…</p>{/if}
      <label>Solution <select aria-label="Solution" bind:value={solution} onchange={() => { subfraction = ''; candidate = ''; detail = null; generation++; }}><option value="">Choose solution</option>{#each solutions.filter(s => s.active) as s}<option value={s.id}>{s.name}{s.spike_type ? ` · ${s.spike_type}` : ''}</option>{/each}</select></label>
      {#if page?.nextCursor}<button class="btn" type="button" disabled={busy} onclick={() => void load(true)}>Load more solutions</button>{/if}
      <label>Subfraction <select aria-label="Subfraction" bind:value={subfraction} onchange={() => { candidate = ''; detail = null; generation++; }}><option value="">Choose subfraction</option>{#each selected?.subfractions.filter(s => !lab || !s.lab_id || s.lab_id === lab) ?? [] as s}<option value={s.id}>{s.name}</option>{/each}</select></label>
      <label class="check"><input type="checkbox" bind:checked={older} /> Show older versions</label>
      {#if older}<p class="small warning">Superseded versions are historical. Check before using an older calibration.</p>{/if}
      <label>Version <select aria-label="Version" value={candidate} onchange={e => void review(e.currentTarget.value)}><option value="">Choose version</option>{#each sub?.versions.filter(v => v.status === 'current' || older && v.status === 'superseded') ?? [] as v}<option value={v.id} disabled={v.status === 'withdrawn'}>{v.version} · {v.status === 'current' ? 'current' : `${v.status} · not current`}</option>{/each}</select></label>
      {#if candidate}
      {#if detail && detail.id === candidate}<button class="btn" type="button" disabled={disabled || detail.status === 'withdrawn'} onclick={() => { if (detail) onchange?.(detail.id, detail, selected?.spike_type); open = false; }}>Use version</button>
      {:else}<p class="small muted">{error || 'Loading version…'}</p>{/if}
      {/if}
      <p class="small error picker-status" role="status">{error}</p>
    </section>
  {/if}
</div>
<style>.check{display:flex;align-items:baseline}.spike-line{min-height:32px;flex-wrap:wrap}.spike-line>p{flex:1;min-width:0}.selected-version{min-height:20px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical}.picker-note{min-height:20px}.picker-status{height:36px;overflow:auto}.picker{min-width:0}section{padding:8px}select{width:100%;max-width:28rem;min-width:0}label{display:grid;gap:4px}p{margin:0}.btn{align-self:flex-start}</style>
