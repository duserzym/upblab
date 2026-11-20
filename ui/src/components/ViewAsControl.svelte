<script lang="ts">
  import { untrack } from 'svelte';
  import { identity } from '../lib/identity.svelte';
  import { oversight } from '../lib/oversight.svelte';
  import { viewAccounts } from '../lib/records.svelte';

  $effect(() => {
    void identity.revision;
    if (identity.signedIn && identity.account?.can_view_as && !oversight.viewAs)
      untrack(() => void viewAccounts.load());
  });
</script>

{#if oversight.viewAs}
  <div class="view-as-control chip small viewing" role="status" data-testid="view-as-banner" title="Viewing as {oversight.viewAs.name} (read-only)">
    <span>Viewing as</span>
    <strong class="viewed-name" title={oversight.viewAs.name}>{oversight.viewAs.name}</strong>
    <span>(read-only) ·</span>
    <button class="btn small" onclick={() => oversight.select(null)}>Exit</button>
  </div>
{:else if identity.signedIn && identity.account?.can_view_as}
  <div class="view-as-control small">
    <label>
      <span class="control-label">View as</span>
      <select aria-label="View as" value="" onchange={e => {
        const person = viewAccounts.rows.find(p => p.username === e.currentTarget.value);
        if (person) oversight.select({ username: person.username, name: person.display_name || person.username });
      }}>
        <option value="">Your own view</option>
        {#each viewAccounts.rows as person (person.id)}
          <option value={person.username}>{person.display_name || person.username} ({person.username})</option>
        {/each}
      </select>
    </label>
    {#if viewAccounts.cursor}
      <button class="btn small more" aria-label="More accounts" title="More accounts" disabled={viewAccounts.loading} onclick={() => void viewAccounts.load(true)}>+</button>
    {/if}
    {#if viewAccounts.error}
      <span class="chip small load-error" role="status" title={viewAccounts.error}>
        <span aria-hidden="true">!</span><span class="sr-only">{viewAccounts.error}</span>
      </span>
    {/if}
  </div>
{/if}

<style>
  .view-as-control, label { display: inline-flex; align-items: center; gap: var(--space-1); min-width: 0; white-space: nowrap; }
  .view-as-control { flex: 0 1 auto; min-width: min-content; }
  .control-label, .viewing > span, .btn, .load-error { flex: none; }
  select { width: 10rem; max-width: 10rem; overflow: hidden; text-overflow: ellipsis; padding: var(--space-1) var(--space-2); }
  /* The intrinsic minimum includes every fixed column and a readable slice of
     the name. Flex shrinking must never push Exit outside the warning chip. */
  .viewing { --name-min: 3rem; display: inline-grid; grid-template-columns: max-content minmax(var(--name-min), 1fr) max-content max-content; max-width: 24rem; color: var(--warning); border-color: var(--warning); background: color-mix(in srgb, var(--warning) 10%, var(--glass-strong)); cursor: default; }
  .viewed-name { min-width: var(--name-min); overflow: hidden; text-overflow: ellipsis; }
  .btn { padding: var(--space-1) var(--space-2); }
  .more { justify-content: center; width: 1.75rem; }
  .load-error { color: var(--danger); border-color: var(--danger); cursor: default; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  @media (max-width: 1100px) {
    .control-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    select { width: 8rem; }
    .viewing { padding-inline: var(--space-1); }
  }
</style>
