<script lang="ts">
  import { identity } from '../lib/identity.svelte';
  import { savedReads, type CacheStatus } from '../lib/platform';
  import { savedData } from '../lib/saved-data.svelte';
  import { savedDate } from '../lib/connectivity.svelte';
  import { overview } from '../lib/overview.svelte';
  let { active }: { active: boolean } = $props();
  let status = $state<CacheStatus | null>(null);
  let confirm = $state(false), busy = $state(false), message = $state('');
  $effect(() => {
    const target = identity.target;
    void identity.revision;
    if (!active || !target) return;
    let current = true;
    status = null; confirm = false; message = '';
    void savedReads.status(target).then(value => { if (current) status = value; }).catch(err => { if (current) message = String(err); });
    return () => { current = false; };
  });
  async function save() {
    const target = identity.target;
    if (!target) return;
    busy = true; message = '';
    try {
      if (overview.state !== 'ready') await overview.load();
      const counts = await savedData.save(overview.sessions.map(row => row.session), overview.mounts.map(row => row.mount));
      message = `${counts.fetched} saved · ${counts.unchanged} already current · ${counts.failed} unavailable`;
      status = await savedReads.status(target);
    } catch (err) { message = String(err); }
    finally { busy = false; }
  }
  async function forget() {
    const target = identity.target;
    if (!target) return;
    busy = true;
    savedData.reset();
    try { await savedReads.clear(target); status = await savedReads.status(target); message = 'Saved server data removed.'; confirm = false; }
    catch (err) { message = String(err); }
    finally { busy = false; }
  }
</script>
<section class="glass panel stack" aria-label="Saved on this computer" data-testid="saved-data-settings">
  <h3>Saved on this computer</h3>
  <p class="muted small">UPb Lab keeps a copy of what you viewed on this computer, for each account, so Home and Review work when the server is down. Forget saved data removes this account's copy.</p>
  {#if status}<p class="small">{status.entries} entries · {(status.bytes / 1024 / 1024).toFixed(1)} MB · {status.newest ? `Newest ${savedDate(status.newest)}` : 'No saved data yet'}</p>{/if}
  <div class="row">
    <button class="btn small" disabled={busy || !identity.signedIn} onclick={() => void save()}>{busy ? 'Working…' : 'Save recent data now'}</button>
    <button class="btn small" disabled={busy || !status?.entries} onclick={() => confirm = !confirm}>Forget saved data</button>
  </div>
  {#if confirm}<div class="row small"><span>Remove this account's saved data from this computer?</span><button class="btn small" disabled={busy} onclick={() => void forget()}>Forget</button><button class="btn small" onclick={() => confirm = false}>Cancel</button></div>{/if}
  {#if message}<p class="muted small" role="status">{message}</p>{/if}
</section>
