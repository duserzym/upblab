<script lang="ts">
  import { oversight, READ_ONLY_REASON } from '../lib/oversight.svelte';
  import { identity } from '../lib/identity.svelte';
  import { ownerName } from '../lib/records.svelte';
  import { untrack } from 'svelte';
  import { overview } from '../lib/overview.svelte';
  import { settings } from '../lib/settings.svelte';
  import { shell } from '../lib/shell.svelte';
  import { review } from '../lib/review.svelte';
  import { openInStudio } from '../lib/apps.svelte';
  import { reduceStatus } from '../lib/reduce-status';
  import { day } from '../lib/home';
  import StudioGuidance from '../components/StudioGuidance.svelte';
  let { active }: { active: boolean } = $props();
  // Load once per activation; untracked so the state load() reads cannot re-run this effect.
  $effect(() => { void identity.revision; if (active && settings.loaded) untrack(() => void overview.load()); });
</script>
<section class="view scroll" class:hidden={!active}>
  <div class="page stack">
    <div class="row wrap"><h1>Reduce</h1><button class="btn" onclick={() => void shell.show('settings')}>Studio settings</button></div>
    <StudioGuidance />
    {#if overview.state === 'loading'}<p class="muted">Loading sessions…</p>
    {:else if overview.state === 'signed-out'}<p class="muted">Sign in to see sessions.</p>
    {:else if overview.error}<p class="muted">{overview.error}</p>{/if}
    <div class="stack" aria-label="Reduction sessions" data-testid="reduce-sessions">
      {#each overview.sessions as row (row.session.id)}
        {@const status = reduceStatus(row, settings.studioOpened[row.session.id])}
        <article class="glass panel row wrap">
          <div class="session-name stack"><strong>{row.session.session_key}</strong>{#if ownerName(row.session)}<span class="muted small">Owner: {ownerName(row.session)}</span>{/if}<span class="muted small">{status.label}{status.date ? ` · ${day(status.date)}` : ''}</span>
            {#if settings.studioOpened[row.session.id]}<span class="faint small">Last opened from here {day(settings.studioOpened[row.session.id])}</span>{/if}
          </div>
          <div class="row wrap">
            <button class="btn" disabled={!!oversight.viewAs} title={oversight.viewAs ? READ_ONLY_REASON : undefined} onclick={() => void openInStudio({ session: row.session.id, run: null }, 'reduce')}>Open in Studio</button>
            {#if status.label === 'submitted'}<button class="btn" onclick={() => { void shell.show('review'); void review.open({ kind: 'session', id: row.session.id }); }}>Review</button>{/if}
          </div>
        </article>
      {:else}{#if overview.state === 'ready'}<p class="muted">No sessions yet. Upload a session from Home.</p>{/if}{/each}
    </div>
    {#if overview.sessions.length < overview.totalSessions}<button class="btn" onclick={() => void overview.loadRest('sessions')}>Show all sessions</button>{/if}
  </div>
</section>
<style>
  .page {min-width:0;overflow-wrap:anywhere;} .wrap {flex-wrap:wrap;} .session-name {flex:1;min-width:0;gap:4px;} .btn {white-space:normal;} h1 {margin:0;}
</style>
