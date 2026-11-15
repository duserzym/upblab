<!--
  "This computer" mode while UPbDB is not (yet) answering: progress,
  or the failure with the log tail, Retry, and a way out to a lab server.
-->
<script lang="ts">
  import { localService } from '../lib/localService.svelte';
  import { localServiceApi } from '../lib/platform';
  import { shell } from '../lib/shell.svelte';

  const s = $derived(localService.status);
  const busy = $derived(s?.phase === 'starting' || s?.phase === 'stopping');
</script>

<div class="glass panel card stack">
  {#if !s || busy}
    <div class="row"><span class="spinner" aria-hidden="true"></span><h2>Starting UPbDB on this computer…</h2></div>
    <p class="muted">{s?.step || 'Starting…'}</p>
    {#if s?.postgres.running}<p class="faint small">PostgreSQL is running on port {s.postgres.port}.</p>{/if}
  {:else if s.phase === 'failed'}
    <div class="row"><span class="dot" style="background: var(--danger)"></span><h2>UPbDB did not start</h2></div>
    <p>{s.error}</p>
    {#if s.logTail}<pre class="log-tail">{s.logTail}</pre>{/if}
    <p class="faint small">Logs: <code>{s.logDir}</code></p>
    <div class="row">
      <button class="btn primary" onclick={() => void localService.start()}>Retry</button>
      <button class="btn" onclick={() => void localServiceApi.openLogs()}>Open logs</button>
      <span class="spacer"></span>
      <button class="btn" onclick={() => shell.show('settings')}>Use a lab server…</button>
    </div>
  {:else}
    <div class="row"><span class="dot" style="background: var(--text-faint)"></span><h2>UPbDB is stopped</h2></div>
    <p class="muted">"This computer" mode is selected, but the local UPbDB is not running.</p>
    <div class="row">
      <button class="btn primary" onclick={() => void localService.start()}>Start</button>
      <button class="btn" onclick={() => shell.show('settings')}>Settings</button>
    </div>
  {/if}
</div>

