<script lang="ts">
  import { isDesktop, probe, studioStatus } from '../lib/platform';
  import { settings } from '../lib/settings.svelte';
  import { shell } from '../lib/shell.svelte';

  let { active }: { active: boolean } = $props();
  let server = $state<boolean | null>(null);
  let studio = $state<boolean | null>(null);
  let linkInput = $state('');

  $effect(() => {
    if (!active || !settings.loaded) return;
    const url = shell.homeUrl('sessions');
    void probe(url).then((r) => (server = r.reachable));
    void studioStatus(settings.studioPath).then((s) => (studio = s.found));
  });

  function openLink(e: SubmitEvent) {
    e.preventDefault();
    if (linkInput.trim()) void shell.handleLink(linkInput.trim(), 'you');
  }

  const color = (ok: boolean | null) => (ok === null ? 'var(--text-faint)' : ok ? 'var(--ok)' : 'var(--danger)');
</script>

<section class="view scroll" class:hidden={!active}>
  <div class="page stack">
    <div class="glass panel stack">
      <h1>UPb Studio</h1>
      <p class="muted">
        One window for the LA-ICP-MS workflow: grain images in <strong>Images</strong>, sessions and data in
        <strong>Sessions</strong>, reduction in <strong>Reduce</strong>. The cross-module timeline and search arrive in a
        later phase.
      </p>
    </div>

    <div class="cards">
      <button class="glass panel card-btn" onclick={() => shell.show('sessions')}>
        <span class="row"><span class="dot" style="background: {color(server)}"></span><h3>Sessions · laicpmsdb</h3></span>
        <span class="muted small mono">{settings.serverUrl}</span>
        <span class="small">{server === null ? 'checking…' : server ? 'server reachable' : 'server unreachable'}</span>
      </button>
      <button class="glass panel card-btn" onclick={() => shell.show('images')}>
        <span class="row"><span class="dot" style="background: {color(shell.atlas ? true : null)}"></span><h3>Images · grainatlas</h3></span>
        <span class="small">{shell.atlas ? `build ${shell.atlas.version} (${shell.atlas.source})` : 'no build pinned yet'}</span>
      </button>
      <button class="glass panel card-btn" onclick={() => shell.show('reduce')}>
        <span class="row"><span class="dot" style="background: {color(isDesktop ? studio : null)}"></span><h3>Reduce · UPbRPy Studio</h3></span>
        <span class="small">{!isDesktop ? 'desktop app only' : studio === null ? 'checking…' : studio ? 'installed' : 'not found'}</span>
      </button>
    </div>

    <div class="glass panel stack">
      <h2>Links</h2>
      <form class="row" onsubmit={openLink}>
        <input
          type="text"
          class="grow mono"
          placeholder="laicpmsdb://acquisition/<id>, grainatlas://project/<id>/spot/<id>, upbr://session/<id>"
          bind:value={linkInput}
          aria-label="Open a link"
        />
        <button class="btn primary" type="submit">Open</button>
      </form>
      {#if shell.links.length === 0}
        <p class="faint small">Links from modules, the OS and this box appear here.</p>
      {:else}
        <table class="data">
          <thead><tr><th>Time</th><th>From</th><th>Link</th><th>Result</th></tr></thead>
          <tbody>
            {#each shell.links as l (l.at.getTime() + l.url)}
              <tr>
                <td class="small">{l.at.toLocaleTimeString()}</td>
                <td class="small">{l.from}</td>
                <td class="mono small">{l.url}</td>
                <td class="small" style:color={l.refused ? 'var(--danger)' : undefined}>{l.refused ? 'refused: ' : ''}{l.outcome}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>
</section>

<style>
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: var(--space-4);
  }
  /* tokens.css spaces stacked panels with `.panel + .panel`; not in a grid. */
  .cards > :global(.panel) { margin-top: 0; }
  .card-btn {
    justify-content: flex-start;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    text-align: left;
    cursor: pointer;
  }
  .card-btn:hover { border-color: var(--accent); }
  .grow { flex: 1; min-width: 12rem; }
  table.data tbody tr { cursor: default; }
</style>
