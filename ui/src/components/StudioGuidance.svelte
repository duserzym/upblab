<script lang="ts">
  import { shell } from '../lib/shell.svelte';
  let { from }: { from?: string } = $props();
  const request = $derived(shell.studio);
</script>
{#if request && (!from || request.from === from) && ['missing', 'failed', 'web'].includes(request.state)}
  <div class="panel stack small" role="status">
    {#if request.state === 'missing'}
      <strong>UPbRPy Studio is not installed on this computer</strong>
      <p>Install UPbRPy Studio.app into /Applications on macOS. On Windows, use the installer (%LOCALAPPDATA%\Programs\UPbRPy Studio). You can also set its path or a development checkout in Studio settings, then try again.</p>
    {:else if request.state === 'failed'}
      <strong>Could not open Studio</strong>
    {:else}
      <p>Open this session or run in Studio on this computer. Its installer registers upbr:// links.</p>
      <a class="btn" href={request.href}>Open in Studio</a>
      {#if request.minted}<p class="muted">The one-time sign-in link is valid for five minutes.</p>{/if}
    {/if}
    {#if request.error}<p class="muted">{request.error}</p>{/if}
    <button class="btn" onclick={() => void shell.show('settings')}>Studio settings</button>
  </div>
{/if}
<style>
  .panel {min-width:0;overflow-wrap:anywhere;} p {margin:0;} .btn {white-space:normal;} a {text-decoration:none;}
</style>
