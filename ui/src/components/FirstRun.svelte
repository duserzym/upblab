<!--
  First-run wizard (ADR-0003), shown on the desktop while no mode is stored.
  The steps are lib/wizard.ts; this component renders them and runs the side
  effects: start the local service, create the account, save the settings.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { localService } from '../lib/localService.svelte';
  import { localServiceApi } from '../lib/platform';
  import { DEFAULT_DATA_ROOT, settings } from '../lib/settings.svelte';
  import { initialState, reduce, type Context, type Form, type WizardEvent } from '../lib/wizard';

  let state = $state(
    initialState({
      dataRoot: settings.dataRoot || DEFAULT_DATA_ROOT,
      serverUrl: settings.serverUrl,
      devPath: localService.devPath,
    }),
  );
  const ctx = $derived<Context>({ localAvailable: localService.available, bundled: !!localService.status?.bundle });
  const status = $derived(localService.status);

  function send(e: WizardEvent) {
    state = reduce(state, e, ctx);
  }
  function edit(field: keyof Form, value: string | boolean) {
    send({ type: 'edit', field, value });
  }

  // Each step's side effect runs once, when the step is entered.
  let entered = '';
  $effect(() => {
    const step = state.step;
    untrack(() => {
      if (step === entered) return;
      entered = step;
      if (step === 'starting') startService();
      else if (step === 'account') createAccount();
      else if (step === 'done') save();
    });
  });

  function startService() {
    localService
      .startAndWait({ dataRoot: state.form.dataRoot.trim(), devPath: ctx.bundled ? null : state.form.devPath.trim() })
      .then((s) =>
        s.phase === 'ready'
          ? send({ type: 'service-ready' })
          : send({ type: 'service-failed', message: s.error ?? 'Stopped before it was ready', logTail: s.logTail ?? '' }),
      )
      .catch((err) => send({ type: 'service-failed', message: String(err) }));
  }

  // The first staff account, then the demo data if asked.
  function createAccount() {
    const f = state.form;
    localServiceApi
      .bootstrap({ username: f.username.trim(), email: f.email.trim(), password: f.password, loadDemo: f.loadDemo })
      .then(() => send({ type: 'account-created' }))
      .catch((err) => {
        const [message, ...tail] = String(err).split('\n');
        send({ type: 'account-failed', message, logTail: tail.join('\n') });
      });
  }

  // Remember the choice; the shell then shows its tabs.
  function save() {
    const f = state.form;
    if (state.mode === 'local') {
      void settings.update({
        mode: 'local',
        dataRoot: f.dataRoot.trim(),
        devServicePath: ctx.bundled ? settings.devServicePath : f.devPath.trim(),
        lastTab: 'sessions',
      });
    } else {
      void localService.stop().catch(() => {});
      void settings.update({ mode: 'server', serverUrl: f.serverUrl, lastTab: 'sessions' });
    }
  }

  function useServer() {
    void localService.stop().catch(() => {});
    send({ type: 'use-server' });
  }

  async function openLogs() {
    await localServiceApi.openLogs().catch(() => {});
  }

  const bundleNote = $derived(
    status?.bundle
      ? `laicpmsdb ${status.bundle} and PostgreSQL are included in this app.`
      : localService.devPath
        ? 'Development build: runs the laicpmsdb checkout below, with PostgreSQL included in this app.'
        : 'This build does not include the laicpmsdb service yet; use a lab server.',
  );
</script>

<section class="view scroll wizard">
  <div class="page narrow stack">
    <header class="stack tight">
      <h1>Welcome to UPb Studio</h1>
      <p class="muted">Where should your LA-ICP-MS sessions and data live? You can change this later in Settings.</p>
    </header>

    {#if state.step === 'choose'}
      <div class="choices">
        <button class="glass panel choice" disabled={!ctx.localAvailable} onclick={() => send({ type: 'choose', mode: 'local' })}>
          <h2>This computer</h2>
          <p class="muted small">
            UPb Studio runs its own laicpmsdb and PostgreSQL on this machine, starts them when it opens and stops them when it
            quits. Works offline; nothing to install.
          </p>
          <p class="faint small">{bundleNote}</p>
        </button>
        <button class="glass panel choice" onclick={() => send({ type: 'choose', mode: 'server' })}>
          <h2>Lab server</h2>
          <p class="muted small">Use the laicpmsdb server your lab runs, by its address. Needs the lab network or VPN.</p>
        </button>
      </div>
    {:else if state.step === 'local'}
      <form
        class="glass panel stack"
        onsubmit={(e) => {
          e.preventDefault();
          send({ type: 'submit' });
        }}
      >
        <h2>This computer</h2>
        <label class="field">
          Data root
          <input type="text" value={state.form.dataRoot} oninput={(e) => edit('dataRoot', e.currentTarget.value)} spellcheck="false" />
          <span class="faint small">Raw instrument files, attachments and exports go here (the same layout as the lab NAS). The database itself lives in the app's own folder.</span>
          {#if state.errors.dataRoot}<span class="error">{state.errors.dataRoot}</span>{/if}
        </label>
        {#if !ctx.bundled}
          <label class="field">
            laicpmsdb checkout
            <input type="text" value={state.form.devPath} oninput={(e) => edit('devPath', e.currentTarget.value)} spellcheck="false" />
            <span class="faint small">Development fallback until the service bundle ships: a checkout with <code>make venv</code> and <code>make ui</code> done.</span>
            {#if state.errors.devPath}<span class="error">{state.errors.devPath}</span>{/if}
          </label>
        {/if}
        <h3>Your account</h3>
        <p class="faint small">The first account is lab staff and administrator of this laicpmsdb. The password stays on this computer.</p>
        <div class="two">
          <label class="field">
            User name
            <input type="text" autocomplete="username" value={state.form.username} oninput={(e) => edit('username', e.currentTarget.value)} spellcheck="false" />
            {#if state.errors.username}<span class="error">{state.errors.username}</span>{/if}
          </label>
          <label class="field">
            Email
            <input type="email" autocomplete="email" value={state.form.email} oninput={(e) => edit('email', e.currentTarget.value)} />
            {#if state.errors.email}<span class="error">{state.errors.email}</span>{/if}
          </label>
          <label class="field">
            Password
            <input type="password" autocomplete="new-password" value={state.form.password} oninput={(e) => edit('password', e.currentTarget.value)} />
            {#if state.errors.password}<span class="error">{state.errors.password}</span>{/if}
          </label>
          <label class="field">
            Repeat password
            <input type="password" autocomplete="new-password" value={state.form.confirm} oninput={(e) => edit('confirm', e.currentTarget.value)} />
            {#if state.errors.confirm}<span class="error">{state.errors.confirm}</span>{/if}
          </label>
        </div>
        <label class="row check">
          <input type="checkbox" checked={state.form.loadDemo} onchange={(e) => edit('loadDemo', e.currentTarget.checked)} />
          <span>Load the demo sessions <span class="faint small">(three short Apatite, Rutile and Zircon sessions, and the demo accounts <code>analyst</code>, <code>student</code>, <code>staff</code>)</span></span>
        </label>
        <div class="row">
          <button class="btn" type="button" onclick={() => send({ type: 'back' })}>Back</button>
          <span class="spacer"></span>
          <button class="btn primary" type="submit">Set up</button>
        </div>
      </form>
    {:else if state.step === 'server'}
      <form
        class="glass panel stack"
        onsubmit={(e) => {
          e.preventDefault();
          send({ type: 'submit' });
        }}
      >
        <h2>Lab server</h2>
        <label class="field">
          laicpmsdb server URL
          <input type="url" value={state.form.serverUrl} oninput={(e) => edit('serverUrl', e.currentTarget.value)} spellcheck="false" />
          <span class="faint small">The Sessions tab opens <code>&lt;server&gt;/app/</code>; you sign in there.</span>
          {#if state.errors.serverUrl}<span class="error">{state.errors.serverUrl}</span>{/if}
        </label>
        <div class="row">
          <button class="btn" type="button" onclick={() => send({ type: 'back' })}>Back</button>
          <span class="spacer"></span>
          <button class="btn primary" type="submit">Continue</button>
        </div>
      </form>
    {:else if state.step === 'starting' || state.step === 'account'}
      <div class="glass panel stack">
        <div class="row"><span class="spinner" aria-hidden="true"></span><h2>Setting up laicpmsdb on this computer</h2></div>
        <ol class="progress small">
          <li class:done={!!status?.postgres.running}>PostgreSQL {status?.postgres.port ? `on port ${status.postgres.port}` : ''}</li>
          <li class:done={status?.phase === 'ready'}>laicpmsdb service {status?.service.port ? `on port ${status.service.port}` : ''}</li>
          <li>Your account{state.form.loadDemo ? ' and the demo data' : ''}</li>
        </ol>
        <p class="muted">{status?.step || 'Starting…'}</p>
        <p class="faint small">The first start unpacks PostgreSQL and creates the database; later starts take a few seconds.</p>
      </div>
    {:else if state.step === 'failed'}
      <div class="glass panel stack">
        <div class="row"><span class="dot" style="background: var(--danger)"></span><h2>{state.failure?.stage === 'account' ? 'Could not create the account' : 'Could not start laicpmsdb'}</h2></div>
        <p>{state.failure?.message}</p>
        {#if state.failure?.logTail}
          <pre class="log-tail">{state.failure.logTail}</pre>
        {/if}
        <p class="faint small">Logs: <code>{status?.logDir}</code></p>
        <div class="row">
          <button class="btn primary" onclick={() => send({ type: 'retry' })}>Retry</button>
          <button class="btn" onclick={() => send({ type: 'back' })}>Change settings</button>
          <button class="btn" onclick={openLogs}>Open logs</button>
          <span class="spacer"></span>
          <button class="btn" onclick={useServer}>Use a lab server instead</button>
        </div>
      </div>
    {:else}
      <div class="glass panel"><p>All set.</p></div>
    {/if}
  </div>
</section>

<style>
  .wizard { display: block; }
  .narrow { max-width: 760px; }
  .tight { gap: var(--space-2); }
  .tight h1, .tight p { margin: 0; }
  .choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: var(--space-4); }
  .choices > :global(.panel) { margin-top: 0; }
  .choice { text-align: left; cursor: pointer; display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); }
  .choice h2, .choice p { margin: 0; }
  .choice:hover:not([disabled]) { border-color: var(--accent); }
  .choice[disabled] { opacity: 0.55; cursor: not-allowed; }
  .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--space-3); }
  .check { align-items: flex-start; }
  .check input { margin-top: 0.2rem; }
  .progress { margin: 0; padding-left: 1.2rem; color: var(--text-muted); }
  .progress li.done { color: var(--ok); }
  .progress li.done::marker { content: '✓  '; }
</style>
