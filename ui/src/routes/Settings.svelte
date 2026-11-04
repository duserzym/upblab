<script lang="ts">
  import { normaliseServerUrl } from '../lib/links';
  import { localService } from '../lib/localService.svelte';
  import { isDesktop, localServiceApi, resetWindowLayout, studioStatus, type LocalLogs, type StudioStatus } from '../lib/platform';
  import { DEFAULT_DATA_ROOT, settings, type Mode, type ThemePref } from '../lib/settings.svelte';
  import { shell } from '../lib/shell.svelte';

  let { active }: { active: boolean } = $props();

  let mode = $state<Mode>('server');
  let server = $state('');
  let dataRoot = $state('');
  let devPath = $state('');
  let pgBin = $state('');
  let studio = $state('');
  let checkout = $state('');
  let studioNow = $state<StudioStatus | null>(null);
  let serverError = $state('');
  let saved = $state('');
  let studioSaved = $state('');
  let detected = $state<string | null>(null);
  let logs = $state<LocalLogs | null>(null);

  const status = $derived(localService.status);
  const running = $derived(status?.phase === 'ready' || status?.phase === 'starting');

  // Refresh the forms from the stored values each time the view opens.
  $effect(() => {
    if (!active || !settings.loaded) return;
    mode = settings.mode === 'local' ? 'local' : 'server';
    server = settings.serverUrl;
    dataRoot = settings.dataRoot;
    devPath = settings.devServicePath;
    pgBin = settings.pgBin;
    studio = settings.studioPath;
    checkout = settings.studioCheckout;
    serverError = '';
    saved = '';
    studioSaved = '';
    if (isDesktop) {
      void studioStatus({ path: '', checkout: '' }).then((s) => (detected = s.kind === 'installed' ? s.path : null));
      void studioStatus(shell.studioConfig).then((s) => (studioNow = s));
    }
  });

  const localChanged = $derived(
    settings.mode === 'local' &&
      (dataRoot.trim() !== settings.dataRoot || devPath.trim() !== settings.devServicePath || pgBin.trim() !== settings.pgBin),
  );

  async function saveConnection(e: SubmitEvent) {
    e.preventDefault();
    saved = '';
    if (mode === 'server') {
      const url = normaliseServerUrl(server);
      if (!url) {
        serverError = 'Enter a full http:// or https:// URL, e.g. http://localhost:8000';
        return;
      }
      serverError = '';
      server = url;
      const leavingLocal = settings.mode === 'local';
      await settings.update({ mode: 'server', serverUrl: url });
      if (leavingLocal) await localService.stop().catch(() => {});
      saved = leavingLocal ? 'Saved. The local laicpmsdb was stopped.' : 'Saved.';
      return;
    }
    const restart = settings.mode === 'local' && localChanged && running;
    const entering = settings.mode !== 'local';
    await settings.update({
      mode: 'local',
      dataRoot: dataRoot.trim() || DEFAULT_DATA_ROOT,
      devServicePath: devPath.trim(),
      pgBin: pgBin.trim(),
    });
    if (restart) {
      await localService.restart();
      saved = 'Saved; restarting the local laicpmsdb.';
    } else if (entering || !running) {
      void localService.start();
      saved = 'Saved; starting the local laicpmsdb.';
    } else {
      saved = 'Saved.';
    }
  }

  async function saveStudio(e: SubmitEvent) {
    e.preventDefault();
    await settings.update({ studioPath: studio.trim(), studioCheckout: checkout.trim() });
    studioNow = await studioStatus(shell.studioConfig);
    studioSaved = studioNow.found ? 'Saved.' : 'Saved, but Studio is not found there.';
  }

  async function showLogs() {
    logs = logs ? null : await localServiceApi.logs(200);
  }
  async function resetWindow() {
    await resetWindowLayout().catch((err) => console.warn('[settings] reset layout', err));
  }
  async function refreshLogs() {
    logs = await localServiceApi.logs(200);
  }

  const themes: { value: ThemePref; label: string }[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'System' },
  ];

  const localNote = $derived(
    status?.bundle
      ? `This app includes laicpmsdb ${status.bundle} and PostgreSQL ${status.postgres.version ?? '17'}.`
      : 'This build has no bundled laicpmsdb service yet: "This computer" runs the laicpmsdb checkout below.',
  );
</script>

<section class="view scroll" class:hidden={!active}>
  <div class="page stack narrow">
    <h1>Settings</h1>

    <form class="glass panel stack" onsubmit={saveConnection}>
      <h3>laicpmsdb</h3>
      {#if isDesktop}
        <div class="row" role="radiogroup" aria-label="Where laicpmsdb runs">
          <button type="button" class="chip" role="radio" aria-checked={mode === 'local'} onclick={() => (mode = 'local')}>This computer</button>
          <button type="button" class="chip" role="radio" aria-checked={mode === 'server'} onclick={() => (mode = 'server')}>Lab server</button>
        </div>
      {/if}

      {#if mode === 'server'}
        <label class="field">
          Server URL
          <input type="url" bind:value={server} placeholder="http://localhost:8000" spellcheck="false" required />
          <span class="faint">The Sessions tab opens <code>&lt;server&gt;/app/</code>.</span>
          {#if serverError}<span class="error">{serverError}</span>{/if}
        </label>
      {:else}
        <p class="faint small">{localNote}</p>
        <label class="field">
          Data root
          <input type="text" bind:value={dataRoot} placeholder={DEFAULT_DATA_ROOT} spellcheck="false" />
          <span class="faint">Raw files, attachments and exports. The database is in <code>{status?.dataDir}</code>.</span>
        </label>
        {#if !status?.bundle}
          <label class="field">
            laicpmsdb checkout
            <input type="text" bind:value={devPath} placeholder={status?.devDefault ?? '/path/to/laicpmsdb'} spellcheck="false" />
            <span class="faint">Development fallback: a checkout with <code>make venv</code> and <code>make ui</code> done.{status?.devDefault ? ' Empty uses the one pinned in modules.lock.json.' : ''}</span>
          </label>
        {/if}
        <label class="field">
          PostgreSQL bin folder
          <input type="text" bind:value={pgBin} placeholder="bundled PostgreSQL" spellcheck="false" />
          <span class="faint">Leave empty for the bundled PostgreSQL. Development only: a PostgreSQL 17 <code>bin</code> folder, e.g. <code>/opt/homebrew/opt/postgresql@17/bin</code>. The <code>PG_BIN</code> environment variable wins over this.</span>
        </label>

        {#if status}
          <dl class="grid-kv">
            <dt>State</dt>
            <dd>
              <span class="dot" style="background: {status.phase === 'ready' ? 'var(--ok)' : status.phase === 'failed' ? 'var(--danger)' : 'var(--text-faint)'}"></span>
              {status.phase === 'ready' ? 'running' : status.phase}{status.phase === 'starting' && status.step ? ` · ${status.step}` : ''}
            </dd>
            <dt>PostgreSQL</dt>
            <dd>{status.postgres.running ? `127.0.0.1:${status.postgres.port}` : 'stopped'}{status.postgres.source ? ` · ${status.postgres.source}` : ''}</dd>
            <dt>Service</dt>
            <dd>{status.url ?? (status.service.running ? `127.0.0.1:${status.service.port}` : 'stopped')}{status.service.source ? ` · ${status.service.source === 'dev' ? status.service.path : `bundle ${status.service.version}`}` : ''}</dd>
            {#if status.error}<dt>Error</dt><dd class="error">{status.error}</dd>{/if}
          </dl>
        {/if}
      {/if}

      <div class="row">
        <button class="btn primary" type="submit">Save</button>
        {#if mode === 'local' && settings.mode === 'local'}
          {#if running}
            <button class="btn" type="button" onclick={() => void localService.restart()}>Restart</button>
            <button class="btn" type="button" onclick={() => void localService.stop()}>Stop</button>
          {:else}
            <button class="btn" type="button" onclick={() => void localService.start()}>Start</button>
          {/if}
        {/if}
        {#if isDesktop}
          <button class="btn" type="button" aria-pressed={!!logs} onclick={showLogs}>Logs</button>
        {/if}
        <span class="small ok">{saved}</span>
      </div>

      {#if logs}
        <div class="stack logs">
          <div class="row">
            <span class="faint small">In <code>{logs.dir}</code></span>
            <span class="spacer"></span>
            <button class="btn" type="button" onclick={refreshLogs}>Refresh</button>
            <button class="btn" type="button" onclick={() => void localServiceApi.openLogs()}>Open log folder</button>
          </div>
          <h4>laicpmsdb.log</h4>
          <pre class="log-tail">{logs.service || '(empty)'}</pre>
          <h4>postgres.log</h4>
          <pre class="log-tail">{logs.postgres || '(empty)'}</pre>
        </div>
      {/if}
    </form>

    <form class="glass panel stack" onsubmit={saveStudio}>
      <h3>UPbRPy Studio</h3>
      <label class="field">
        Path
        <input type="text" bind:value={studio} placeholder={detected ?? 'auto-detect'} spellcheck="false" disabled={!isDesktop} />
        <span class="faint">
          {#if !isDesktop}Only used by the desktop app.
          {:else if detected}Leave empty to use the detected <code>{detected}</code>.
          {:else}Not detected in the usual install locations; enter the <code>.app</code> (macOS) or <code>.exe</code> (Windows) path.{/if}
        </span>
      </label>
      <label class="field">
        UPbRPy checkout (development)
        <input type="text" bind:value={checkout} placeholder="/path/to/UPbRPy" spellcheck="false" disabled={!isDesktop} />
        <span class="faint">Used when Studio is not installed: runs <code>python -m GUI --open &lt;link&gt;</code> there, with its <code>.venv</code> Python if it has one.</span>
      </label>
      {#if isDesktop && studioNow}
        <dl class="grid-kv">
          <dt>Status</dt>
          <dd>
            <span class="dot" style="background: {studioNow.found ? 'var(--ok)' : 'var(--warning)'}"></span>
            {studioNow.found ? (studioNow.kind === 'checkout' ? 'development checkout' : 'installed') : `not found${studioNow.error ? `: ${studioNow.error}` : ''}`}
          </dd>
          {#if studioNow.command}<dt>Launch</dt><dd class="mono small">{studioNow.command}</dd>{/if}
        </dl>
      {/if}
      <div class="row">
        <button class="btn primary" type="submit" disabled={!isDesktop}>Save</button>
        <span class="small ok">{studioSaved}</span>
      </div>
    </form>

    <div class="glass panel stack">
      <h3>Appearance and layout</h3>
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
      <p class="faint small">Light unless you choose otherwise; System follows the operating system. Module tabs get it as <code>?theme=</code> when they load, so a change reaches them the next time they open (restart UPb Studio).</p>
      {#if isDesktop}
        <div class="row">
          <button class="btn" onclick={() => void resetWindow()}>Reset layout</button>
          <span class="faint small">The window opens where you left it, fitted to the screen it is on. Reset puts it back to 1280 × 800, centred.</span>
        </div>
      {/if}
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
  .logs h4 { margin: 0; font-size: 0.85rem; color: var(--text-muted); }
</style>
