<script lang="ts">
  import { untrack, onMount, onDestroy } from 'svelte';
  import { identity } from '../../lib/identity.svelte';
  import { timsRights } from '../../lib/tims-rights.svelte';
  import { tims, type ListPage, type SpikeSolution, type SpikeSubfraction, type CompactVersion, type VersionOut, type VersionStatus } from '../../lib/tims-api';
  import { isotopeLabel, subfractionLabel, versionStatusLabel } from '../../lib/spike-format';
  import { shortCitation } from '../../lib/spike-reference';
  import { outbox } from '../../lib/outbox.svelte';
  import Composition from './Composition.svelte';
  import { ReplyScope } from '../../lib/tims-requests';
  let { lab }: { lab: string } = $props();
  let rows = $state.raw<SpikeSolution[]>([]), page = $state.raw<ListPage<SpikeSolution> | null>(null);
  let solutionId = $state(''), versionId = $state(''), version = $state.raw<VersionOut | null>(null);
  let error = $state(''), busy = $state(false), versionBusy = $state(false);
  let status = $state<VersionStatus>('current'), notes = $state(''), versionLab = $state<string | null>(null);
  let cache = $state.raw(new Map<string, VersionOut>());
  let pending = new Map<string, Promise<VersionOut>>();
  let generation = 0, selection = 0;
  const replies = new ReplyScope(() => lab);
  onDestroy(() => replies.invalidate());
  const selected = $derived(rows.find(s => s.id === solutionId));
  const shown = $derived(version ? { ...version, ...Object.assign({}, ...outbox.pending(`spike_version:${version.id}`).map(e => e.body)) } as VersionOut : null);
  const editable = $derived(!!version && (versionLab ? timsRights.canEdit(versionLab, `spike_version:${version.id}`) : identity.account?.is_superuser === true && timsRights.canEdit(lab, `spike_version:${version.id}`)));
  $effect(() => {
    void identity.revision; void identity.target?.server; void lab;
    untrack(() => {
      replies.invalidate(); generation++; selection++; rows = []; page = null; version = null;
      solutionId = ''; versionId = ''; versionLab = null; versionBusy = false;
      cache = new Map(); pending = new Map(); void load();
    });
  });
  onMount(() => {
    const saved = (event: Event) => {
      const key = (event as CustomEvent<{ objectKey: string }>).detail?.objectKey;
      if (!key?.startsWith('spike_version:')) return;
      const id = key.slice('spike_version:'.length);
      cache = new Map([...cache].filter(([cachedId]) => cachedId !== id));
      pending.delete(id);
      if (rows.some(s => s.subfractions.some(sub => sub.versions.some(v => v.id === id)))) void load();
      if (versionId === id) void choose(id, versionLab, true);
    };
    window.addEventListener('tims-saved', saved);
    return () => { generation++; selection++; window.removeEventListener('tims-saved', saved); };
  });
  const currentCount = (s: SpikeSolution) => s.subfractions.reduce((n, sub) => n + sub.versions.filter(v => listedVersion(v).status === 'current').length, 0);
  function selectSolution(solution: SpikeSolution) {
    solutionId = solution.id; selection++; version = null; versionId = ''; versionBusy = false;
    const master = solution.subfractions.find(sub => sub.origin === 'registry' && sub.sub_id === 'master' && sub.versions.some(v => listedVersion(v).status === 'current'));
    const sub = master ?? solution.subfractions.find(sub => sub.versions.some(v => listedVersion(v).status === 'current'));
    const initial = sub?.versions.find(v => listedVersion(v).status === 'current');
    if (initial && sub) void choose(initial.id, sub.lab_id);
  }
  async function load(more = false) {
    const gen = ++generation, current = replies.capture(); busy = true; error = '';
    try {
      const next = more ? await page?.more() : await tims.spikes();
      if (gen !== generation || !current()) return;
      if (next) {
        rows = more ? [...rows, ...next.items] : next.items; page = next;
        if (!rows.some(s => s.id === solutionId) && rows[0]) selectSolution(rows[0]);
      }
    } catch (e) { if (gen === generation && current()) error = String(e); }
    finally { if (gen === generation && current()) busy = false; }
  }
  async function choose(id: string, owner: string | null, refresh = false) {
    const gen = ++selection, current = replies.capture(); versionId = id; versionLab = owner;
    if (!refresh) version = null; versionBusy = true; error = '';
    try {
      let detail = cache.get(id);
      if (!detail) {
        let request = pending.get(id);
        if (!request) {
          const scopePending = pending;
          request = tims.version(id).then(detail => {
            if (current() && scopePending.get(id) === request) cache = new Map(cache).set(id, detail);
            return detail;
          }).finally(() => { if (scopePending.get(id) === request) scopePending.delete(id); });
          pending.set(id, request);
        }
        detail = await request;
      }
      if (gen !== selection || !current()) return;
      version = detail;
      if (!refresh) {
        const edits = Object.assign({}, ...outbox.pending(`spike_version:${id}`).map(e => e.body));
        status = edits.status ?? detail.status; notes = edits.notes ?? detail.notes;
      }
    } catch (e) { if (gen === selection && current()) error = String(e); }
    finally { if (gen === selection && current()) versionBusy = false; }
  }
  async function save() {
    if (!version) return;
    const current = replies.capture(() => [selection, version?.id, status, notes]);
    try { await tims.patchVersion(version.id, { status, notes }); }
    catch (e) { if (current()) error = String(e); }
  }
  function listedVersion(v: CompactVersion): CompactVersion {
    return { ...v, ...Object.assign({}, ...outbox.pending(`spike_version:${v.id}`).map(e => e.body)) };
  }
</script>

{#snippet versionTable(sub: SpikeSubfraction, versions: CompactVersion[])}
  <table class="data versions">
    <colgroup><col class="version-column" /><col class="status-column" /><col /><col class="year-column" /></colgroup>
    <thead><tr><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Source</th><th scope="col">Calibrated</th></tr></thead>
    <tbody>{#each versions as v (v.id)}
      {@const item = listedVersion(v)}
      <tr class:selected={versionId === v.id} aria-selected={versionId === v.id} tabindex="0" aria-label={`View ${v.version} · ${subfractionLabel(sub.sub_id, sub.name)}`} onclick={() => void choose(v.id, sub.lab_id)} onkeydown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void choose(v.id, sub.lab_id); } }}>
        <td class="version-name">{v.version}</td>
        <td><span class="badge" class:current={item.status === 'current'} class:muted={item.status === 'superseded'} class:warning={item.status === 'withdrawn'}>{versionStatusLabel(item.status)}</span></td>
        <td><span class="citation" title={v.source_display || v.source}>{shortCitation(v.source_display || v.source) || 'Not given'}</span></td>
        <td class="small muted" title={!v.calibrated && !cache.get(v.id)?.calibrated ? 'Calibration year not supplied in the version list' : undefined}>{cache.get(v.id)?.calibrated || v.calibrated || '—'}</td>
      </tr>
    {/each}</tbody>
  </table>
{/snippet}

<section class="stack spikes" aria-label="Spikes">
  <header class="stack page-heading"><h2>Spikes</h2><p class="muted small">Registered values cannot be changed; a new calibration is added as a new version.</p></header>
  {#if error}<p class="error" role="status">{error}</p>{/if}
  <div class="master-detail">
    <section class="stack catalogue" aria-label="Spike solutions">
      <div class="solution-list">
        {#each rows as solution (solution.id)}
          {@const count = currentCount(solution)}
          {@const aliases = [...new Set(solution.aliases.filter(a => a !== solution.name))]}
          <button class="panel solution" aria-pressed={solutionId === solution.id} aria-label={solution.name} onclick={() => selectSolution(solution)}>
            <span class="row title-line"><strong>{solution.name}</strong><span class="badge muted">{solution.origin === 'registry' ? 'EARTHTIME' : 'Lab'}</span>{#if !solution.active}<span class="badge muted">Inactive</span>{/if}</span>
            {#if aliases.length}<span class="small muted">also {aliases.join(', ')}</span>{/if}
            {#if solution.isotopes.length}<span class="small muted" aria-label={solution.isotopes.join(' · ')}>{solution.isotopes.map(isotopeLabel).join(' · ')}</span>{/if}
            <span class="small muted">{count} current {count === 1 ? 'version' : 'versions'}</span>
          </button>
        {:else}<p class="small muted">{busy ? 'Loading spikes…' : 'No visible spikes.'}</p>{/each}
      </div>
      {#if page?.nextCursor}<button class="btn" disabled={busy} onclick={() => void load(true)}>Load more spikes</button>{/if}
    </section>
    {#if selected}
      <article class="stack detail" aria-label="Selected spike">
        <header class="stack detail-heading">
          <h3>{selected.name}</h3>
          {#if selected.registry_id && selected.registry_id !== selected.name}<p class="small muted">{selected.registry_id}</p>{/if}
          {#if selected.description}<p class="small">{selected.description}</p>{/if}
          <div class="row"><span class="badge muted">{selected.origin === 'registry' ? 'EARTHTIME' : 'Lab'}</span>{#if !selected.active}<span class="badge muted">Inactive</span>{/if}<span class="small muted" aria-label={selected.isotopes.length ? `${selected.isotopes.join('–')} tracer` : undefined}>{selected.isotopes.length ? `${selected.isotopes.map(isotopeLabel).join('–')} tracer` : `Spike type ${selected.spike_type}`}</span></div>
        </header>
        {#each selected.subfractions as sub (sub.id)}
          {@const current = sub.versions.filter(v => listedVersion(v).status === 'current')}
          {@const earlier = sub.versions.filter(v => listedVersion(v).status !== 'current')}
          <section class="stack calibration" aria-label={subfractionLabel(sub.sub_id, sub.name)}>
            <header><h4>{sub.origin === 'registry' && sub.sub_id === 'master' ? 'EARTHTIME master solution' : subfractionLabel(sub.sub_id, sub.name)}</h4><p class="small muted">{sub.origin === 'registry' && sub.sub_id === 'master' ? 'Published calibration' : "This lab's calibrations"}</p></header>
            {#if current.length}{@render versionTable(sub, current)}{:else}<p class="small muted">No current calibration.</p>{/if}
            {#if earlier.length}<details class="small"><summary>Show {earlier.length} earlier {earlier.length === 1 ? 'version' : 'versions'}</summary>{@render versionTable(sub, earlier)}</details>{/if}
          </section>
        {/each}
        {#if versionBusy}<p class="small muted" role="status">Loading composition…</p>{/if}
        {#if shown}
          <Composition version={{ ...shown, is_current: shown.status === 'current' }} />
          {#if outbox.pending(`spike_version:${shown.id}`).length}<p class="small muted" role="status">Saved here, not sent yet</p>{/if}
          {#key shown.id}<details class="edit small">
            <summary>Edit status and notes</summary>
            <form class="panel stack" onsubmit={e => { e.preventDefault(); void save(); }}>
              <label>Version status <select bind:value={status} disabled={!editable}>{#each ['current', 'superseded', 'withdrawn'] as s}<option value={s}>{versionStatusLabel(s as VersionStatus)}</option>{/each}</select></label>
              <label>Version notes <textarea bind:value={notes} disabled={!editable}></textarea></label>
              <button class="btn" disabled={!editable}>Save version here</button>
              {#if !editable}<p class="muted small">{timsRights.recordReason(`spike_version:${shown.id}`) || (versionLab ? 'Membership of this version’s lab is required to edit.' : 'Only superusers may edit public versions.')}</p>{/if}
            </form>
          </details>{/key}
        {/if}
      </article>
    {/if}
  </div>
</section>
<style>
  h2,h3,h4,p{margin:0}h4{font-size:0.9rem;font-weight:600}
  .spikes{min-width:0;container-type:inline-size;overflow-wrap:anywhere}
  .page-heading{gap:var(--space-2)}.master-detail{display:grid;grid-template-columns:14rem minmax(0,1fr);gap:var(--space-6);align-items:start}
  .catalogue,.detail{min-width:0}.detail{max-width:52rem}.solution-list{display:grid;gap:var(--space-2)}
  .solution{display:flex;flex-direction:column;align-items:flex-start;gap:var(--space-1);margin:0;padding:var(--space-3);width:100%;min-width:0;text-align:left;white-space:normal;border:1px solid var(--hairline);border-radius:var(--radius-sm);background:transparent;cursor:pointer;color:var(--text)}
  .solution:hover{background:var(--row-hover)}.solution[aria-pressed=true]{background:var(--accent-soft);border-color:var(--accent)}
  .title-line{gap:var(--space-2);align-items:center}.title-line .badge{font-size:0.68rem}.detail-heading{gap:var(--space-2)}.detail-heading h3{font-size:1.2rem}
  .calibration{gap:var(--space-2)}.calibration header p{margin-top:var(--space-1)}
  .versions{table-layout:fixed}.version-column{width:19%}.status-column{width:23%}.year-column{width:19%}
  .versions th,.versions td{padding:var(--space-2);position:static;background:none;overflow-wrap:anywhere}.versions th{font-size:0.72rem;text-transform:none;letter-spacing:normal}
  .versions tr{cursor:pointer}.versions tr.selected{background:var(--accent-soft)}
  .versions tr:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}.version-name{font-weight:600;color:var(--accent)}.selected .version-name{color:var(--text)}.citation{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:0.85rem}
  .badge.current{color:var(--accent);background:var(--accent-soft)}.warning{color:var(--warning)}.versions .badge{white-space:normal;padding-inline:var(--space-2)}
  summary{cursor:pointer;color:var(--text-muted);padding-block:var(--space-2)}
  .edit{border-top:1px solid var(--hairline)}.edit .panel{padding:var(--space-3) 0;min-width:0}label{display:grid;gap:var(--space-1)}textarea,select{min-width:0;width:100%}
  @container (max-width:900px){.master-detail{grid-template-columns:minmax(0,1fr);gap:var(--space-4)}.solution-list{grid-template-columns:repeat(auto-fit,minmax(min(12rem,100%),1fr))}}
</style>
