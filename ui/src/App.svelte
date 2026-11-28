<script lang="ts">
  import IconButton from './components/ui/IconButton.svelte';
  import OutboxStatus from './components/OutboxStatus.svelte';
  import { outbox, currentOutboxScope } from './lib/outbox.svelte';
  import { timsRights } from './lib/tims-rights.svelte';
  import { onMount, untrack } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import Oversight from './components/Oversight.svelte';
  import ViewAsControl from './components/ViewAsControl.svelte';
  import { oversight } from './lib/oversight.svelte';
  import { clearRecords } from './lib/records.svelte';
  import { apps } from './lib/apps.svelte';
  import { savedData } from './lib/saved-data.svelte';
  import Home from './routes/Home.svelte';
  import Account from './routes/Account.svelte';
  import OfflineBanner from './components/OfflineBanner.svelte';
  import { connectivity } from './lib/connectivity.svelte';
  import { review } from './lib/review.svelte';
  import { reviewRefresh } from './lib/review-refresh.svelte';
  import { overview } from './lib/overview.svelte';
  import AtlasViewer from './components/AtlasViewer.svelte';
  import Sessions from './routes/Sessions.svelte';
  import Reduce from './routes/Reduce.svelte';
  import Tims from './routes/Tims.svelte';
  import Review from './routes/Review.svelte';
  import Settings from './routes/Settings.svelte';
  import FirstRun from './components/FirstRun.svelte';
  import CheckUpdatesButton from './components/CheckUpdatesButton.svelte';
  import { startScheduler } from './lib/updater.svelte';
  import { appWatch } from './lib/app-watch.svelte';
  import AccountDialog from './components/AccountDialog.svelte';
  import { identity } from './lib/identity.svelte';
  import { canShowPeopleTab } from './lib/people';
  import { localService } from './lib/localService.svelte';
  import { listenForLinks, publishOversight } from './lib/incoming';
  import { fromDataTransfer } from './lib/drop';
  import { opener } from './lib/opener.svelte';
  import { settings } from './lib/settings.svelte';
  import { shell, type View } from './lib/shell.svelte';
  import { desktopModules, isDesktop, logWarn } from './lib/platform';

  const fixedTabs: { id: View; label: string; hint: string }[] = [
    { id: 'home', label: 'Home', hint: 'Overview and links' },
    { id: 'sessions', label: 'Sessions', hint: 'UPbDB' },
    { id: 'review', label: 'Review', hint: 'Results with their images' },
    { id: 'reduce', label: 'Reduce', hint: 'UPbRPy Studio' },
    { id: 'tims', label: 'TIMS', hint: 'Plucked grains and ID-TIMS chemistry' },
  ];

  // Never carry rights from an old server while the new sign-in is being read.
  const peopleAllowed = $derived(canShowPeopleTab(identity.state) &&
    !!shell.identityTarget && identity.target?.key === shell.identityTarget.key &&
    identity.target?.server === shell.identityTarget.server);
  const tabs = $derived(peopleAllowed
    ? [...fixedTabs, { id: 'people' as const, label: 'People & access', hint: 'Accounts, groups and access (lab staff)' }]
    : fixedTabs);

  $effect(() => {
    if (shell.view === 'people' && !peopleAllowed) shell.show('home');
  });

  const reviewSplit = $derived(shell.view === 'review' && settings.reviewSplit);

  // Desktop with no mode stored yet: the first-run wizard (ADR-0003).
  // Waits for the host's status, which says whether "This computer" can run.
  const firstRun = $derived(isDesktop && settings.loaded && localService.initialised && settings.mode === '');

  // One identity (plan decision 5): read the stored sign-in whenever the
  // server changes (settings, or the local instance coming up on its port).
  $effect(() => {
    if (!settings.loaded || firstRun) return;
    const t = shell.identityTarget;
    if (t) untrack(() => void identity.restore(t));
  });

  $effect(() => { void identity.revision; void identity.target?.server; untrack(() => appWatch.syncSource()); });
  onMount(() => connectivity.start(() => identity.get('/v1/accounts/me'), () => {
    queueMicrotask(() => {
      void overview.load({ force: true });
      if (shell.view === 'review') void review.load({ quiet: true });
    });
  }));
  $effect(() => {
    const scope = currentOutboxScope();
    void identity.revision; void identity.authentication;
    untrack(() => { void outbox.activate(scope); if (scope) void timsRights.load(); });
  });
  $effect(() => { void connectivity.state; void connectivity.offlineCopy; void oversight.viewAs; untrack(() => void outbox.flush()); });
  onMount(() => outbox.subscribe(entry => {
    if (shell.view === 'review') { void review.outboxSaved(entry.objectKey); }
    window.dispatchEvent(new CustomEvent('tims-saved', { detail: { objectKey: entry.objectKey } }));
  }));
  onMount(() => { appWatch.start(); return () => appWatch.clear(); });

  // Home and Account use the same session inventory, scoped to the active sign-in.
  $effect(() => {
    if ((shell.view !== 'home' && shell.view !== 'account') || !settings.loaded) return;
    void identity.revision;
    void identity.target?.server;
    JSON.stringify(oversight.filters);
    if (identity.checking) return;
    untrack(() => void overview.load());
  });

  // Clear old scope immediately, even if its tab is hidden. Late replies are rejected by identity.
  $effect.pre(() => {
    void identity.revision; void identity.target?.server;
    untrack(() => { overview.clear(); review.clear(); clearRecords(); savedData.reset(); shell.studio = null; shell.targets.images = null; shell.targets.sessions = null; shell.targets.people = null; apps.atlas = null; apps.studio = null; });
  });
  let oversightUpdates: Promise<unknown> = Promise.resolve();
  $effect(() => {
    const state = { viewAs: oversight.viewAs ? { ...oversight.viewAs } : null, onBehalf: oversight.onBehalf };
    publishOversight();
    if (isDesktop) oversightUpdates = oversightUpdates.then(() => invoke('module_oversight', { oversight: state }))
      .catch(err => logWarn(`[oversight] ${String(err)}`));
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

  // Home works without starting the local database processes.
  $effect(() => {
    if (isDesktop && settings.loaded && localService.initialised && !firstRun &&
        settings.mode === 'local' && (shell.view === 'sessions' || shell.view === 'review' || shell.view === 'people')) {
      void localService.ensureStarted().catch((err) =>
        logWarn(`[local-service] could not start: ${String(err)}`));
    }
  });

  onMount(async () => {
    await settings.load();
    if (isDesktop) await publishTheme(settings.effectiveTheme);
    startScheduler();
    const last = settings.lastTab as View;
    if (fixedTabs.some((t) => t.id === last)) shell.view = last;
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
      if (id === 'shell:close') { closeCurrent(); return; }
      if (firstRun || identity.dialog) return;
      if (id.startsWith('tab:')) shell.show(id.slice(4) as View);
      else if (id === 'settings') shell.show('settings');
      else if (id === 'module:reload' && (shell.view === 'sessions' || shell.view === 'people')) {
        void desktopModules.reload(shell.view);
      } else if (id === 'module:reload' && shell.view === 'review') {
        void reviewRefresh.refresh();
      }
    });
  }

  // Cmd+W (native menu, src-tauri/src/menu.rs): close what is open, never the window.
  // The sign-in dialog, then Settings or Account (back to the last tab), else an
  // open menu or popover through Escape. With nothing open it does nothing.
  function closeCurrent() {
    if (firstRun) return;
    if (identity.dialog) { identity.dialog = false; return; }
    if (shell.view === 'settings' || shell.view === 'account') {
      shell.show(fixedTabs.find(t => t.id === settings.lastTab)?.id ?? 'home');
      return;
    }
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  }

  // Web delivery: page-level shortcuts.
  function onKey(e: KeyboardEvent) {
    if (isDesktop || firstRun) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const n = Number(e.key);
    if (n >= 1 && n <= fixedTabs.length) {
      e.preventDefault();
      shell.show(fixedTabs[n - 1].id);
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
    void opener.openWebFiles(await fromDataTransfer(e.dataTransfer!), 'drop');
  }
</script>

<svelte:window ononline={() => { void connectivity.retryNow(); void outbox.flush(); }} onfocus={() => { void appWatch.check(); void outbox.flush(); }} />
<svelte:document onvisibilitychange={() => { appWatch.visibilityChanged(); }} />
<div class="shell">
  <header class="bar glass">
    <span class="brand"><img class="mark" src="./brand-22.png" srcset="./brand-44.png 2x, ./brand-66.png 3x" alt="" width="22" height="22" />UPb Lab</span>
    {#if !firstRun}
    <div class="tabs" role="tablist" aria-label="Modules">
      {#each tabs as t, i (t.id)}
        <button
          role="tab"
          class="tab"
          aria-selected={shell.view === t.id}
          title={i < fixedTabs.length ? `${t.hint} (Ctrl/⌘ ${i + 1})` : t.hint}
          onclick={() => shell.show(t.id)}>{t.label}</button
        >
      {/each}
    </div>
    <span class="spacer"></span>
    <ViewAsControl />
    <CheckUpdatesButton />
    {#if opener.dragging}
      <span class="drop-hint" role="status">Drop to open: images go to grainatlas, Qtegra exports to Sessions</span>
    {/if}
    {#if identity.target}
      <button
        class="tab account"
        class:signed-in={identity.signedIn}
        aria-pressed={identity.signedIn ? shell.view === 'account' : undefined}
        title={identity.signedIn ? 'Open your account' : `Sign in to ${identity.target.server}`}
        onclick={() => identity.signedIn ? shell.show('account') : (identity.dialog = true)}
      >
        {#if identity.signedIn}<span class="dot" style="background: {connectivity.state === 'offline' || connectivity.state === 'server-error' ? 'var(--warning)' : 'var(--ok)'}"></span><span class="account-name" title={identity.label}>{identity.label}</span>{:else}Sign in{/if}
      </button>
    {/if}
    <IconButton icon="settings" label="Settings" title="Settings (Ctrl/⌘ ,)" aria-pressed={shell.view === 'settings'}
      onclick={() => shell.show(shell.view === 'settings' ? (fixedTabs.find(t => t.id === settings.lastTab)?.id ?? 'home') : 'settings')} />
    {/if}
  </header>

  <Oversight />
  <OfflineBanner />
  {#key JSON.stringify([identity.target?.server, identity.account?.id, identity.revision])}<OutboxStatus />{/key}
  <main class="content">
    {#if firstRun}
      <FirstRun />
    {:else if settings.loaded && (settings.mode !== '' || !isDesktop)}
      <Home active={shell.view === 'home'} />
      <Sessions active={shell.view === 'sessions'} />
      {#if peopleAllowed}
        <Sessions module="people" title="People & access" active={shell.view === 'people'}
          unreachable="The People & access tab shows UPbDB’s accounts, groups and access page from" />
      {/if}
      <Review active={shell.view === 'review'} split={reviewSplit}>
        {#snippet images(active, layoutKey)}
          <AtlasViewer {active} {layoutKey} />
        {/snippet}
      </Review>
      <Tims active={shell.view === 'tims'} />
      <Reduce active={shell.view === 'reduce'} />
      <Settings active={shell.view === 'settings'} />
      {#if shell.view === 'account'}<Account />{/if}
    {/if}
  </main>
  <AccountDialog />
</div>
