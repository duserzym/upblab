<script lang="ts">
  import { untrack } from 'svelte';
  import { localService } from '../lib/localService.svelte';
  import { isDesktop, openExternal } from '../lib/platform';
  import { settings } from '../lib/settings.svelte';
  import { shell } from '../lib/shell.svelte';
  import { check, checkStandards, download, install, updater, updatePreview } from '../lib/updater.svelte';
  import { friendlyUpdateError, RELEASES_PAGE } from '../lib/updates';
  import { collectVersions, type BuildVersions } from '../lib/versions';

  const standardsPage = 'https://github.com/duserzym/upb-standards';
  let versions = $state<BuildVersions | null>(null);
  const status = $derived(updater.status);
  const info = $derived('info' in status ? status.info : null);
  const busy = $derived(['checking', 'downloading', 'installing'].includes(status.kind));
  const line = $derived(
    status.kind === 'checking' ? 'Checking for updates…'
      : status.kind === 'none' ? `You're up to date · checked ${new Date(status.checkedAt).toLocaleTimeString()}`
      : status.kind === 'available' ? `Version ${status.info.version} is available`
      : status.kind === 'downloading' ? `Downloading ${status.info.version}${status.pct === null ? '…' : ` · ${status.pct}%`}`
      : status.kind === 'ready' ? `Version ${status.info.version} is ready to install`
      : status.kind === 'installing' ? 'Installing and restarting…'
      : status.kind === 'error' ? friendlyUpdateError(status.message)
      : status.kind === 'unsupported' ? `${status.reason}${status.info ? ` Version ${status.info.version} is available.` : ''}`
      : 'Checks run automatically in the background.',
  );
  $effect(() => {
    if (!settings.loaded || shell.view !== 'settings') return;
    // Refresh when the service or Studio configuration changes, without changing either.
    void localService.status;
    void shell.studioConfig;
    let cancelled = false;
    untrack(() => { void collectVersions().then((result) => { if (!cancelled) versions = result; }); });
    return () => { cancelled = true; };
  });
</script>

<strong>UPb Lab v{versions?.shell ?? updater.version}</strong>
<p class="small muted" role="status">{line}</p>
<div class="row">
  <button class="btn" disabled={busy || !isDesktop && !updatePreview} onclick={() => void check(true)}>Check now</button>
  {#if status.kind === 'available' && !settings.updateAuto}<button class="btn" onclick={() => void download()}>Download</button>{/if}
  {#if status.kind === 'ready'}<button class="btn primary" onclick={() => void install()}>Restart to update</button>{/if}
  {#if status.kind === 'unsupported' && status.info}<button class="btn" onclick={() => void openExternal(RELEASES_PAGE)}>Open download page</button>{/if}
</div>
<label class="row small">
  <input type="checkbox" checked={settings.updateAuto} onchange={(e) => { void settings.update({ updateAuto: e.currentTarget.checked }); if (e.currentTarget.checked) void download(); }} />
  Download updates automatically
</label>
<label class="row small">
  Channel
  <select value={settings.updateChannel} disabled={busy} onchange={(e) => { void settings.update({ updateChannel: e.currentTarget.value === 'beta' ? 'beta' : 'stable' }); void check(true); }}>
    <option value="stable">Stable</option>
    <option value="beta">Beta (pre-releases)</option>
  </select>
</label>
<p class="faint small">Last check: {settings.updateLastCheck ? new Date(settings.updateLastCheck).toLocaleString() : 'Never'}{updater.lastResult ? ` · ${updater.lastResult}` : ''}</p>
{#if info?.notes}<pre class="notes small">{info.notes}</pre>{/if}
<a href={RELEASES_PAGE} target="_blank" rel="noreferrer" onclick={(e) => { if (isDesktop) { e.preventDefault(); void openExternal(RELEASES_PAGE); } }}>Release notes on GitHub</a>
{#if isDesktop}
  <h4>UPb Standards</h4>
  <p class="small" role="status">{updater.standardsChecking ? 'Checking standards…' : updater.standards.message}</p>
  {#if updater.standards.changed.length}
    <details class="small">
      <summary>Changed TOML files</summary>
      <ul>{#each updater.standards.changed as file (file)}<li>{file}</li>{/each}</ul>
    </details>
  {/if}
  <div class="row">
    <button class="btn" disabled={updater.standardsChecking || !!updatePreview} onclick={() => void checkStandards()}>Check standards</button>
    <a href={standardsPage} onclick={(e) => { e.preventDefault(); void openExternal(standardsPage); }}>Standards on GitHub</a>
  </div>
{/if}
<h4>In this build</h4>
<table class="data" aria-label="In this build">
  <tbody>
    {#each versions?.modules ?? [] as module (module.name)}
      <tr><th scope="row">{module.name}</th><td>{module.version} ({module.source === 'release' ? 'release' : 'local build'}{module.commit ? ` of ${module.commit.slice(0, 7)}${module.dirty ? ' with uncommitted changes' : ''}` : ''})</td></tr>
    {/each}
    {#if !versions?.modules.some((m) => m.name === 'grainatlas')}<tr><th scope="row">grainatlas</th><td>not bundled</td></tr>{/if}
    <tr><th scope="row">laicpmsdb service</th><td>{versions?.service ?? 'not bundled'}</td></tr>
    <tr><th scope="row">PostgreSQL</th><td>{versions?.postgres ?? 'not available'}</td></tr>
    <tr><th scope="row">UPbRPy Studio</th><td>{versions?.studio.found ? `${versions.studio.kind ?? 'installed'} · ${versions.studio.path ?? ''}` : 'not found'}</td></tr>
  </tbody>
</table>
<p class="faint small">Modules update with UPb Lab; UPbRPy Studio updates itself from its own Settings.</p>

<style>
  p, h4 { margin: 0; }
  .notes { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; overflow: auto; line-height: 1.4; max-height: 16.8em; }
  table.data th { position: static; text-transform: none; letter-spacing: normal; }
  table.data td { overflow-wrap: anywhere; }
</style>
