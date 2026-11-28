<script lang="ts">
  import UpdateNotes from './UpdateNotes.svelte';
  import { moduleLabel } from '../lib/links';
  import { onMount, tick } from 'svelte';
  import { isDesktop, openExternal } from '../lib/platform';
  import { settings } from '../lib/settings.svelte';
  import { shell } from '../lib/shell.svelte';
  import { check, download, install, updater } from '../lib/updater.svelte';
  import { checkButtonView, RELEASES_PAGE } from '../lib/updates';
  import { moduleVersions, type ModuleVersion } from '../lib/versions';
  import { openOverlay, closeOverlay } from '../lib/overlays.svelte';

  let button: HTMLButtonElement;
  let popup: HTMLDivElement;
  let whatsNew: HTMLDivElement;
  let dismiss: HTMLButtonElement;
  let whatsNewLeft = $state(12), whatsNewTop = $state(54);
  let open = $state(false);
  let modules = $state<ModuleVersion[]>([]);
  let modulesLoaded = false;
  let left = $state(12), top = $state(54);
  const view = $derived(checkButtonView(updater.status, updater.version, {
    autoDownload: settings.updateAuto, standardsWarning: updater.standards.warning,
  }));

  function position(target = popup) {
    if (!button || !target) return;
    const anchor = button.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const x = Math.max(12, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 12));
    const y = Math.max(12, Math.min(anchor.bottom + 6, window.innerHeight - rect.height - 12));
    if (target === whatsNew) { whatsNewLeft = x; whatsNewTop = y; }
    else { left = x; top = y; }
  }
  function beforeToggle(event: ToggleEvent) {
    open = event.newState === 'open';
    // Native module webviews must hide before the shell's popover can paint over them.
    if (open) openOverlay('updates');
    else closeOverlay('updates');
    if (open) {
      if (!modulesLoaded) {
        modulesLoaded = true;
        void moduleVersions().then((result) => { modules = result; });
      }
      void tick().then(() => position());
    }
  }
  onMount(() => {
    const observer = new ResizeObserver(() => { if (open) position(); });
    observer.observe(popup);
    const cardObserver = new ResizeObserver(() => { if (updater.whatsNewOpen) position(whatsNew); });
    cardObserver.observe(whatsNew);
    return () => { observer.disconnect(); cardObserver.disconnect(); closeOverlay('updates'); closeOverlay('whats-new'); };
  });
  $effect(() => {
    if (updater.whatsNewOpen) {
      void tick().then(() => {
        if (!updater.whatsNewOpen) return;
        popup.hidePopover();
        whatsNew.showPopover();
        position(whatsNew);
        dismiss.focus();
      });
    }
  });
  async function showSettings(event: MouseEvent) {
    event.preventDefault();
    popup.hidePopover();
    shell.show('settings');
    await tick();
    document.getElementById('updates')?.scrollIntoView({ block: 'start' });
  }
</script>

<svelte:window onresize={() => { if (open) position(); if (updater.whatsNewOpen) position(whatsNew); }} />

<span class="chip small muted version" data-testid="app-version" title="Current version">v{updater.version}</span>
<button
  bind:this={button}
  class="tab icon"
  aria-label="Check for updates"
  title="Check for updates · UPb Lab v{updater.version}{updater.status.kind === 'idle' ? '' : ` · ${view.text}`}{updater.standards.warning ? ' · Standards warning' : ''}"
  data-testid="check-updates"
  data-badge={view.badge ? 'true' : undefined}
  aria-busy={view.busy}
  aria-expanded={open}
  aria-haspopup="dialog"
  popovertarget="check-updates-popover"
  onclick={() => { if (!popup.matches(':popover-open')) void check(true); }}
>
  <svg class:busy={view.busy} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20 7a8 8 0 0 0-14-2L3 8m0-5v5h5M4 17a8 8 0 0 0 14 2l3-3m0 5v-5h-5" />
  </svg>
  {#if view.badge}<span class="dot" class:warning={updater.standards.warning} aria-hidden="true"></span>{/if}
</button>
<div
  bind:this={popup}
  id="check-updates-popover"
  data-testid="check-updates-popover"
  class="surface-opaque stack updates-popover"
  role="dialog"
  aria-label="Updates"
  tabindex="-1"
  popover="auto"
  style:left="{left}px"
  style:top="{top}px"
  onbeforetoggle={beforeToggle}
  ontoggle={() => { if (open) position(); }}
>
  <strong>UPb Lab v{updater.version}</strong>
  <p role="status">{view.text}</p>
  {#if view.secondaryText}<p class="small muted">{view.secondaryText}</p>{/if}
  <UpdateNotes status={updater.status} />
  {#if view.details !== null}<p class="small muted error-details">Details: {view.details}</p>{/if}
  {#if view.action === 'download'}
    <button class="btn" onclick={() => void download()}>Download</button>
  {:else if view.action === 'install'}
    <button class="btn primary" onclick={() => void install()}>Restart to update</button>
  {:else if view.action === 'releases'}
    <a href={RELEASES_PAGE} target="_blank" rel="noreferrer" onclick={(event) => { if (isDesktop) { event.preventDefault(); void openExternal(RELEASES_PAGE); } }}>Open download page</a>
  {/if}
  {#if updater.standards.warning}<p class="small warning">Standards warning: {updater.standards.message}</p>{/if}
  {#if modules.length}
    <p class="small muted">Modules: {modules.map((module) => `${moduleLabel(module.name)} ${module.version}${module.source === 'local' ? ` (local${module.commit ? ` ${module.commit.slice(0, 7)}${module.dirty ? ', modified' : ''}` : ''})` : ''}`).join(', ')}</p>
    <p class="small muted">Modules update with UPb Lab.</p>
  {/if}
  <a class="small" href="#whats-new" onclick={(event) => { event.preventDefault(); popup.hidePopover(); updater.whatsNewOpen = true; }}>What's new</a>
  <a class="small" href="#updates" onclick={showSettings}>Update settings…</a>
</div>

<div bind:this={whatsNew} id="whats-new" data-testid="whats-new" class="surface-opaque stack updates-popover" role="dialog" aria-labelledby="whats-new-title" tabindex="-1" popover="auto"
  style:left="{whatsNewLeft}px" style:top="{whatsNewTop}px"
  onbeforetoggle={(event) => {
    if (event.newState === 'open') openOverlay('whats-new');
    else { updater.whatsNewOpen = false; closeOverlay('whats-new'); }
  }}
  ontoggle={(event) => { if (event.newState === 'closed') button?.focus(); }}
>
  <div class="row card-heading">
    <strong id="whats-new-title">What's new in v{updater.version}</strong>
    <button bind:this={dismiss} class="btn icon" aria-label="Dismiss what's new" onclick={() => whatsNew.hidePopover()}>✕</button>
  </div>
  <p class="whats-new-notes">{updater.whatsNewNotes || `Updated to v${updater.version}.`}</p>
</div>

<style>
  button.tab { position: relative; flex: none; width: 30px; height: 30px; padding: 0; }
  .version { flex: none; cursor: default; }
  .error-details { user-select: text; -webkit-user-select: text; }
  .dot { position: absolute; width: 6px; height: 6px; top: 2px; right: 2px; background: var(--accent); }
  .dot.warning { background: var(--warning); }
  .warning { color: var(--warning); }
  svg.busy { animation: update-spin 0.9s linear infinite; }
  @keyframes update-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { svg.busy { animation: none; } }
  .updates-popover { position: fixed; inset: auto; margin: 0; width: min(360px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto; padding: var(--space-4); color: var(--text); box-shadow: var(--glass-shadow); overflow-wrap: anywhere; gap: var(--space-3); }
  .updates-popover { -webkit-backdrop-filter: none; backdrop-filter: none; }
  .updates-popover:not(:popover-open) { display: none; }
  p { margin: 0; }
  .card-heading { justify-content: space-between; }
  .whats-new-notes { white-space: pre-wrap; user-select: text; -webkit-user-select: text; }
  .btn { align-self: start; }
</style>
