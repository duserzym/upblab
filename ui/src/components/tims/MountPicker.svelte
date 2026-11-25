<script lang="ts">
  import { mountGroups, magnification } from '../../lib/tims-picker-context';
  import type { PickerMount } from '../../lib/tims-spot-finder';
  let { mounts, recent, selected, busy, hasMore, onchoose, onmore, onsearch }: {
    mounts: PickerMount[]; recent: PickerMount[]; selected?: PickerMount; busy: boolean; hasMore: boolean;
    onchoose: (mount: PickerMount) => void; onmore: () => void; onsearch: (query: string) => void;
  } = $props();
  const uid = $props.id();
  let input: HTMLInputElement;
  let open = $state(false), query = $state(''), active = $state(0);
  const groups = $derived(mountGroups(mounts, recent, query));
  const options = $derived(groups.flatMap(group => group.mounts));
  const start = $derived(Math.floor(Math.max(0, active) / 80) * 80);
  const visible = $derived(options.slice(start, start + 80));
  function choose(mount: PickerMount) { onchoose(mount); open = false; query = ''; active = 0; }
  function key(event: KeyboardEvent) {
    if (!open && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key.length === 1 || event.key === 'Backspace')) {
      event.preventDefault(); query = event.key === 'Backspace' ? '' : event.key; open = true; active = 0; return;
    }
    if (event.key === 'Escape') { open = false; return; }
    if (event.key === 'Enter') { event.preventDefault(); if (open && options[active]) choose(options[active]); else open = true; return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!open) { open = true; active = 0; }
    else active = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
    requestAnimationFrame(() => document.getElementById(`${uid}-${active}`)?.scrollIntoView({ block: 'nearest' }));
  }
</script>
<div class="stack mount-picker">
  <div class="row heading">
    <strong class="small">{selected?.label ?? 'Choose a mount'}</strong>
    <button class="btn small" type="button" aria-expanded={open} onclick={() => { open = !open; query = ''; active = 0; if (open) requestAnimationFrame(() => input.focus({ preventScroll: true })); }}>{selected ? 'Change mount' : open ? 'Close mounts' : 'Find mount'}</button>
  </div>
  <label>Mount
    <input bind:this={input} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${uid}-list`}
      aria-activedescendant={open && options[active] ? `${uid}-${active}` : undefined}
      value={open ? query : selected?.label ?? ''} placeholder="Label, sample or project"
      onfocus={() => { open = true; }} oninput={event => { query = event.currentTarget.value; open = true; active = 0; }} onkeydown={key} />
  </label>
  {#if open}
    <div class="options" role="listbox" id={`${uid}-list`} aria-label="Mounts">
      {#each groups as group, groupIndex (groupIndex + ':' + group.label)}
        {#if group.mounts.some(mount => visible.includes(mount))}
          <div role="group" aria-label={group.label}>
            <p class="small muted">{group.label}</p>
            {#each group.mounts.filter(mount => visible.includes(mount)) as mount (mount.id)}
              {@const index = options.indexOf(mount)}
              <button class="btn option" type="button" role="option" tabindex="-1" id={`${uid}-${index}`} aria-selected={selected?.id === mount.id} aria-posinset={index + 1} aria-setsize={options.length}
                title={[mount.mineral, mount.last_changed_at ? `Changed ${mount.last_changed_at}` : '', mount.content_revision != null ? `Revision ${mount.content_revision}` : '', mount.atlas ? 'Published atlas available' : 'No published image'].filter(Boolean).join(' · ')}
                class:active={active === index} onpointerdown={event => event.preventDefault()} onclick={() => choose(mount)}>
                <strong>{mount.label}</strong>
                <span class="small muted">{magnification(mount)} · {mount.sample_count ?? 'Unknown'} samples · {mount.grain_count ?? 'Unknown'} grains</span>
                <span class="small muted samples" title={(mount.sample_names ?? []).join(', ')}>{(mount.sample_names ?? []).join(', ') || 'Sample names unrecorded'}</span>
              </button>
            {/each}
          </div>
        {/if}
      {/each}
      {#if !options.length}<p class="small muted">No loaded mounts match. Search the server or load more mounts.</p>{/if}
    </div>
    <div class="row">
      {#if start > 0}<button class="btn small" type="button" onclick={() => active = Math.max(0, start - 80)}>Previous matches</button>{/if}
      {#if options.length > start + 80}<button class="btn small" type="button" onclick={() => active = start + 80}>Show more matches</button>{/if}
      {#if hasMore}<button class="btn small" type="button" disabled={busy} onclick={onmore}>Load more mounts</button>{/if}
      <button class="btn small" type="button" disabled={busy} onclick={() => onsearch(query)}>Find mount</button>
      <button class="btn small" type="button" onclick={() => open = false}>Done</button>
    </div>
  {/if}
</div>
<style>
  .mount-picker { min-width: 0; gap: var(--space-1); }
  .heading { justify-content: space-between; flex-wrap: wrap; }
  .heading strong { overflow-wrap: anywhere; }
  label { display: grid; gap: 4px; }
  input { min-width: 0; width: 100%; }
  .options { height: 180px; min-height: 180px; overflow: auto; scrollbar-gutter: stable; border: 1px solid var(--hairline); border-radius: var(--radius-sm); padding: 4px; }
  .option { height: 82px; overflow: hidden; display: grid; width: 100% !important; text-align: left; white-space: normal; gap: 2px; }
  .option strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .option.active { border-color: var(--accent); background: var(--accent-soft); }
  .samples { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  p { margin: 4px; }
  .row { flex-wrap: wrap; }
</style>
