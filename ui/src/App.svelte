<script lang="ts">
  import { onMount } from 'svelte';
  import Home from './routes/Home.svelte';
  import Images from './routes/Images.svelte';
  import Sessions from './routes/Sessions.svelte';
  import Reduce from './routes/Reduce.svelte';
  import Settings from './routes/Settings.svelte';
  import FirstRun from './components/FirstRun.svelte';
  import { localService } from './lib/localService.svelte';
  import { listenForLinks } from './lib/incoming';
  import { settings } from './lib/settings.svelte';
  import { shell, type View } from './lib/shell.svelte';
  import { desktopModules, isDesktop } from './lib/platform';

  const tabs: { id: View; label: string; hint: string }[] = [
    { id: 'home', label: 'Home', hint: 'Overview and links' },
    { id: 'images', label: 'Images', hint: 'grainatlas' },
    { id: 'sessions', label: 'Sessions', hint: 'laicpmsdb' },
    { id: 'reduce', label: 'Reduce', hint: 'UPbRPy Studio' },
  ];

  // Desktop with no mode stored yet: the first-run wizard (ADR-0003).
  // Waits for the host's status, which says whether "This computer" can run.
  const firstRun = $derived(isDesktop && settings.loaded && localService.initialised && settings.mode === '');

  onMount(async () => {
    await settings.load();
    const last = settings.lastTab as View;
    if (tabs.some((t) => t.id === last)) shell.view = last;
    if (isDesktop) {
      await localService.init();
      // "This computer": start laicpmsdb and PostgreSQL with the app.
      if (settings.mode === 'local') void localService.start();
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
      if (firstRun) return;
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
</script>

<svelte:window onkeydown={onKey} />

<div class="shell">
  <header class="bar glass">
    <span class="brand">UPb Studio</span>
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
      <Images active={shell.view === 'images'} />
      <Sessions active={shell.view === 'sessions'} />
      <Reduce active={shell.view === 'reduce'} />
      <Settings active={shell.view === 'settings'} />
    {/if}
  </main>
</div>
