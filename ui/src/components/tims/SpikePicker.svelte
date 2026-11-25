<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import { tims, type SpikeSolution, type VersionOut, type ListPage } from '../../lib/tims-api';
  import { identity } from '../../lib/identity.svelte';
  import Composition from './Composition.svelte';
  import { ReplyScope } from '../../lib/tims-requests';
  import { spikeVersionName } from '../../lib/tims-display';
  let { value = '', disabled = false, lab = '', knownVersions = {}, showComposition = false, onchange, ondetail }: {
    value?: string; disabled?: boolean; lab?: string; knownVersions?: Record<string, VersionOut>; showComposition?: boolean;
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
  const selectedType = $derived(solutions.find(item => item.id === selectedVersion?.solution_id)?.spike_type);
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
  <p class="small selected-version" title={selectedName || value || undefined}>{value ? `Selected version: ${selectedName || 'Details unavailable'}` : 'No registered spike version selected'}</p>
  {#if showComposition && selectedVersion}
    {#if selectedType}<p class="small">Spike type · {selectedType}</p>{/if}
    <details><summary>Check spike composition</summary><Composition version={selectedVersion} /></details>
  {/if}
  {#if onchange}<button class="btn" type="button" {disabled} aria-expanded={open} onclick={() => { open = !open; if (open && !solutions.length && !busy) void load(); }}>Choose spike version</button>{/if}
  {#if open && onchange}
    <section class="panel stack" aria-label="Spike version picker">
      {#if busy}<p class="small" role="status">Loading spike solutions…</p>{/if}
      <label>Solution <select aria-label="Solution" bind:value={solution} onchange={() => { subfraction = ''; candidate = ''; detail = null; generation++; }}><option value="">Choose solution</option>{#each solutions.filter(s => s.active) as s}<option value={s.id}>{s.name}{s.spike_type ? ` · ${s.spike_type}` : ''}</option>{/each}</select></label>
      {#if page?.nextCursor}<button class="btn" type="button" disabled={busy} onclick={() => void load(true)}>Load more solutions</button>{/if}
      <label>Subfraction <select aria-label="Subfraction" bind:value={subfraction} onchange={() => { candidate = ''; detail = null; generation++; }}><option value="">Choose subfraction</option>{#each selected?.subfractions.filter(s => !lab || !s.lab_id || s.lab_id === lab) ?? [] as s}<option value={s.id}>{s.name}</option>{/each}</select></label>
      <label class="check"><input type="checkbox" bind:checked={older} /> Show older versions</label>
      {#if older}<p class="small warning">Superseded versions are historical. Check before using an older calibration.</p>{/if}
      <label>Version <select aria-label="Version" value={candidate} onchange={e => void review(e.currentTarget.value)}><option value="">Choose version to review</option>{#each sub?.versions.filter(v => v.status === 'current' || older && v.status === 'superseded') ?? [] as v}<option value={v.id} disabled={v.status === 'withdrawn'}>{v.version} · {v.status === 'current' ? 'current' : `${v.status} · not current`}</option>{/each}</select></label>
      {#if candidate}
      <div class="version-preview">
      {#if detail && detail.id === candidate}
        <Composition version={detail} />
      {:else}<p class="small muted">{error || 'Loading composition…'}</p>{/if}
      </div>
      {#if detail && detail.id === candidate}<button class="btn" type="button" disabled={disabled || detail.status === 'withdrawn'} onclick={() => { if (detail) onchange?.(detail.id, detail, selected?.spike_type); open = false; }}>Apply reviewed version</button>{/if}
      {/if}
      <p class="small error picker-status" role="status">{error}</p>
    </section>
  {/if}
</div>
<style>.check{display:flex;align-items:baseline}.selected-version{height:40px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical}.version-preview{height:320px;overflow:auto;scrollbar-gutter:stable}.picker-status{height:36px;overflow:auto}.picker{min-width:0}section{padding:8px}select{width:100%;max-width:28rem;min-width:0}label{display:grid;gap:4px}p{margin:0}.btn{align-self:flex-start}</style>
