<script lang="ts">
  import { isDesktop, launchStudio, studioStatus, type StudioStatus } from '../lib/platform';
  import { settings } from '../lib/settings.svelte';
  import { shell } from '../lib/shell.svelte';

  let { active }: { active: boolean } = $props();
  let status = $state<StudioStatus | null>(null);
  let message = $state('');

  $effect(() => {
    if (!active || !settings.loaded) return;
    const configured = settings.studioPath;
    void studioStatus(configured).then((s) => (status = s));
  });

  async function launch(url: string | null) {
    message = '';
    const path = status?.path;
    if (!path) return;
    try {
      await launchStudio(path, url);
      message = url ? `Launched UPbRPy Studio with ${url}` : 'Launched UPbRPy Studio';
    } catch (err) {
      message = `Could not launch: ${err}`;
    }
  }
</script>

<section class="view scroll" class:hidden={!active}>
  <div class="page stack">
    <div class="glass panel stack">
      <h2>Reduce with UPbRPy Studio</h2>
      <p class="muted">
        UPbRPy Studio is a native desktop application. UPb Studio launches it rather than embedding it; reduced results
        come back through laicpmsdb's import and appear in the Sessions tab.
      </p>
      {#if !isDesktop}
        <p class="muted">Launching Studio needs the UPb Studio desktop app. In the browser, open Studio yourself.</p>
      {:else if status === null}
        <p class="faint">Looking for UPbRPy Studio…</p>
      {:else if status.found}
        <dl class="grid-kv">
          <dt>Studio</dt>
          <dd class="mono">{status.path}</dd>
        </dl>
        <div class="row">
          <button class="btn primary" onclick={() => launch(null)}>Launch UPbRPy Studio</button>
          {#if shell.studioRequest}
            <button class="btn" onclick={() => launch(shell.studioRequest!.url)}>Launch with {shell.studioRequest.url}</button>
          {/if}
        </div>
      {:else}
        <div class="row"><span class="dot" style="background: var(--warning)"></span><strong>UPbRPy Studio not found</strong></div>
        <p class="muted small">
          Install UPbRPy Studio (macOS: <code>/Applications/UPbRPy Studio.app</code>; Windows:
          <code>%LOCALAPPDATA%\Programs\UPbRPy Studio\UPbRPy Studio.exe</code>) or set its path in Settings.
        </p>
        <div class="row"><button class="btn" onclick={() => shell.show('settings')}>Set Studio path</button></div>
      {/if}
      {#if message}<p class="small">{message}</p>{/if}
    </div>
    {#if shell.studioRequest}
      <div class="glass panel stack">
        <h3>Requested session</h3>
        <p class="mono small">{shell.studioRequest.url}</p>
        <p class="faint small">Session export hand-off arrives with roadmap phase 4; for now Studio receives the link as its argument.</p>
      </div>
    {/if}
  </div>
</section>
