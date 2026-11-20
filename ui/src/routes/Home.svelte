<script lang="ts">
  import FilterBar from '../components/FilterBar.svelte';
  import RecordLists from '../components/RecordLists.svelte';
  import { oversight, READ_ONLY_REASON } from '../lib/oversight.svelte';
  import GrainAtlasLocalNotice from '../components/GrainAtlasLocalNotice.svelte';
  import StudioGuidance from '../components/StudioGuidance.svelte';
  import { apps } from '../lib/apps.svelte';
  import { connectivity } from '../lib/connectivity.svelte';
  import { localInventory } from '../lib/local-sessions.svelte';
  import { day, capInventory } from '../lib/home';
  import UploadCard from '../components/UploadCard.svelte';
  import { upload } from '../lib/upload.svelte';
  import { identity } from '../lib/identity.svelte';
  import { localService } from '../lib/localService.svelte';
  import Toolbar from '../components/home/Toolbar.svelte';
  import SummaryBand from '../components/home/SummaryBand.svelte';
  import { hasHomePin, pinAccountKey, type HomePin } from '../lib/home-pins';
  import Icon from '../components/home/Icon.svelte';
  import SessionCard from '../components/home/SessionCard.svelte';
  import MineralIcon from '../components/home/MineralIcon.svelte';
  import MountCard from '../components/home/MountCard.svelte';
  import { notReduced, sessionsShown, sessionsByMineral, mountsShown, spotKinds, kindColor, type Sort } from '../lib/home';
  import { overview } from '../lib/overview.svelte';
  import { isDesktop, pickPaths, probe, studioStatus, type StudioStatus } from '../lib/platform';
  import { fromFileList } from '../lib/drop';
  import { opener } from '../lib/opener.svelte';
  import { settings } from '../lib/settings.svelte';
  import { shell } from '../lib/shell.svelte';
  import { atlasSync } from '../lib/atlas-sync.svelte';

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
    if (oversight.viewAs) return;
    expandedUpload = which;
    void uploadCards[which]?.choose();
  }
  let localQuery = $state('');
  let localSort = $state<Sort>('newest');
  const localById = $derived(new Map(localInventory.rows.filter(row => row.id).map(row => [row.id!, row])));
  const localRows = $derived(capInventory(localInventory.rows.filter(row => `${row.key} ${row.material ?? ''}`.toLowerCase().includes(localQuery.toLowerCase())).sort((a,b) => localSort === 'az' || localSort === 'za' ? a.key.localeCompare(b.key) * (localSort === 'az' ? 1 : -1) : (a.started_at ?? a.modified).localeCompare(b.started_at ?? b.modified) * (localSort === 'oldest' ? 1 : -1))));
  $effect(() => { if (active) void localInventory.load(); });

  let sessionQuery = $state(''), mountQuery = $state('');
  let sessionSort = $state<Sort>('newest'), mountSort = $state<Sort>('newest');
  let pendingOnly = $state(false);
  const sessions = $derived(sessionsShown(overview.sessions, sessionQuery, sessionSort).filter(row => !pendingOnly || notReduced(row)));
  const recordsOpen = $derived(settings.homeSections.view === 'records');
  // Local mode uses the local service's stable identity, rather than its changing loopback port.
  const pinAccount = $derived(!oversight.viewAs && identity.signedIn ? pinAccountKey(shell.local ? identity.target?.key : identity.target?.server, identity.account?.username) : null);
  const pins = $derived(pinAccount ? settings.homePins[pinAccount] ?? [] : []);
  let pinError = $state('');
  function togglePin(item: Omit<HomePin, 'pinned_at'>) {
    if (!pinAccount || oversight.viewAs) return;
    pinError = '';
    void settings.toggleHomePin(pinAccount, item).catch(error => { pinError = `Pins changed for this visit, but could not be saved: ${String(error)}`; });
  }
  function chooseView(view: 'overview' | 'records') {
    void settings.update({ homeSections: { ...settings.homeSections, view } });
  }
  let groupSessions = $state(false);
  const mineralGroups = $derived(groupSessions ? sessionsByMineral(sessions) : []);
  const atlasFilter = $derived(settings.homeSections.mounts?.atlasFilter ?? 'all');
  const mounts = $derived(mountsShown(overview.mounts, mountQuery, mountSort, atlasFilter));
  const withAtlasCount = $derived(overview.mounts.filter(r => r.atlas && r.atlas !== 'error').length);
  const maximum = $derived(Math.max(0, ...sessions.map(r => r.session.acquisition_count)));
  const sessionProgress = $derived(overview.sessionProgress.completed < overview.sessionProgress.total
    ? `loading ${overview.sessionProgress.completed} of ${overview.sessionProgress.total}` : undefined);
  const mountProgress = $derived(overview.mountProgress.completed < overview.mountProgress.total
    ? `checking ${overview.mountProgress.completed} of ${overview.mountProgress.total} mounts for atlases` : undefined);
  const sessionCap = $derived({ shown: overview.sessions.length, total: overview.totalSessions, hasMore: !!overview.sessionCursor, loadRest: () => void overview.loadRest('sessions') });
  const mountCap = $derived({ shown: overview.mounts.length, total: overview.totalMounts, hasMore: !!overview.mountCursor, loadRest: () => void overview.loadRest('mounts') });
  const refresh = () => void overview.load({ force: true });
  const resetHomeLayout = () => { pendingOnly = false; void settings.update({ homeSections: {} }); };

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
    if (url && !shell.local) void probe(url).then((r) => (server = r.reachable));
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
  type Pill = { tab: 'sessions' | 'reduce'; name: string; module: string; ok: boolean | null; state: string; detail: string };
  const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const pills = $derived.by((): Pill[] => {
    const sessionsPill: Pill = shell.local
      ? {
          tab: 'sessions', name: 'Sessions', module: 'UPbDB', ok: localOk,
          state: connectivity.offlineCopy && connectivity.state === 'online' ? 'Read-only copy' : local?.phase === 'ready' ? 'This computer' : `This computer · ${localLine}`,
          detail: [
            `PostgreSQL ${local?.postgres.running ? `running on 127.0.0.1:${local.postgres.port}` : 'stopped'}${local?.postgres.source ? ` (${local.postgres.source})` : ''}`,
            `Service ${local?.service.running ? `${local.phase === 'ready' ? 'ready' : 'starting'} on 127.0.0.1:${local.service.port}` : 'stopped'}${local?.service.source ? ` (${local.service.source === 'dev' ? 'development checkout' : `bundle ${local.service.version ?? ''}`})` : ''}`,
          ].join(' · '),
        }
      : {
          tab: 'sessions', name: 'Sessions', module: 'UPbDB', ok: connectivity.asOf && connectivity.state !== 'online' ? null : server,
          state: connectivity.asOf && connectivity.state !== 'online' ? 'Offline · saved data' : connectivity.offlineCopy ? 'Read-only copy' : server === false ? `${host(settings.serverUrl)} unreachable` : host(settings.serverUrl) || 'no server',
          detail: `${settings.serverUrl} · ${server === null ? 'checking…' : server ? 'server reachable' : 'server unreachable'}`,
        };
    const studioState = !isDesktop ? 'desktop app only' : studio === null ? 'checking…' : studio.found ? (studio.kind === 'checkout' ? 'development checkout' : 'installed') : 'not found';
    return [
      sessionsPill,
      {
        tab: 'reduce', name: 'Reduce', module: 'UPbRPy Studio', ok: isDesktop && studio ? studio.found : null,
        state: studioState, detail: [studioState, studio?.path].filter(Boolean).join(' · '),
      },
    ];
  });
</script>

<section class="view scroll home" class:hidden={!active} data-testid="home-scroll">
  <div class="page stack board">
    <header class="intro">
      <h1>UPb Lab</h1>
      <button class="chip" onclick={resetHomeLayout}>Reset Home layout</button>
      <p class="muted small hint">Drop a folder or files anywhere in this window, or start below.</p>
      <div class="pills" role="group" aria-label="Pipeline status" data-testid="status-pills">
        {#each pills as p (p.tab)}
          <button class="pill" class:problem={p.ok === false} title={`${p.name} · ${p.module}: ${p.detail}`} aria-label={`${p.name} · ${p.module}: ${p.detail}`} onclick={() => shell.show(p.tab)}>
            <span class="dot" style="background: {color(p.ok)}"></span><strong>{p.name}</strong><span class="state">{p.state}</span>
          </button>
        {/each}
      </div>
    </header>

    {#if apps.studio?.state === 'outdated'}<StudioGuidance from="home" />{/if}
    {#if active}<div class="filter-slot"><FilterBar {active} /></div>{/if}
    <div class="row home-actions">
    <div class="action-tiles" data-testid="open-panel">
      <button class="glass panel action-tile" aria-label="Open folder…" disabled={!!oversight.viewAs} title={oversight.viewAs ? READ_ONLY_REASON : undefined} onclick={() => void openDialog(true)}><Icon kind="folder" /><span><strong>Open folder</strong><small>Open a package or export folder</small></span></button>
      <button class="glass panel action-tile" aria-label="Open files…" disabled={!!oversight.viewAs} title={oversight.viewAs ? READ_ONLY_REASON : undefined} onclick={() => void openDialog(false)}><Icon kind="files" /><span><strong>Open files</strong><small>Open images or session CSVs</small></span></button>
      <button class="glass panel action-tile" aria-label="Upload LA-ICP-MS session…" disabled={!!oversight.viewAs} title={oversight.viewAs ? READ_ONLY_REASON : undefined} aria-controls="home-upload-sessions" onclick={() => startUpload('sessions')}><Icon kind="session" /><span><strong>Upload LA-ICP-MS session</strong><small>Import a session, then Review</small></span></button>
      <button class="glass panel action-tile" aria-label="Upload image set…" disabled={!!oversight.viewAs} title={oversight.viewAs ? READ_ONLY_REASON : undefined} aria-controls="home-upload-images" onclick={() => startUpload('images')}><Icon kind="images" /><span><strong>Upload image set</strong><small>Publish mount images, then Review</small></span></button>
    </div>
    <nav class="row records-nav" aria-label="Home view">
      <button class="chip" aria-pressed={!recordsOpen} onclick={() => chooseView('overview')}>Overview</button>
      <button class="chip" aria-pressed={recordsOpen} onclick={() => chooseView('records')}>Records · Samples and Projects</button>
    </nav>
    <button class="btn small refresh-inventory" aria-label="Refresh sessions and mounts" title="Refresh sessions and mounts" disabled={overview.refreshing || !identity.signedIn} onclick={refresh}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/></svg>
    </button>
    </div>
    <div class="upload-panels">
    <!-- Both cards stay mounted (their web file inputs must exist for the tile's click); a card shows while it is in use. -->
    {#each ['sessions', 'images'] as const as which (which)}
      {@const card = which === 'sessions' ? upload.sessions : upload.images}
      <div id="home-upload-{which}" class="glass panel stack upload-expansion" data-testid="upload-panel-{which}" hidden={!(expandedUpload === which || (expandedUpload === null && (card.open || card.error)))}>
        <div class="row"><h2>{which === 'sessions' ? 'Session upload' : 'Image set upload'}</h2><span class="spacer"></span><button class="btn small" aria-label="Close {which === 'sessions' ? 'session' : 'image set'} upload panel" onclick={() => { expandedUpload = null; card.close(); card.error = ''; }}>Close</button></div>
        <UploadCard {card} showChoose={false} bind:this={uploadCards[which]} />
      </div>
    {/each}
    </div>
    <div class="home-notices">
    <GrainAtlasLocalNotice {active} view="home" />
    {#if opener.status}
      <p class="small open-status" role="status">
        <span class="dot" style="background: {openColor(opener.status.state)}"></span>
        <span class="mono">{opener.status.what}</span>: {opener.status.outcome}
      </p>
      {#if !isDesktop && opener.status.outcome.startsWith('Open grainatlas')}
        <a class="btn" href={shell.homeUrl('images')} target="_blank" rel="noopener">Open grainatlas</a>
      {/if}
    {/if}
    {#if !isDesktop}
      <input bind:this={folderInput} aria-label="Open folder" type="file" webkitdirectory multiple hidden onchange={() => chosen(folderInput)} />
      <input bind:this={filesInput} aria-label="Open files" type="file" multiple hidden onchange={() => chosen(filesInput)} />
    {/if}


    {#if atlasSync.strandedDrafts.length}
      <p class="small stranded" role="status" data-testid="stranded-drafts">
        UPb Lab still holds unsynced grainatlas edits from its former Images tab for {atlasSync.strandedDrafts.map(d => d.name).join(', ')}.
        They are kept in UPb Lab's own storage, which the standalone grainatlas cannot open. Do not reset UPb Lab's data until they are recovered.
      </p>
    {/if}
    {#if pinError}<p class="error small" role="status">{pinError}</p>{/if}
    </div>
    <SummaryBand {pins} canPin={!!pinAccount} {togglePin}
      showPending={() => { chooseView('overview'); pendingOnly = true; }}
      showWithoutAtlas={() => { chooseView('overview'); void settings.updateHomeSection('mounts', { atlasFilter: 'without' }); }} />
    <div class="compact-columns" class:records-open={recordsOpen} data-testid="home-columns">
    <section class="glass panel board-section working-column" aria-label="Sessions">
      <Toolbar section="Sessions" compact filtered={pendingOnly} bind:query={sessionQuery} bind:sort={sessionSort} count={sessions.length} total={overview.totalSessions} progress={sessionProgress} cap={sessionCap} busy={overview.refreshing}>
        {#snippet legend()}
          <details class="spot-key small muted">
            <summary aria-label="Spot bar legend">Spot mix ⓘ</summary>
            <div class="glass panel stack">
              {#each spotKinds as [kind, label] (kind)}<span><i style:background={kindColor(kind)} aria-hidden="true"></i>{label}</span>{/each}
              <span>Bar length relative to the largest shown session</span>
            </div>
          </details>
        {/snippet}
        {#snippet options()}
          <button class="chip" aria-pressed={pendingOnly} onclick={() => pendingOnly = !pendingOnly}>Not reduced</button>
          <button class="btn small group-button" aria-label="Group by mineral" title="Group by mineral" aria-pressed={groupSessions} onclick={() => groupSessions = !groupSessions}>Group by mineral</button>
        {/snippet}
      </Toolbar>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Focusable inventory supports keyboard scrolling.) -->
      <div class="column-scroll" data-testid="session-grid" role="group" aria-label="Session cards" tabindex="0">
        {#if overview.state === 'idle' || (overview.state === 'loading' && overview.sessions.length === 0)}
          <p class="faint small">{identity.target ? 'Loading sessions…' : shell.local ? 'Open Sessions or Review to start the local database.' : 'No UPbDB server configured.'}</p>
        {:else if overview.state === 'signed-out'}
          <div class="row">
            <p class="muted small grow">Sign in to see your sessions, their reductions and the images of your mounts.</p>
            <button class="btn primary" onclick={() => (identity.dialog = true)}>Sign in</button>
          </div>
        {:else if overview.state === 'unreachable'}
          <div class="row"><span class="dot" style="background: var(--danger)"></span><span class="small">UPbDB is not answering at <code>{identity.target?.server}</code>.</span></div>
          <p class="faint small mono">{overview.error}</p>
          {#if overview.savedEntries === 0}<p class="muted small">Nothing is saved on this computer from this server yet. Open a local session in On this computer.</p>{/if}
        {:else if overview.state === 'error'}
          <p class="error small">Could not read sessions: {overview.error}</p>
        {:else if overview.sessions.length === 0}
          <p class="muted small">No sessions yet. Upload a laser session in the <button class="linkish" onclick={() => shell.show('sessions')}>Sessions</button> tab.</p>
        {:else}
          {#if sessions.length}
            <div class="dense-list">
              {#if groupSessions}
                {#each mineralGroups as [mineral, rows] (mineral)}
                  <section class="stack mineral-group" aria-label={mineral}>
                    <h3 class="row"><MineralIcon {mineral} /><span>{mineral}</span><span class="muted small">{rows.length}</span></h3>
                    <div class="dense-list">
                      {#each rows as row (row.session.id)}<SessionCard {row} {maximum} dense local={localById.get(row.session.id)} pinned={hasHomePin(pins, 'session', row.session.id)} togglePin={pinAccount ? () => togglePin({ kind: 'session', id: row.session.id, label: row.session.session_key }) : undefined} />{/each}
                    </div>
                  </section>
                {/each}
              {:else}
                <div class="dense-list">
                  {#each sessions as row (row.session.id)}<SessionCard {row} {maximum} dense local={localById.get(row.session.id)} pinned={hasHomePin(pins, 'session', row.session.id)} togglePin={pinAccount ? () => togglePin({ kind: 'session', id: row.session.id, label: row.session.session_key }) : undefined} />{/each}
                </div>
              {/if}
            </div>
          {:else}
            <p class="muted small">No sessions match this search.</p>
          {/if}
        {/if}
      </div>
    </section>

      <section class="glass panel board-section working-column" aria-label="Mounts">
        <Toolbar section="Mounts" compact bind:query={mountQuery} bind:sort={mountSort} count={mounts.length} total={overview.totalMounts} summary={`${withAtlasCount} with atlas`} filtered={atlasFilter !== 'all'} progress={mountProgress} cap={mountCap} busy={overview.refreshing}>
          {#snippet options()}
            <div class="row atlas-filter" role="group" aria-label="Filter mounts by atlas">
              {#each [['all', 'All'], ['with', 'With atlas'], ['without', 'Without atlas']] as const as [value, label] (value)}
                <button class="chip" aria-pressed={atlasFilter === value} onclick={() => void settings.updateHomeSection('mounts', { atlasFilter: value })}>{label}</button>
              {/each}
            </div>
          {/snippet}
        </Toolbar>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Focusable inventory supports keyboard scrolling.) -->
        <div class="column-scroll" data-testid="mount-grid" role="group" aria-label="Mount cards" tabindex="0">
          {#if overview.mounts.length === 0}
            <p class="muted small">{overview.state === 'signed-out' ? 'Sign in to see your mounts.' : overview.state === 'unreachable' ? 'The server is unreachable. No mounts are saved on this computer yet.' : overview.state === 'error' ? 'Mounts could not be read.' : overview.state === 'ready' ? 'No mounts yet. Register mounts in Sessions; publish their images from grainatlas.' : 'Mounts will appear when the database is available.'}</p>
          {:else}
            <div class="dense-list">
              {#each mounts as row (row.mount.id)}<MountCard {row} dense pinned={hasHomePin(pins, 'mount', row.mount.id)} togglePin={pinAccount ? () => togglePin({ kind: 'mount', id: row.mount.id, label: row.mount.label }) : undefined} />{/each}
            </div>
            {#if mounts.length === 0}<p class="muted small">No mounts match this search or filter.</p>{/if}
          {/if}
          {#if overview.error}<p class="faint small">{overview.error}</p>{/if}
        </div>
      </section>

    <div class="utility-stack">
      <section class="glass panel working-column" aria-label="On this computer">
        <Toolbar section="On this computer" compact
          bind:query={localQuery} bind:sort={localSort} count={localRows.length} total={localInventory.rows.length}
          refresh={() => void localInventory.load(true)} busy={localInventory.loading} />
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Focusable inventory supports keyboard scrolling.) -->
        <div class="column-scroll" data-testid="local-session-grid" role="group" aria-label="Local session cards" tabindex="0">
          {#if localInventory.error}<p class="error small" role="status">{localInventory.error}</p>{/if}
          {#if localRows.length}
            <div class="dense-list">
              {#each localRows as row (row.path)}
                <article class="stack local-session-card" data-testid="local-session-card">
                  <div class="row"><strong class="mono">{row.key}</strong><span class="chip">{row.material ?? 'Unspecified'}</span></div>
                  <p class="muted small">{day(row.started_at ?? row.modified)} · {row.acquisitions} analyses</p>
                  {#if row.openable === false}
                    <p class="muted small" title={row.path}>Downloaded before the UPbDB rename. This Studio cannot open it yet.</p>
                  {:else}
                    <button class="btn small" disabled={!!localInventory.opening || !!oversight.viewAs} title={oversight.viewAs ? READ_ONLY_REASON : undefined} onclick={() => void localInventory.open(row)}>Open in UPbRPy Studio</button>
                  {/if}
                </article>
              {/each}
            </div>
          {:else}<p class="muted small">{!isDesktop ? 'Local folders are available in the desktop app.' : localInventory.loading ? 'Reading local sessions…' : localQuery ? 'No local sessions match this search.' : 'No local LA-ICP-MS sessions found.'}</p>{/if}
          {#if localInventory.rows.length >= 500}<p class="faint small">Up to 500 local session folders are listed.</p>{/if}
        </div>
      </section>

    <section class="glass panel working-column links-column" aria-label="Links">
      <h2>Links</h2>
      <form class="row" onsubmit={openLink}>
        <input
          type="text"
          class="grow mono"
          placeholder="upbdb:// · grainatlas:// · upbr://"
          bind:value={linkInput}
          aria-label="Open a link"
        />
        <button class="btn primary" type="submit">Open</button>
      </form>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Focusable inventory supports keyboard scrolling.) -->
      <div class="column-scroll" data-testid="links-scroll" role="group" aria-label="Recent links" tabindex="0">
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
    </section>
    </div>
    </div>
    <div class="records-board" hidden={!recordsOpen} data-testid="home-records">
      <RecordLists {active} layout="columns" />
      {#if !identity.signedIn}<p class="muted small">Sign in to see Samples and Projects.</p>{/if}
    </div>
  </div>
</section>

<style>
  .local-session-card { min-width: 0; overflow-wrap: anywhere; gap: var(--space-2); padding: var(--space-3); }
  .local-session-card .btn { align-self: flex-start; padding: 0.1rem var(--space-2); font-size: 0.74rem; }
  .local-session-card .mono { min-width: 0; }
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
  .home.view.scroll { position: relative; overflow: hidden; }
  .board { flex: 1; min-height: 0; overflow: hidden; padding-bottom: var(--space-3); }
  .board > * { flex-shrink: 0; }
  .board > :global(.panel) { margin-top: 0; }
  .filter-slot { min-width: 0; max-height: 10rem; overflow: auto; }
  .filter-slot > :global(.panel) { margin: 0; }
  .home-actions { gap: var(--space-2); }
  .action-tiles { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .action-tile { display: inline-flex; gap: var(--space-2); align-items: center; text-align: left; padding: var(--space-1) var(--space-3); margin: 0; min-width: 0; border-radius: 999px; cursor: pointer; color: var(--text); }
  .action-tile:hover { border-color: var(--accent); background: var(--accent-soft); }
  .action-tile strong { font-size: 0.8rem; }
  .action-tile small { display: none; }
  .records-nav { gap: var(--space-2); margin-left: auto; }
  .refresh-inventory { display: inline-grid; place-items: center; width: 32px; height: 32px; padding: var(--space-1); flex: none; }
  .refresh-inventory svg { width: 20px; height: 20px; }
  .records-nav .chip[aria-pressed='true'], .group-button[aria-pressed='true'] { color: var(--accent); background: var(--accent-soft); border-color: var(--accent); }
  .upload-panels:empty, .home-notices:empty { display: none; }
  .upload-panels { position: absolute; z-index: 3; bottom: var(--space-3); left: var(--space-4); right: var(--space-4); max-height: min(50%, 24rem); overflow: auto; background: var(--glass-strong); border-radius: var(--radius); box-shadow: var(--glass-shadow); }
  .upload-panels:not(:has(> :not([hidden]))) { display: none; }
  .upload-expansion { padding: var(--space-2) var(--space-3); margin: 0; gap: var(--space-2); }
  .upload-expansion[hidden], .records-board[hidden] { display: none; }
  .home-notices { max-height: 5rem; overflow: auto; min-width: 0; overflow-wrap: anywhere; }
  .compact-columns { display: grid; grid-template-columns: 1.1fr 1.1fr 1fr; grid-template-rows: minmax(0, 1fr); gap: var(--space-3); flex: 1; flex-shrink: 1; min-height: 0; min-width: 0; }
  .compact-columns.records-open { display: none; }
  .working-column { display: flex; flex-direction: column; min-width: 0; min-height: 0; margin: 0; padding: var(--space-2) var(--space-3); gap: var(--space-2); overflow: hidden; box-shadow: none; }
  .working-column > :global(header), .links-column > h2 { flex: none; }
  .column-scroll { flex: 1 1 0; min-height: 0; min-width: 0; overflow: auto; overflow-wrap: anywhere; padding: 0 2px; overscroll-behavior: contain; }
  .dense-list { min-width: 0; }
  .dense-list > :global(.panel) { margin: 0; }
  .utility-stack { display: grid; grid-template-rows: repeat(2, minmax(0, 1fr)); gap: var(--space-3); min-height: 0; min-width: 0; }
  .local-session-card { border-bottom: 1px solid var(--hairline); border-radius: 0; padding: var(--space-2) 0; }
  .local-session-card .row { flex-wrap: wrap; }
  .links-column h2 { font-size: 1rem; }
  .links-column form { min-width: 0; flex: none; gap: var(--space-2); }
  .links-column input { width: 0; padding: var(--space-1) var(--space-2); font-size: 0.78rem; }
  .links-column table { table-layout: fixed; width: 100%; }
  .links-column th, .links-column td { padding: var(--space-1); font-size: 0.74rem; overflow-wrap: anywhere; }
  .links-column th:nth-child(1) { width: 19%; }
  .links-column th:nth-child(2) { width: 15%; }
  .links-column th:nth-child(4) { width: 24%; }
  .records-board { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); flex: 1; flex-shrink: 1; min-height: 0; min-width: 0; }
  .atlas-filter { gap: var(--space-1); flex-wrap: wrap; }
  .spot-key { position: relative; margin-left: auto; font-size: 0.72rem; }
  .spot-key summary { cursor: pointer; white-space: nowrap; }
  .spot-key > div { position: absolute; z-index: 2; right: 0; top: 100%; width: 15rem; padding: var(--space-3); gap: var(--space-1); background: var(--glass-strong); }
  .spot-key span { display: flex; align-items: center; gap: var(--space-1); }
  .spot-key i { width: 0.6rem; height: 0.45rem; flex: none; border-radius: 2px; }
  .mineral-group { gap: var(--space-2); }
  .mineral-group h3 { margin: 0; gap: var(--space-1); text-transform: capitalize; }
  .grow { flex: 1; min-width: 0; margin: 0; }
  .linkish { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; font: inherit; text-align: left; }
  .linkish:hover { text-decoration: underline; }
  .open-status { display: flex; gap: var(--space-2); align-items: baseline; min-width: 0; overflow-wrap: anywhere; }
  .open-status .dot { transform: translateY(-1px); }
  .stranded { margin: 0; padding: var(--space-2) var(--space-3); border: 1px solid var(--warning); border-radius: var(--radius-sm); overflow-wrap: anywhere; }
  @media (max-width: 1100px), (max-height: 760px) {
    .home.view.scroll { overflow-y: auto; }
    .board { flex: none; min-height: 100%; overflow: visible; }
    .filter-slot { max-height: none; overflow: visible; }
    .compact-columns { flex: none; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: 420px auto; }
    .working-column { min-height: 420px; }
    .utility-stack { grid-column: 1 / -1; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: 420px; }
    .records-board { flex: none; grid-auto-rows: 420px; }
    .column-scroll { overscroll-behavior: auto; }
    .upload-panels { position: fixed; bottom: var(--space-2); left: var(--space-2); right: var(--space-2); max-height: min(50vh, 24rem); }
  }
  @media (max-width: 1100px) {
    .board { padding: var(--space-2); }
    .hint { flex-basis: 20rem; }
  }
  @media (max-width: 700px) {
    .compact-columns, .utility-stack, .records-board { grid-template-columns: minmax(0, 1fr); }
    .compact-columns { grid-template-rows: repeat(2, 420px) auto; }
    .utility-stack { grid-template-rows: repeat(2, 420px); }
  }
</style>
