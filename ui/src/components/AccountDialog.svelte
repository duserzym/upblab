<!--
  Sign-in dialog, opened from the account button in the tab bar.
  The shell signs in once (plan decision 5); every module tab gets the token
  through @lab/bridge. While open, the shell hides the native module webviews
  (they paint over the shell page otherwise).
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { identity, type Provider, type Providers } from '../lib/identity.svelte';
  import { openOverlay, closeOverlay } from '../lib/overlays.svelte';

  let username = $state('');
  let password = $state('');
  let busy = $state(false);
  let providers = $state<Providers | null>(null);
  let input = $state<HTMLInputElement>();

  const server = $derived(identity.target?.server ?? '');
  $effect.pre(() => {
    if (identity.dialog && !identity.signedIn) openOverlay('sign-in');
    else closeOverlay('sign-in');
  });
  onDestroy(() => closeOverlay('sign-in'));

  // Each time the dialog opens signed out: ask which methods the server offers.
  $effect(() => {
    if (!identity.dialog || identity.signedIn) return;
    providers = null;
    void identity.providers().then((p) => (providers = p));
    queueMicrotask(() => input?.focus());
  });

  function close() {
    identity.dialog = false;
    identity.error = '';
    password = '';
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    busy = true;
    const ok = await identity.login(username, password);
    busy = false;
    if (ok) close();
  }

  async function browser(p: Provider) {
    await identity.beginProvider(p);
  }

  function onKey(e: KeyboardEvent) {
    if (identity.dialog && e.key === 'Escape') close();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if identity.dialog && !identity.signedIn}
  <div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
    <div class="glass panel dialog stack" role="dialog" aria-modal="true" aria-labelledby="account-title">
      <h2 id="account-title">Sign in to UPbDB</h2>
      <p class="muted small mono">{server || 'no server configured'}</p>
      {#if identity.pending}
        <div class="stack tight">
          <div class="row"><span class="spinner" aria-hidden="true"></span><strong>Finish signing in in your browser</strong></div>
          <p class="faint small">
            {identity.pending.provider === 'orcid' ? 'ORCID' : 'Google'} sends you back to UPb Lab when you are done.
          </p>
          <div class="row"><button class="btn" onclick={() => (identity.pending = null)}>Cancel</button></div>
        </div>
      {:else}
        <form class="stack" onsubmit={submit}>
          <label class="field">
            User name
            <input bind:this={input} type="text" autocomplete="username" autocapitalize="off" spellcheck="false" bind:value={username} />
          </label>
          <label class="field">
            Password
            <input type="password" autocomplete="current-password" bind:value={password} />
          </label>
          {#if identity.error}<p class="error small">{identity.error}</p>{/if}
          <div class="row">
            <button class="btn" type="button" onclick={close}>Cancel</button>
            <span class="spacer"></span>
            <button class="btn primary" type="submit" disabled={busy || !username.trim() || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </div>
        </form>
        {#if providers?.orcid || providers?.google}
          <div class="row or"><span class="faint small">or</span></div>
          <div class="row">
            {#if providers.orcid}<button class="btn" onclick={() => browser('orcid')}>Sign in with ORCID</button>{/if}
            {#if providers.google}<button class="btn" onclick={() => browser('google')}>Sign in with Google</button>{/if}
          </div>
          <p class="faint small">Opens your web browser; it returns to UPb Lab through a <code>upbdb://</code> link.</p>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    padding: var(--space-4);
  }
  .dialog { width: min(28rem, 100%); max-height: 100%; overflow: auto; }
  .dialog h2 { margin: 0; }
  .dialog p { margin: 0; }
  .tight { gap: var(--space-2); }
  .or { justify-content: center; }
</style>
