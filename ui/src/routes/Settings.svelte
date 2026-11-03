<script lang="ts">
  import { normaliseServerUrl } from '../lib/links';
  import { isDesktop, studioStatus } from '../lib/platform';
  import { settings, type ThemePref } from '../lib/settings.svelte';
  import { shell } from '../lib/shell.svelte';

  let { active }: { active: boolean } = $props();

  let server = $state('');
  let studio = $state('');
  let serverError = $state('');
  let saved = $state('');
  let detected = $state<string | null>(null);

  // Refresh the form from the stored values each time the view opens.
  $effect(() => {
    if (!active || !settings.loaded) return;
    server = settings.serverUrl;
    studio = settings.studioPath;
    serverError = '';
    saved = '';
    if (isDesktop) void studioStatus('').then((s) => (detected = s.path));
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    const url = normaliseServerUrl(server);
    if (!url) {
      serverError = 'Enter a full http:// or https:// URL, e.g. http://localhost:8000';
      return;
    }
    serverError = '';
    server = url;
    await settings.update({ serverUrl: url, studioPath: studio.trim() });
    saved = 'Saved.';
  }

  const themes: { value: ThemePref; label: string }[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'System' },
  ];
</script>

<section class="view scroll" class:hidden={!active}>
  <div class="page stack narrow">
    <h1>Settings</h1>
    <form class="glass panel stack" onsubmit={save}>
      <label class="field">
        laicpmsdb server URL
        <input type="url" bind:value={server} placeholder="http://localhost:8000" spellcheck="false" required />
        <span class="faint">The Sessions tab opens <code>&lt;server&gt;/app/</code>.</span>
        {#if serverError}<span class="error">{serverError}</span>{/if}
      </label>
      <label class="field">
        UPbRPy Studio path
        <input type="text" bind:value={studio} placeholder={detected ?? 'auto-detect'} spellcheck="false" disabled={!isDesktop} />
        <span class="faint">
          {#if !isDesktop}Only used by the desktop app.
          {:else if detected}Leave empty to use the detected <code>{detected}</code>.
          {:else}Not detected in the usual install locations; enter the <code>.app</code> (macOS) or <code>.exe</code> (Windows) path.{/if}
        </span>
      </label>
      <div class="row">
        <button class="btn primary" type="submit">Save</button>
        <span class="small ok">{saved}</span>
      </div>
    </form>

    <div class="glass panel stack">
      <h3>Theme</h3>
      <div class="row" role="radiogroup" aria-label="Theme">
        {#each themes as t (t.value)}
          <button
            class="chip"
            role="radio"
            aria-checked={settings.theme === t.value}
            onclick={() => settings.update({ theme: t.value })}>{t.label}</button
          >
        {/each}
      </div>
      <p class="faint small">The shell's own pages follow this; module tabs keep their own theme settings for now.</p>
    </div>

    <div class="glass panel stack">
      <h3>Modules</h3>
      {#if shell.modules.length === 0}
        <p class="muted small">No module builds bundled. <code>make fetch-modules</code> installs the builds pinned in <code>modules.lock.json</code>.</p>
      {:else}
        <table class="data">
          <thead><tr><th>Module</th><th>Version</th><th>Source</th><th>SHA-256</th></tr></thead>
          <tbody>
            {#each shell.modules as m (m.name)}
              <tr><td>{m.name}</td><td>{m.version}</td><td>{m.source}</td><td class="mono small">{m.sha256.slice(0, 16)}…</td></tr>
            {/each}
          </tbody>
        </table>
      {/if}
      <p class="faint small">Delivery: {isDesktop ? 'desktop (Tauri)' : 'web'}.</p>
    </div>
  </div>
</section>

<style>
  .narrow { max-width: 760px; }
  .ok { color: var(--ok); }
  table.data tbody tr { cursor: default; }
</style>
