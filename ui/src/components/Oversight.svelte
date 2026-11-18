<script lang="ts">
  import { untrack, onDestroy, tick } from 'svelte';
  import { identity } from '../lib/identity.svelte';
  import { oversight } from '../lib/oversight.svelte';
  import { viewAccounts } from '../lib/records.svelte';
  import { openOverlay, closeOverlay } from '../lib/overlays.svelte';
  let chosen = $state('');
  let cancelButton = $state<HTMLButtonElement>();
  $effect(() => { if (oversight.pending) void tick().then(() => cancelButton?.focus()); });
  $effect(() => {
    void identity.revision;
    if (identity.signedIn && identity.account?.can_view_as && !oversight.viewAs)
      untrack(() => void viewAccounts.load());
  });
  $effect.pre(() => {
    if (oversight.pending) openOverlay('on-behalf'); else closeOverlay('on-behalf');
  });
  onDestroy(() => { oversight.confirm(false); closeOverlay('on-behalf'); });
</script>
<svelte:window onkeydown={e => { if (e.key === 'Escape' && oversight.pending) oversight.confirm(false); }} />
{#if oversight.viewAs}
  <div class="oversight-bar glass" role="status" data-testid="view-as-banner">
    <strong>Viewing as {oversight.viewAs.name} (read-only)</strong>
    <button class="btn small" onclick={() => { chosen = ''; oversight.select(null); }}>Exit</button>
  </div>
{:else if identity.signedIn && identity.account?.can_view_as}
  <div class="oversight-bar">
    <label class="small">View as <select aria-label="View as" bind:value={chosen} onchange={() => {
      const person = viewAccounts.rows.find(p => p.username === chosen);
      if (person) oversight.select({ username: person.username, name: person.display_name || person.username });
    }}><option value="">Your own view</option>
      {#each viewAccounts.rows as person (person.id)}<option value={person.username}>{person.display_name || person.username} ({person.username})</option>{/each}
    </select></label>
    {#if viewAccounts.cursor}<button class="btn small" disabled={viewAccounts.loading} onclick={() => void viewAccounts.load(true)}>More accounts</button>{/if}
    {#if viewAccounts.error}<span class="error small">{viewAccounts.error}</span>{/if}
  </div>
{/if}
{#if oversight.onBehalf}<div class="oversight-bar glass" role="status">Editing on behalf of {oversight.owner}</div>{/if}
{#if oversight.pending}
  <div class="backdrop">
    <div class="glass panel stack confirmation" role="dialog" aria-modal="true" aria-labelledby="on-behalf-title" tabindex="-1" onkeydown={e => { if (e.key === 'Tab') { const buttons = Array.from(e.currentTarget.querySelectorAll('button')); const at = buttons.indexOf(document.activeElement as HTMLButtonElement); e.preventDefault(); buttons[(at + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus(); } }}>
      <h2 id="on-behalf-title">Confirm on-behalf change</h2>
      <p>This data belongs to <strong>{oversight.pending.owner}</strong>. Make this change on their behalf?</p>
      <p class="small muted">{oversight.pending.message}</p>
      <p class="small muted">Consent applies to this operation only. The server records who made the change.</p>
      <div class="row"><button class="btn" bind:this={cancelButton} onclick={() => oversight.confirm(false)}>Cancel</button><button class="btn primary" onclick={() => oversight.confirm(true)}>Confirm on behalf</button></div>
    </div>
  </div>
{/if}
<style>
  .oversight-bar { flex: none; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: var(--space-2); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--glass-edge); min-width: 0; overflow-wrap: anywhere; }
  .oversight-bar:has(strong) { border-bottom-color: var(--warning); }
  select { max-width: min(24rem, 60vw); }
  .backdrop { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: var(--space-4); background: color-mix(in srgb, var(--text) 25%, transparent); }
  .confirmation { width: min(32rem, 100%); max-height: calc(100vh - 4rem); overflow: auto; overflow-wrap: anywhere; background: var(--bg); }
  h2, p { margin: 0; }
</style>
