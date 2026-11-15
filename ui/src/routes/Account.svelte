<script lang="ts">
  import { identity } from '../lib/identity.svelte';
  import { overview } from '../lib/overview.svelte';
  import { shell } from '../lib/shell.svelte';
  import type { TabId } from '../lib/links';
  import { settings } from '../lib/settings.svelte';

  const account = $derived(identity.account);
  const canList = $derived(identity.signedIn && !identity.checking && overview.state === 'ready');
  const rows = $derived(canList ? overview.sessions : []);
  const owned = $derived(rows.filter((row) => row.access?.role === 'Owner').length);
  const providers: Record<string, string> = { password: 'Password', google: 'Google', orcid: 'ORCID' };
  let signingOut = $state(false);

  async function signOut() {
    signingOut = true;
    try {
      await identity.logout();
    } finally {
      signingOut = false;
    }
  }
</script>

<section class="view scroll">
  <div class="page stack account-page">
    <header class="row page-heading">
      <h1>Your account</h1>
      <span class="spacer"></span>
      <button class="btn" onclick={() => shell.show(settings.lastTab as TabId)}>Back to workspace</button>
    </header>
    {#if identity.checking}
      <p class="muted" role="status">Checking your sign-in…</p>
    {:else if identity.signedIn}
      <section class="glass panel stack" aria-label="Account profile">
        <div class="row section-heading">
          <h2>{identity.label}</h2>
          <span class="spacer"></span>
          <button class="btn signout" disabled={signingOut} onclick={signOut}>Sign out</button>
        </div>
        {#if identity.state.offline}<p class="muted" role="status">The server is currently unreachable.</p>{/if}
        <dl class="grid-kv small">
          {#if account}
            <dt>Username</dt><dd class="mono">{account.username}</dd>
            {#if account.email}<dt>Email</dt><dd>{account.email}</dd>{/if}
            {#if account.affiliation}<dt>Affiliation</dt><dd>{account.affiliation}</dd>{/if}
            {#if account.orcid}<dt>ORCID iD</dt><dd>{account.orcid}</dd>{/if}
            {#if account.is_admin || account.is_lab_staff}
              <dt>Server role</dt><dd>{account.is_admin ? 'Administrator' : 'Lab staff'}</dd>
            {/if}
          {/if}
          <dt>Database</dt><dd class="mono">{identity.target?.server}</dd>
          <dt>Lab groups</dt><dd>{account?.groups?.map((group) => group.name).join(', ') || 'No lab groups'}</dd>
          <dt>Sign-in methods</dt><dd>{account?.sign_in_methods?.map((method) => providers[method] ?? method).join(', ') || 'Unavailable'}</dd>
        </dl>
        <div class="row controls">
          <button class="btn" onclick={() => shell.show('settings')}>App settings</button>
          <button class="btn" disabled={identity.state.offline} onclick={() => shell.go('sessions', '/app/account')}>Manage sign-in methods</button>
        </div>
      </section>
      <section class="glass panel stack" aria-labelledby="session-access-title">
        <div class="row section-heading">
          <h2 id="session-access-title">Session access and sharing</h2>
          {#if canList}<span class="muted small">{owned} owned · {rows.length} shown</span>{/if}
          <span class="spacer"></span>
          {#if canList && overview.sessions.length < overview.totalSessions}
            <button class="btn small" disabled={overview.refreshing} onclick={() => void overview.loadRest('sessions')}>Showing {overview.sessions.length} of {overview.totalSessions} · Load the rest</button>
          {/if}
          <button class="btn small" disabled={overview.refreshing} onclick={() => void overview.load({ force: true })}>Refresh access</button>
        </div>
        {#if canList && rows.length}
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th scope="col">Session</th><th scope="col">Your access</th><th scope="col">Owner</th><th scope="col"><span class="small">Sharing</span></th></tr></thead>
              <tbody>
                {#each rows as { session, access } (session.id)}
                  <tr>
                    <td><button class="session-link mono" onclick={() => void shell.handleLink(`upbdb://session/${session.id}`, 'account')}>{session.session_key}</button></td>
                    <td>{access?.role ?? 'Unavailable'}</td>
                    <td>{access?.owner ?? '—'}</td>
                    <td>{#if access?.canShare}
                      <button class="btn small" aria-label={`Manage sharing for ${session.session_key}`}
                        onclick={() => void shell.handleLink(`upbdb://session/${session.id}?panel=sharing`, 'account')}>Manage sharing</button>
                    {/if}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else if canList}
          <p class="muted">No sessions are visible to this account.</p>
        {:else if overview.state === 'signed-out'}
          <p class="muted" role="status">The server could not verify your sign-in. Sign out and sign back in to refresh access.</p>
        {:else if overview.state === 'error' || overview.state === 'unreachable'}
          <p class="error" role="alert">Could not read session access. {overview.error}</p>
        {:else}
          <p class="muted" role="status">Loading session access…</p>
        {/if}
      </section>
    {:else}
      <p class="muted">Sign in to view account details and session access.</p>
      {#if identity.target}<div><button class="btn primary" onclick={() => (identity.dialog = true)}>Sign in</button></div>{/if}
    {/if}
  </div>
</section>

<style>
  .account-page { max-width: 62rem; }
  .section-heading, .page-heading, .controls { flex-wrap: wrap; }
  .section-heading h2, .page-heading h1, p { margin: 0; }
  .grid-kv dd { min-width: 0; overflow-wrap: anywhere; }
  .session-link { background: none; border: 0; padding: 0; text-align: left; color: var(--accent); cursor: pointer; overflow-wrap: anywhere; }
  .session-link:hover { text-decoration: underline; }
  .table-wrap { min-width: 0; overflow: auto; }
  .signout { color: var(--danger); }
</style>
