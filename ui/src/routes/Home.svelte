<script lang="ts">
  import { identity } from '../lib/identity.svelte';
  import { localService } from '../lib/localService.svelte';
  import { overview, type RunOut } from '../lib/overview.svelte';
  import { isDesktop, probe, studioStatus, type StudioStatus } from '../lib/platform';
  import { settings } from '../lib/settings.svelte';
  import { shell } from '../lib/shell.svelte';

  let { active }: { active: boolean } = $props();
  let server = $state<boolean | null>(null);
  let studio = $state<StudioStatus | null>(null);
  let linkInput = $state('');

  // "This computer": state comes from the host's status events.
  const local = $derived(shell.local ? localService.status : null);
  const localOk = $derived(local ? (local.phase === 'ready' ? true : local.phase === 'failed' ? false : null) : null);
  const localLine = $derived.by(() => {
    if (!local) return '';
    if (local.phase === 'ready') return 'running';
    if (local.phase === 'failed') return `failed: ${local.error ?? ''}`;
    if (local.phase === 'starting') return local.step || 'starting…';
    return local.phase;
  });

  $effect(() => {
    if (!active || !settings.loaded) return;
    const url = shell.homeUrl('sessions');
    if (!shell.local) void probe(url).then((r) => (server = r.reachable));
    void studioStatus(shell.studioConfig).then((s) => (studio = s));
  });

  // Sessions, runs and atlases: reload when Home opens or the account changes.
  $effect(() => {
    if (!active || !settings.loaded) return;
    void identity.revision;
    void identity.target?.server;
    if (identity.checking) return;
    void overview.load();
  });

  const go = (url: string) => void shell.handleLink(url, 'home');
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
  const runLabel = (r: RunOut) => `${r.pipeline_name} ${r.pipeline_version}`.trim() + (r.completed_at ? ` · ${day(r.completed_at)}` : ` · ${r.status}`);

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
        <strong>Sessions</strong>, reduction in <strong>Reduce</strong>. Below: your recent sessions with their reductions,
        and the images of your mounts. The cross-module timeline and search arrive in a later phase.
      </p>
    </div>

    <div class="cards">
      {#if shell.local}
        <button class="glass panel card-btn" onclick={() => shell.show('sessions')}>
          <span class="row"><span class="dot" style="background: {color(localOk)}"></span><h3>Sessions · laicpmsdb</h3></span>
          <span class="small">This computer · {localLine}</span>
          <dl class="grid-kv small">
            <dt>PostgreSQL</dt>
            <dd>{local?.postgres.running ? `running on 127.0.0.1:${local.postgres.port}` : 'stopped'}{local?.postgres.source ? ` (${local.postgres.source})` : ''}</dd>
            <dt>Service</dt>
            <dd>{local?.service.running ? `${local.phase === 'ready' ? 'ready' : 'starting'} on 127.0.0.1:${local.service.port}` : 'stopped'}{local?.service.source ? ` (${local.service.source === 'dev' ? 'development checkout' : `bundle ${local.service.version ?? ''}`})` : ''}</dd>
          </dl>
        </button>
      {:else}
        <button class="glass panel card-btn" onclick={() => shell.show('sessions')}>
          <span class="row"><span class="dot" style="background: {color(server)}"></span><h3>Sessions · laicpmsdb</h3></span>
          <span class="muted small mono">{settings.serverUrl}</span>
          <span class="small">{server === null ? 'checking…' : server ? 'server reachable' : 'server unreachable'}</span>
        </button>
      {/if}
      <button class="glass panel card-btn" onclick={() => shell.show('images')}>
        <span class="row"><span class="dot" style="background: {color(shell.atlas ? true : null)}"></span><h3>Images · grainatlas</h3></span>
        <span class="small">{shell.atlas ? `build ${shell.atlas.version} (${shell.atlas.source})` : 'no build pinned yet'}</span>
      </button>
      <button class="glass panel card-btn" onclick={() => shell.show('reduce')}>
        <span class="row"><span class="dot" style="background: {color(isDesktop && studio ? studio.found : null)}"></span><h3>Reduce · UPbRPy Studio</h3></span>
        <span class="small">{!isDesktop ? 'desktop app only' : studio === null ? 'checking…' : studio.found ? (studio.kind === 'checkout' ? 'development checkout' : 'installed') : 'not found'}</span>
        {#if studio?.path}<span class="muted small mono">{studio.path}</span>{/if}
      </button>
    </div>

    <div class="glass panel stack">
      <div class="row">
        <h2>Sessions</h2>
        <span class="spacer"></span>
        {#if overview.state === 'ready'}<span class="faint small">{overview.totalSessions > overview.sessions.length ? `latest ${overview.sessions.length} of ${overview.totalSessions}` : `${overview.totalSessions} session${overview.totalSessions === 1 ? '' : 's'}`}</span>{/if}
        {#if identity.signedIn}<button class="btn" onclick={() => void overview.load()} disabled={overview.state === 'loading'}>Refresh</button>{/if}
      </div>
      {#if overview.state === 'idle' || (overview.state === 'loading' && overview.sessions.length === 0)}
        <p class="faint small">{identity.target ? 'Loading sessions…' : shell.local ? 'Waiting for the local laicpmsdb to start…' : 'No laicpmsdb server configured.'}</p>
      {:else if overview.state === 'signed-out'}
        <div class="row">
          <p class="muted small grow">Sign in to see your sessions, their reductions and the images of your mounts.</p>
          <button class="btn primary" onclick={() => (identity.dialog = true)}>Sign in</button>
        </div>
      {:else if overview.state === 'unreachable'}
        <div class="row"><span class="dot" style="background: var(--danger)"></span><span class="small">laicpmsdb is not answering at <code>{identity.target?.server}</code>.</span></div>
        <p class="faint small mono">{overview.error}</p>
      {:else if overview.state === 'error'}
        <p class="error small">Could not read sessions: {overview.error}</p>
      {:else if overview.sessions.length === 0}
        <p class="muted small">No sessions yet. Upload a laser session in the <button class="linkish" onclick={() => shell.show('sessions')}>Sessions</button> tab.</p>
      {:else}
        <table class="data">
          <thead><tr><th>Session</th><th>Material</th><th>Started</th><th class="num">Spots</th><th>Reductions</th><th></th></tr></thead>
          <tbody>
            {#each overview.sessions as row (row.session.id)}
              <tr>
                <td><button class="linkish mono" onclick={() => go(`laicpmsdb://session/${row.session.id}`)}>{row.session.session_key}</button></td>
                <td class="small">{row.session.material}</td>
                <td class="small">{day(row.session.started_at)}</td>
                <td class="num small">{row.session.acquisition_count}</td>
                <td class="small">
                  {#if row.runs === null}<span class="faint">unknown</span>
                  {:else if row.runs === 0}<span class="faint">not reduced</span>
                  {:else}
                    {row.runs} run{row.runs === 1 ? '' : 's'}
                    {#if row.preferred}<span class="badge" title="Preferred run: {runLabel(row.preferred)}">preferred {runLabel(row.preferred)}</span>
                    {:else}<span class="faint"> · none preferred</span>{/if}
                  {/if}
                </td>
                <td class="actions"><button class="btn" title="Open this session in UPbRPy Studio" onclick={() => go(`upbr://session/${row.session.id}`)}>Reduce</button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    {#if overview.state === 'ready'}
      <div class="glass panel stack">
        <div class="row">
          <h2>Mounts and images</h2>
          <span class="spacer"></span>
          {#if overview.totalMounts > overview.mounts.length}<span class="faint small">first {overview.mounts.length} of {overview.totalMounts}</span>{/if}
        </div>
        {#if overview.mounts.length === 0}
          <p class="muted small">No mounts yet. Mounts are registered in the Sessions tab; grainatlas publishes each mount's images there.</p>
        {:else}
          <table class="data">
            <thead><tr><th>Mount</th><th class="num">Grains</th><th class="num">Spots</th><th>Current atlas</th><th></th></tr></thead>
            <tbody>
              {#each overview.mounts as row (row.mount.id)}
                <tr>
                  <td><button class="linkish" onclick={() => go(`laicpmsdb://mount/${row.mount.id}`)}>{row.mount.label}</button></td>
                  <td class="num small">{row.mount.grain_count}</td>
                  <td class="num small">{row.mount.spot_count}</td>
                  <td class="small">
                    {#if row.atlas === 'error'}<span class="faint">could not be read</span>
                    {:else if row.atlas === null}<span class="faint">none published</span>
                    {:else}{row.atlas.name ?? row.atlas.projectId}{row.atlas.version != null ? ` · v${row.atlas.version}` : ''}{row.atlas.publishedAt ? ` · ${day(row.atlas.publishedAt)}` : ''}{/if}
                  </td>
                  <td class="actions">
                    {#if row.atlas && row.atlas !== 'error'}
                      <button class="btn" onclick={() => go(`grainatlas://project/${(row.atlas as { projectId: string }).projectId}`)}>Open images</button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
        {#if overview.error}<p class="faint small">{overview.error}</p>{/if}
      </div>
    {/if}

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
  .grow { flex: 1; min-width: 12rem; margin: 0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .actions { text-align: right; white-space: nowrap; }
  .linkish { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; font: inherit; text-align: left; }
  .linkish:hover { text-decoration: underline; }
  h2 { margin: 0; }
  .badge { margin-left: var(--space-2); }
  .card-btn .grid-kv { margin: 0; }
  table.data tbody tr { cursor: default; }
</style>
