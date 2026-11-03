<script lang="ts">
  import { untrack } from 'svelte';
  import ModuleSurface from '../components/ModuleSurface.svelte';
  import { probe } from '../lib/platform';
  import { settings } from '../lib/settings.svelte';
  import { shell } from '../lib/shell.svelte';

  let { active }: { active: boolean } = $props();

  type Status = 'checking' | 'reachable' | 'unreachable';
  let status = $state<Status>('checking');
  let error = $state('');
  let checkedAt = $state<Date | null>(null);
  const appUrl = $derived(shell.homeUrl('sessions'));

  async function check(url: string) {
    const r = await probe(url);
    if (url !== appUrl) return; // settings changed meanwhile
    status = r.reachable ? 'reachable' : 'unreachable';
    error = r.error ?? '';
    checkedAt = new Date();
  }

  $effect(() => {
    const url = appUrl;
    if (!active || !settings.loaded) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Retry quickly while down; re-check slowly while up so a stopped server is noticed.
    const loop = async () => {
      await check(url);
      if (!stopped) timer = setTimeout(loop, untrack(() => status) === 'reachable' ? 15000 : 4000);
    };
    untrack(() => {
      if (status !== 'reachable') status = 'checking';
    });
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  });
</script>

<section class="view" class:hidden={!active}>
  {#if status === 'reachable'}
    <ModuleSurface module="sessions" title="laicpmsdb" home={appUrl} target={shell.targets.sessions} {active} />
  {:else}
    <div class="center">
      <div class="glass panel card stack">
        {#if status === 'checking'}
          <h2>Connecting to laicpmsdb…</h2>
          <p class="muted mono">{appUrl}</p>
        {:else}
          <div class="row"><span class="dot" style="background: var(--danger)"></span><h2>laicpmsdb server unreachable</h2></div>
          <p class="muted">
            The Sessions tab shows the laicpmsdb web app from <code>{appUrl}</code>, but nothing answered there.
          </p>
          {#if error}<p class="faint small mono">{error}</p>{/if}
          <ul class="muted small">
            <li>Running laicpmsdb locally? Start it with <code>make dev</code> in the laicpmsdb repository.</li>
            <li>Using the lab server? Check the server URL in Settings and your network or VPN.</li>
          </ul>
          <div class="row">
            <button class="btn primary" onclick={() => void check(appUrl)}>Retry now</button>
            <button class="btn" onclick={() => shell.show('settings')}>Change server URL</button>
            <span class="spacer"></span>
            {#if checkedAt}<span class="faint small">Last checked {checkedAt.toLocaleTimeString()}; retrying every few seconds</span>{/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</section>
