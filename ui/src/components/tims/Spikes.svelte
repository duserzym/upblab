<script lang="ts">
  import { untrack, onMount, onDestroy } from 'svelte';
  import { identity } from '../../lib/identity.svelte';
  import { timsRights } from '../../lib/tims-rights.svelte';
  import { tims, type ListPage, type SpikeSolution, type VersionOut, type VersionStatus } from '../../lib/tims-api';
  import { outbox } from '../../lib/outbox.svelte';
  import Composition from './Composition.svelte';
  import { ReplyScope } from '../../lib/tims-requests';
  let { lab }: { lab: string } = $props();
  let rows = $state.raw<SpikeSolution[]>([]), page = $state.raw<ListPage<SpikeSolution> | null>(null), version = $state.raw<VersionOut | null>(null), error = $state(''), busy = $state(false), status = $state<VersionStatus>('current'), notes = $state(''), versionLab = $state<string | null>(null);
  let generation = 0, selection = 0;
  const replies = new ReplyScope(() => lab);
  onDestroy(() => replies.invalidate());
  const shown = $derived(version ? { ...version, ...Object.assign({}, ...outbox.pending(`spike_version:${version.id}`).map(e => e.body)) } as VersionOut : null);
  const editable = $derived(!!version && (versionLab ? timsRights.canEdit(versionLab, `spike_version:${version.id}`) : identity.account?.is_superuser === true && timsRights.canEdit(lab, `spike_version:${version.id}`)));
  $effect(() => { void identity.revision; void lab; untrack(() => { generation++; selection++; rows = []; page = null; version = null; void load(); }); });
  onMount(() => { const saved = (event: Event) => { const key = (event as CustomEvent<{ objectKey: string }>).detail?.objectKey; if (rows.some(s => s.subfractions.some(sub => sub.versions.some(v => key === `spike_version:${v.id}`)))) void load(); if (version && key === `spike_version:${version.id}`) void choose(version.id, versionLab, true); }; window.addEventListener('tims-saved', saved); return () => { generation++; selection++; window.removeEventListener('tims-saved', saved); }; });
  async function load(more = false) { const gen = ++generation, current = replies.capture(); busy = true; error = ''; try { const next = more ? await page?.more() : await tims.spikes(); if (gen !== generation || !current()) return; if (next) { rows = more ? [...rows, ...next.items] : next.items; page = next; } } catch (e) { if (gen === generation && current()) error = String(e); } finally { if (gen === generation && current()) busy = false; } }
  async function choose(id: string, owner: string | null, refresh = false) {
    const gen = ++selection, current = replies.capture(); if (!refresh) version = null; error = '';
    try { const detail = await tims.version(id); if (gen !== selection || !current()) return; version = detail; versionLab = owner; if (!refresh) { const pending = Object.assign({}, ...outbox.pending(`spike_version:${id}`).map(e => e.body)); status = pending.status ?? detail.status; notes = pending.notes ?? detail.notes; } }
    catch (e) { if (gen === selection && current()) error = String(e); }
  }
  async function save() { if (!version) return; const current = replies.capture(() => [selection, version?.id, status, notes]); try { await tims.patchVersion(version.id, { status, notes }); } catch (e) { if (current()) error = String(e); } }
</script>
<section class="stack" aria-label="Spike registry"><h2>Spikes</h2><p class="muted small">Registered calibrations. Composition and provenance are immutable.</p>
{#if error}<p class="error" role="status">{error}</p>{/if}
{#each rows as solution}<article class="panel stack"><h3>{solution.name} · {solution.registry_id}</h3><p>{solution.active ? 'active' : 'inactive'} · {solution.origin}</p>{#each solution.subfractions as sub}<section class="stack"><strong>{sub.name} · {sub.origin}</strong><div class="row">{#each sub.versions as v}<button class="btn" onclick={() => void choose(v.id, sub.lab_id)}>{v.version} · {v.status} · {v.source_display || v.source}</button>{/each}</div></section>{/each}</article>{:else}<p>{busy ? 'Loading spikes…' : 'No visible spikes.'}</p>{/each}
{#if page?.nextCursor}<button class="btn" disabled={busy} onclick={() => void load(true)}>Load more spikes</button>{/if}
{#if shown}<Composition version={{ ...shown, is_current: shown.status === 'current' }} />{#if outbox.pending(`spike_version:${shown.id}`).length}<p role="status">Saved here, not sent yet</p>{/if}<form class="panel stack" onsubmit={e => { e.preventDefault(); void save(); }}><label>Version status <select bind:value={status} disabled={!editable}>{#each ['current', 'superseded', 'withdrawn'] as s}<option value={s}>{s}</option>{/each}</select></label><label>Version notes <textarea bind:value={notes} disabled={!editable}></textarea></label><button class="btn" disabled={!editable}>Save version here</button>{#if !editable}<p class="muted small">{timsRights.recordReason(`spike_version:${shown.id}`) || (versionLab ? 'Membership of this version’s lab is required to edit.' : 'Only superusers may edit public versions.')}</p>{/if}</form>{/if}
</section>
<style>h2,h3,p{margin:0}.row{flex-wrap:wrap}.panel{padding:10px;min-width:0}label{display:grid;gap:4px}textarea,select{min-width:0;width:100%}section{overflow-wrap:anywhere}</style>
