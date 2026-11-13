<script lang="ts">
  import { identity } from '../lib/identity.svelte';
  import { isDesktop, launchStudio, studioStatus, type StudioStatus } from '../lib/platform';
  import { settings } from '../lib/settings.svelte';
  import { shell } from '../lib/shell.svelte';

  let { active }: { active: boolean } = $props();
  let status = $state<StudioStatus | null>(null);
  let message = $state('');
  let copied = $state(false);

  $effect(() => {
    if (!active || !settings.loaded) return;
    const config = shell.studioConfig;
    void studioStatus(config).then((s) => (status = s));
  });

  const request = $derived(shell.studio);

  async function launch() {
    message = '';
    try {
      const command = await launchStudio(shell.studioConfig, null);
      message = `Launched: ${command}`;
    } catch (err) {
      message = `Could not launch: ${err}`;
    }
  }

  function again() {
    const r = request;
    if (r) void shell.handleLink(`upbr://${r.object}/${r.id}`, 'you');
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }

  const plain = $derived(request ? `upbr://${request.object}/${request.id}` : '');
</script>

<section class="view scroll" class:hidden={!active}>
  <div class="page stack">
    {#if request}
      <div class="glass panel stack">
        <h2>{request.object === 'session' ? 'Reduce session' : 'Open reduction run'} <span class="mono small">{request.id}</span></h2>
        {#if request.state === 'launching'}
          <div class="row"><span class="spinner" aria-hidden="true"></span><span>Starting UPbRPy Studio…</span></div>
        {:else if request.state === 'launched'}
          <div class="row"><span class="dot" style="background: var(--ok)"></span><strong>UPbRPy Studio launched</strong></div>
          <p class="muted small">
            Studio opens the {request.object} from laicpmsdb in database mode{request.minted
              ? ', signed in with a one-time code from your UPb Lab sign-in'
              : identity.signedIn
                ? ''
                : '; sign in to UPb Lab first so Studio does not ask you to sign in again'}.
          </p>
          {#if request.command}<pre class="log-tail">{request.command}</pre>{/if}
          {#if request.error}<p class="faint small">Handoff code: {request.error}</p>{/if}
          <div class="row"><button class="btn" onclick={again}>Launch again</button></div>
        {:else if request.state === 'failed'}
          <div class="row"><span class="dot" style="background: var(--danger)"></span><strong>Could not launch UPbRPy Studio</strong></div>
          <p class="error small">{request.error}</p>
          <div class="row">
            <button class="btn primary" onclick={again}>Retry</button>
            <button class="btn" onclick={() => shell.show('settings')}>Studio settings</button>
          </div>
        {:else if request.state === 'web'}
          <p class="muted">Open it in UPbRPy Studio on this computer (Studio's installer registers <code>upbr://</code> links):</p>
          <div class="row">
            <a class="btn primary" href={request.href}>Open in UPbRPy Studio</a>
            {#if request.minted}<span class="faint small">The link carries a one-time sign-in code, valid for five minutes.</span>{/if}
          </div>
        {:else}
          <div class="row"><span class="dot" style="background: var(--warning)"></span><strong>UPbRPy Studio is not installed on this computer</strong></div>
          <ol class="muted small steps">
            <li>Install UPbRPy Studio from its releases: macOS <code>UPbRPy Studio.app</code> into <code>/Applications</code>; Windows the installer, which puts <code>UPbRPy Studio.exe</code> under <code>%LOCALAPPDATA%\Programs\UPbRPy Studio</code>.</li>
            <li>Or set its path in Settings, or, for development, a UPbRPy checkout (run as <code>python -m GUI</code>).</li>
            <li>Then click <strong>Reduce</strong> again. Studio can also open the link itself (File › Open from database):</li>
          </ol>
          <div class="row">
            <code class="mono small link">{plain}</code>
            <button class="btn" onclick={() => copy(`${plain}?server=${encodeURIComponent(identity.target?.server ?? settings.serverUrl)}`)}>{copied ? 'Copied' : 'Copy link'}</button>
            <button class="btn" onclick={() => shell.show('settings')}>Studio settings</button>
            <button class="btn" onclick={again}>Try again</button>
          </div>
          {#if request.error}<p class="faint small">{request.error}</p>{/if}
        {/if}
      </div>
    {/if}

    <div class="glass panel stack">
      <h2>UPbRPy Studio</h2>
      <p class="muted">
        UPbRPy Studio is a native desktop application. UPb Lab launches it rather than embedding it: a session's
        <strong>Reduce</strong> action (Home, or the Sessions tab) opens Studio in database mode; submitted reductions come
        back to laicpmsdb and show on Home and in the Sessions tab.
      </p>
      {#if !isDesktop}
        <p class="muted">Launching Studio needs the UPb Lab desktop app; in the browser the Reduce links open Studio through the system.</p>
      {:else if status === null}
        <p class="faint">Looking for UPbRPy Studio…</p>
      {:else if status.found}
        <dl class="grid-kv">
          <dt>Studio</dt>
          <dd class="mono">{status.path}{status.kind === 'checkout' ? ' (development checkout)' : ''}</dd>
          <dt>Launch</dt>
          <dd class="mono small">{status.command}</dd>
        </dl>
        <div class="row"><button class="btn" onclick={launch}>Launch UPbRPy Studio</button></div>
      {:else}
        <div class="row"><span class="dot" style="background: var(--warning)"></span><strong>Not found</strong><span class="faint small">{status.error}</span></div>
        <div class="row"><button class="btn" onclick={() => shell.show('settings')}>Set Studio path</button></div>
      {/if}
      {#if message}<p class="small mono">{message}</p>{/if}
    </div>
  </div>
</section>

<style>
  dl {min-width:0;overflow-wrap:anywhere;}
  dd {min-width:0;}
  .steps { margin: 0; padding-left: 1.2rem; display: grid; gap: var(--space-1); }
  .link { word-break: break-all; }
  a.btn { text-decoration: none; }
</style>
