<script lang="ts">
  import UploadCard from '../components/UploadCard.svelte';
  import { upload } from '../lib/upload.svelte';
  import { identity } from '../lib/identity.svelte';
  import { localService } from '../lib/localService.svelte';
  import Toolbar from '../components/home/Toolbar.svelte';
  import Icon from '../components/home/Icon.svelte';
  import SessionCard from '../components/home/SessionCard.svelte';
  import MineralIcon from '../components/home/MineralIcon.svelte';
  import MountCard from '../components/home/MountCard.svelte';
  import { sessionsShown, sessionsByMineral, mountsShown, spotKinds, kindColor, type Sort } from '../lib/home';
  import { overview } from '../lib/overview.svelte';
  import { isDesktop, pickPaths, probe, studioStatus, type StudioStatus } from '../lib/platform';
  import { fromFileList } from '../lib/drop';
  import { opener } from '../lib/opener.svelte';
  import { settings } from '../lib/settings.svelte';
  import { review } from '../lib/review.svelte';
  import { shell } from '../lib/shell.svelte';

  let { active }: { active: boolean } = $props();
  let server = $state<boolean | null>(null);
  let studio = $state<StudioStatus | null>(null);
  let linkInput = $state('');
  let folderInput = $state<HTMLInputElement>();
  let filesInput = $state<HTMLInputElement>();
  let expandedUpload = $state<'sessions' | 'images' | null>(null);
  const uploadCards = $state<Record<'sessions' | 'images', UploadCard | undefined>>({ sessions: undefined, images: undefined });
  // One click: the tile starts the upload itself (picker or web file input) and its card shows the progress.
  function startUpload(which: 'sessions' | 'images') {
    expandedUpload = which;
    void uploadCards[which]?.choose();
  }
  let sessionQuery = $state(''), mountQuery = $state(''), atlasQuery = $state('');
  let sessionSort = $state<Sort>('newest'), mountSort = $state<Sort>('newest'), atlasSort = $state<Sort>('newest');
  const sessions = $derived(sessionsShown(overview.sessions, sessionQuery, sessionSort));
  let groupSessions = $state(false);
  const mineralGroups = $derived(groupSessions ? sessionsByMineral(sessions) : []);
  const mounts = $derived(mountsShown(overview.mounts, mountQuery, mountSort));
  const atlases = $derived(mountsShown(overview.mounts, atlasQuery, atlasSort, true));
  const atlasCount = $derived(overview.mounts.filter(r => r.atlas && r.atlas !== 'error').length);
  const maximum = $derived(Math.max(0, ...sessions.map(r => r.session.acquisition_count)));
  const showAll = () => void overview.load(true);
  const refresh = () => void overview.load();

  // Open anything (ux-conventions rule 4): one folder or any files; the shell
  // decides which tab reads them. Two buttons only because OS dialogs pick
  // either folders or files, never both.
  async function openDialog(folder: boolean) {
    if (!isDesktop) return (folder ? folderInput : filesInput)?.click();
    const paths = await pickPaths(folder).catch(() => [] as string[]);
    if (paths.length) void opener.openPaths(paths, 'open dialog');
  }
  function chosen(input: HTMLInputElement | undefined) {
    if (!input?.files?.length) return;
    opener.openWebFiles(fromFileList(input.files), 'open dialog');
    input.value = '';
  }
  const openColor = (s: string) => (s === 'refused' || s === 'failed' ? 'var(--danger)' : s === 'taken' ? 'var(--ok)' : 'var(--text-faint)');

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

  $effect(() => {
    void identity.revision;
    void identity.target?.server;
    upload.sessions.syncIdentity();
    upload.images.syncIdentity();
    if (active) void upload.sessions.refreshReview();
  });

  function openLink(e: SubmitEvent) {
    e.preventDefault();
    if (linkInput.trim()) void shell.handleLink(linkInput.trim(), 'you');
  }

  const color = (ok: boolean | null) => (ok === null ? 'var(--text-faint)' : ok ? 'var(--ok)' : 'var(--danger)');

  // The three parts of the pipeline, as one line in the header: where each tab gets its
  // data or program, and whether it answers. The pill says the short state; the tooltip and
  // the accessible name say all of it. A click opens the tab, which explains a problem.
  type Pill = { tab: 'sessions' | 'images' | 'reduce'; name: string; module: string; ok: boolean | null; state: string; detail: string };
  const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const pills = $derived.by((): Pill[] => {
    const sessionsPill: Pill = shell.local
      ? {
          tab: 'sessions', name: 'Sessions', module: 'laicpmsdb', ok: localOk,
          state: local?.phase === 'ready' ? 'This computer' : `This computer · ${localLine}`,
          detail: [
            `PostgreSQL ${local?.postgres.running ? `running on 127.0.0.1:${local.postgres.port}` : 'stopped'}${local?.postgres.source ? ` (${local.postgres.source})` : ''}`,
            `Service ${local?.service.running ? `${local.phase === 'ready' ? 'ready' : 'starting'} on 127.0.0.1:${local.service.port}` : 'stopped'}${local?.service.source ? ` (${local.service.source === 'dev' ? 'development checkout' : `bundle ${local.service.version ?? ''}`})` : ''}`,
          ].join(' · '),
        }
      : {
          tab: 'sessions', name: 'Sessions', module: 'laicpmsdb', ok: server,
          state: server === false ? `${host(settings.serverUrl)} unreachable` : host(settings.serverUrl) || 'no server',
          detail: `${settings.serverUrl} · ${server === null ? 'checking…' : server ? 'server reachable' : 'server unreachable'}`,
        };
    const studioState = !isDesktop ? 'desktop app only' : studio === null ? 'checking…' : studio.found ? (studio.kind === 'checkout' ? 'development checkout' : 'installed') : 'not found';
    return [
      sessionsPill,
      {
        tab: 'images', name: 'Images', module: 'grainatlas', ok: shell.atlas ? true : null,
        state: shell.atlas ? `build ${shell.atlas.version}` : 'no build pinned yet',
        detail: shell.atlas ? `build ${shell.atlas.version} (${shell.atlas.source})` : 'no build pinned yet',
      },
      {
        tab: 'reduce', name: 'Reduce', module: 'UPbRPy Studio', ok: isDesktop && studio ? studio.found : null,
        state: studioState, detail: [studioState, studio?.path].filter(Boolean).join(' · '),
      },
    ];
  });
</script>

<section class="view scroll" class:hidden={!active}>
  <div class="page stack board">
    <header class="intro">
      <h1>UPb Lab</h1>
      <p class="muted small hint">Drop a folder or files anywhere in this window, or start below.</p>
      <div class="pills" role="group" aria-label="Pipeline status" data-testid="status-pills">
        {#each pills as p (p.tab)}
          <button class="pill" class:problem={p.ok === false} title={`${p.name} · ${p.module}: ${p.detail}`} aria-label={`${p.name} · ${p.module}: ${p.detail}`} onclick={() => shell.show(p.tab)}>
            <span class="dot" style="background: {color(p.ok)}"></span><strong>{p.name}</strong><span class="state">{p.state}</span>
          </button>
        {/each}
      </div>
    </header>

    <div class="action-tiles" data-testid="open-panel">
      <button class="glass panel action-tile" aria-label="Open folder…" onclick={() => void openDialog(true)}><Icon kind="folder" /><span><strong>Open folder</strong><small>Open a package or export folder</small></span></button>
      <button class="glass panel action-tile" aria-label="Open files…" onclick={() => void openDialog(false)}><Icon kind="files" /><span><strong>Open files</strong><small>Open images or session CSVs</small></span></button>
      <button class="glass panel action-tile" aria-label="Upload LA-ICP-MS session…" aria-controls="home-upload-sessions" onclick={() => startUpload('sessions')}><Icon kind="session" /><span><strong>Upload LA-ICP-MS session</strong><small>Import a session, then Review</small></span></button>
      <button class="glass panel action-tile" aria-label="Upload image set…" aria-controls="home-upload-images" onclick={() => startUpload('images')}><Icon kind="images" /><span><strong>Upload image set</strong><small>Publish mount images, then Review</small></span></button>
    </div>
    <!-- Both cards stay mounted (their web file inputs must exist for the tile's click); a card shows while it is in use. -->
    {#each ['sessions', 'images'] as const as which (which)}
      {@const card = which === 'sessions' ? upload.sessions : upload.images}
      <div id="home-upload-{which}" class="glass panel stack upload-expansion" data-testid="upload-panel-{which}" hidden={!(expandedUpload === which || card.open || card.error)}>
        <div class="row"><h2>{which === 'sessions' ? 'Session upload' : 'Image set upload'}</h2><span class="spacer"></span><button class="btn small" aria-label="Close {which === 'sessions' ? 'session' : 'image set'} upload panel" onclick={() => { expandedUpload = null; card.close(); card.error = ''; }}>Close</button></div>
        <UploadCard {card} showChoose={false} bind:this={uploadCards[which]} />
      </div>
    {/each}
    {#if opener.status}
      <p class="small open-status" role="status">
        <span class="dot" style="background: {openColor(opener.status.state)}"></span>
        <span class="mono">{opener.status.what}</span>: {opener.status.outcome}
      </p>
    {/if}
    {#if !isDesktop}
      <input bind:this={folderInput} aria-label="Open folder" type="file" webkitdirectory multiple hidden onchange={() => chosen(folderInput)} />
      <input bind:this={filesInput} aria-label="Open files" type="file" multiple hidden onchange={() => chosen(filesInput)} />
    {/if}

    <section class="board-section stack" aria-label="Sessions">
      <Toolbar section="Sessions" bind:query={sessionQuery} bind:sort={sessionSort} count={sessions.length} total={overview.totalSessions} loaded={overview.sessions.length} refresh={identity.signedIn ? refresh : undefined} showAll={overview.sessions.length < overview.totalSessions ? showAll : undefined} busy={overview.refreshing}>
        {#snippet options()}
          <button class="btn small group-button" aria-pressed={groupSessions} onclick={() => groupSessions = !groupSessions}>Group by mineral</button>
        {/snippet}
      </Toolbar>
      {#if overview.state === 'idle' || (overview.state === 'loading' && overview.sessions.length === 0)}
        <p class="faint small">{identity.target ? 'Loading sessions…' : shell.local ? 'Open Sessions or Review to start the local database.' : 'No laicpmsdb server configured.'}</p>
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
        {#if sessions.length}
          <div class="row spot-key small muted" aria-label="Spot bar legend">
            <strong>Spot mix</strong>
            {#each spotKinds as [kind, label] (kind)}
              <span><i style:background={kindColor(kind)} aria-hidden="true"></i>{label}</span>
            {/each}
            <span class="faint">Bar length relative to the largest shown session</span>
          </div>
          <div class="stack session-groups" data-testid="session-grid">
            {#if groupSessions}
              {#each mineralGroups as [mineral, rows] (mineral)}
                <section class="stack mineral-group" aria-label={mineral}>
                  <h3 class="row"><MineralIcon {mineral} /><span>{mineral}</span><span class="muted small">{rows.length}</span></h3>
                  <div class="tile-grid">
                    {#each rows as row (row.session.id)}<SessionCard {row} {maximum} />{/each}
                  </div>
                </section>
              {/each}
            {:else}
              <div class="tile-grid">
                {#each sessions as row (row.session.id)}<SessionCard {row} {maximum} />{/each}
              </div>
            {/if}
          </div>
        {:else}
          <p class="muted small">No sessions match this search.</p>
        {/if}
      {/if}
    </section>

    {#if overview.state === 'ready'}
      <section class="board-section stack" aria-label="Mounts">
        <Toolbar section="Mounts" bind:query={mountQuery} bind:sort={mountSort} count={mounts.length} total={overview.totalMounts} loaded={overview.mounts.length} refresh={refresh} showAll={overview.mounts.length < overview.totalMounts ? showAll : undefined} busy={overview.refreshing} />
        {#if overview.mounts.length === 0}
          <p class="muted small">No mounts yet. Register mounts in Sessions; publish their images from grainatlas.</p>
        {:else}
          <div class="tile-grid" data-testid="mount-grid" role="group" aria-label="Mount cards">
            {#each mounts as row (row.mount.id)}<MountCard {row} />{/each}
          </div>
          {#if mounts.length === 0}<p class="muted small">No mounts match this search.</p>{/if}
        {/if}
        {#if overview.error}<p class="faint small">{overview.error}</p>{/if}
      </section>
      <section class="board-section stack" aria-label="Atlases">
        <Toolbar section="Atlases" bind:query={atlasQuery} bind:sort={atlasSort} count={atlases.length} total={atlasCount} loaded={overview.mounts.length} refresh={refresh} showAll={overview.mounts.length < overview.totalMounts ? showAll : undefined} busy={overview.refreshing} />
        {#if overview.mounts.length < overview.totalMounts}<p class="faint small">Atlases of the latest {overview.mounts.length} loaded mounts; Show all to search all {overview.totalMounts} mounts.</p>{/if}
        <div class="tile-grid" data-testid="atlas-grid">
          {#each atlases as row (row.mount.id)}<MountCard {row} atlasOnly />{/each}
        </div>
        {#if atlases.length === 0}<p class="muted small">{atlasCount ? 'No atlases match this search.' : 'No published atlases in the loaded mounts.'}</p>{/if}
      </section>
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
  .board { width: 100%; max-width: none; gap: var(--space-2); padding: var(--space-3) var(--space-4) var(--space-6); }
  .intro { display: flex; align-items: center; gap: var(--space-1) var(--space-3); flex-wrap: wrap; min-width: 0; }
  h1 { font-size: 1.25rem; }
  .hint { flex: 1 1 12rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pills { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-2); margin-left: auto; min-width: 0; }
  .pill { display: inline-flex; align-items: center; gap: var(--space-1); max-width: 100%; min-width: 0; padding: 0.15rem var(--space-3) 0.15rem var(--space-2); border-radius: 999px; border: 1px solid var(--glass-edge); background: var(--glass); color: var(--text); font-size: 0.8rem; cursor: pointer; }
  .pill:hover { border-color: var(--accent); }
  .pill .dot { width: 0.5rem; height: 0.5rem; }
  .pill .state { color: var(--text-muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 16rem; }
  .pill.problem { border-color: color-mix(in srgb, var(--danger) 45%, transparent); }
  .pill.problem .state { color: var(--danger); }
  p { margin: 0; }
  .action-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-2); }
  .action-tile { display: flex; gap: var(--space-3); align-items: center; text-align: left; padding: var(--space-3); min-width: 0; cursor: pointer; color: var(--text); }
  .action-tile:hover { border-color: var(--accent); background: var(--accent-soft); }
  .action-tile span { min-width: 0; }
  .action-tile strong { display: block; font-size: 0.88rem; }
  .action-tile small { display: block; font-size: 0.74rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .action-tiles > :global(.panel) { margin-top: 0; }
  .board-section { min-width: 0; gap: var(--space-2); }
  /* The 22.3rem minimum fits four cards in Home's real 1440px content box,
     three at 1280px and two at 1024px, including the tab's scrollbar. */
  .upload-expansion[hidden] { display: none; }
  .tile-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(22.3rem, 100%), 1fr)); gap: var(--space-2); min-width: 0; }
  .tile-grid > :global(.panel) { margin-top: 0; }
  .group-button[aria-pressed='true'] { color: var(--accent); background: var(--accent-soft); border-color: var(--accent); }
  .spot-key { flex-wrap: wrap; gap: var(--space-1) var(--space-3); }
  .spot-key span { display: inline-flex; align-items: center; gap: var(--space-1); }
  .spot-key i { width: 0.65rem; height: 0.45rem; border-radius: 2px; }
  .session-groups, .mineral-group { gap: var(--space-2); }
  .mineral-group h3 { margin: 0; gap: var(--space-1); text-transform: capitalize; }
  .grow { flex: 1; min-width: 0; margin: 0; }
  .linkish { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; font: inherit; text-align: left; }
  .linkish:hover { text-decoration: underline; }
  .open-status { display: flex; gap: var(--space-2); align-items: baseline; min-width: 0; overflow-wrap: anywhere; }
  .open-status .dot { transform: translateY(-1px); }
  table.data { table-layout: fixed; }
  table.data tbody tr { cursor: default; }
  .board > .panel { margin-top: 0; padding: var(--space-3); gap: var(--space-2); }
  @media (min-width: 1400px) {
    /* Keep every section's first row on the board. Longer inventories scroll
       within the mount grid; the tab itself still scrolls to Links. */
    [data-testid='mount-grid'] { max-height: 7.5rem; overflow-y: auto; padding: 2px; }
  }
</style>
