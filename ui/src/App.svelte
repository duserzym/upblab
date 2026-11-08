<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import Home from './routes/Home.svelte';
  import Images from './routes/Images.svelte';
  import Sessions from './routes/Sessions.svelte';
  import Reduce from './routes/Reduce.svelte';
  import Review from './routes/Review.svelte';
  import Settings from './routes/Settings.svelte';
  import FirstRun from './components/FirstRun.svelte';
  import VersionChip from './components/VersionChip.svelte';
  import { startScheduler } from './lib/updater.svelte';
  import AccountDialog from './components/AccountDialog.svelte';
  import { identity } from './lib/identity.svelte';
  import { localService } from './lib/localService.svelte';
  import { listenForLinks } from './lib/incoming';
  import { fromDataTransfer } from './lib/drop';
  import { opener } from './lib/opener.svelte';
  import { settings } from './lib/settings.svelte';
  import { shell, type View } from './lib/shell.svelte';
  import { desktopModules, isDesktop, logWarn } from './lib/platform';

  const tabs: { id: View; label: string; hint: string }[] = [
    { id: 'home', label: 'Home', hint: 'Overview and links' },
    { id: 'images', label: 'Images', hint: 'grainatlas' },
    { id: 'sessions', label: 'Sessions', hint: 'laicpmsdb' },
    { id: 'review', label: 'Review', hint: 'Results with their images' },
    { id: 'reduce', label: 'Reduce', hint: 'UPbRPy Studio' },
  ];

  const reviewSplit = $derived(shell.view === 'review' && settings.reviewSplit);

  // Desktop with no mode stored yet: the first-run wizard (ADR-0003).
  // Waits for the host's status, which says whether "This computer" can run.
  const firstRun = $derived(isDesktop && settings.loaded && localService.initialised && settings.mode === '');

  // One identity (plan decision 5): read the stored sign-in whenever the
  // server changes (settings, or the local instance coming up on its port).
  $effect(() => {
    if (!settings.loaded || firstRun) return;
    const t = shell.identityTarget;
    if (t) void identity.restore(t);
  });

  // Native module webviews paint over the shell page: hide them under the dialog.
  $effect(() => {
    shell.overlay = identity.dialog;
  });

  // Serialise updates so a rapid switch cannot leave the host on an older theme.
  let themeUpdates: Promise<unknown> = Promise.resolve();
  function publishTheme(theme: 'light' | 'dark') {
    themeUpdates = themeUpdates.then(() => invoke('module_theme', { theme }))
      .catch((err) => void logWarn(`[theme] could not publish the theme to the host: ${String(err)}`));
    return themeUpdates;
  }
  $effect(() => {
    if (isDesktop && settings.loaded) void publishTheme(settings.effectiveTheme);
  });

  // Images and Home work without starting the local database processes.
  $effect(() => {
    if (isDesktop && settings.loaded && localService.initialised && !firstRun &&
        settings.mode === 'local' && (shell.view === 'sessions' || shell.view === 'review')) {
      void localService.ensureStarted().catch((err) =>
        logWarn(`[local-service] could not start: ${String(err)}`));
    }
  });

  onMount(async () => {
    await settings.load();
    if (isDesktop) await publishTheme(settings.effectiveTheme);
    startScheduler();
    const last = settings.lastTab as View;
    if (tabs.some((t) => t.id === last)) shell.view = last;
    if (isDesktop) {
      await localService.init();
    }
    await shell.loadModules();
    await listenForLinks();
    if (isDesktop) await listenForMenu();
  });

  // Desktop: the native Tabs menu owns the shortcuts (src-tauri/src/menu.rs),
  // so they work while a module webview has focus.
  async function listenForMenu() {
    const { listen } = await import('@tauri-apps/api/event');
    await listen<string>('shell://menu', (e) => {
      const id = e.payload;
      if (firstRun || identity.dialog) return;
      if (id.startsWith('tab:')) shell.show(id.slice(4) as View);
      else if (id === 'settings') shell.show('settings');
      else if (id === 'module:reload' && (shell.view === 'images' || shell.view === 'sessions')) {
        void desktopModules.reload(shell.view);
      }
    });
  }

  // Web delivery: page-level shortcuts.
  function onKey(e: KeyboardEvent) {
    if (isDesktop || firstRun) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const n = Number(e.key);
    if (n >= 1 && n <= tabs.length) {
      e.preventDefault();
      shell.show(tabs[n - 1].id);
    } else if (e.key === ',') {
      e.preventDefault();
      shell.show('settings');
    }
  }

  // Web delivery: files dropped on the shell page (tab bar, Home, Settings).
  // A drop on a module iframe stays with that module's own drop target.
  // Desktop drops arrive from the host with paths (lib/incoming.ts).
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  function onDragOver(e: DragEvent) {
    if (isDesktop || firstRun || !hasFiles(e)) return;
    e.preventDefault();
    opener.dragging = true;
  }
  function onDragLeave(e: DragEvent) {
    if (!isDesktop && e.relatedTarget === null) opener.dragging = false;
  }
  async function onDrop(e: DragEvent) {
    if (isDesktop || firstRun || !hasFiles(e)) return;
    e.preventDefault();
    opener.dragging = false;
    opener.openWebFiles(await fromDataTransfer(e.dataTransfer!), 'drop');
  }
</script>


<div class="shell">
  <header class="bar glass">
    <span class="brand"><img class="mark" src="./favicon.svg" alt="" width="22" height="22" />UPb Lab</span>
    {#if !firstRun}
    <div class="tabs" role="tablist" aria-label="Modules">
      {#each tabs as t, i (t.id)}
        <button
          role="tab"
          class="tab"
          aria-selected={shell.view === t.id}
          title="{t.hint} (Ctrl/⌘ {i + 1})"
          onclick={() => shell.show(t.id)}>{t.label}</button
        >
      {/each}
    </div>
    <span class="spacer"></span>
    <VersionChip />
    {#if opener.dragging}
      <span class="drop-hint" role="status">Drop to open: images go to Images, Qtegra exports to Sessions</span>
    {/if}
    {#if identity.target}
      <button
        class="tab account"
        class:signed-in={identity.signedIn}
        title={identity.signedIn ? `Signed in to ${identity.target.server}` : `Sign in to ${identity.target.server}`}
        onclick={() => (identity.dialog = true)}
      >
        {#if identity.signedIn}<span class="dot" style="background: {identity.state.offline ? 'var(--warning)' : 'var(--ok)'}"></span>{identity.label}{:else}Sign in{/if}
      </button>
    {/if}
    <button
      class="tab icon"
      aria-label="Settings"
      title="Settings (Ctrl/⌘ ,)"
      aria-pressed={shell.view === 'settings'}
      onclick={() => shell.show(shell.view === 'settings' ? (settings.lastTab as View) : 'settings')}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
        ><path
          fill="currentColor"
          d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"
          transform="translate(-1 0)"
        /></svg
      >
    </button>
    {/if}
  </header>

  <main class="content">
    {#if firstRun}
      <FirstRun />
    {:else if settings.loaded && (settings.mode !== '' || !isDesktop)}
      <Home active={shell.view === 'home'} />
      <Sessions active={shell.view === 'sessions'} />
      <Review active={shell.view === 'review'} imagesOnly={shell.view === 'images'} split={reviewSplit}>
        {#snippet images(active, layoutKey)}
          <Images {active} {layoutKey} />
        {/snippet}
      </Review>
      <Reduce active={shell.view === 'reduce'} />
      <Settings active={shell.view === 'settings'} />
    {/if}
  </main>
  <AccountDialog />
</div>
