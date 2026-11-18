<script lang="ts">
  import { untrack } from 'svelte';
  import { identity } from '../lib/identity.svelte';
  import { oversight } from '../lib/oversight.svelte';
  import { people, teams, labs, projectOptions } from '../lib/records.svelte';
  let { active = true }: { active?: boolean } = $props();
  $effect(() => {
    if (!active || !identity.signedIn) return;
    void identity.revision;
    untrack(() => { for (const list of [people, teams, labs, projectOptions]) void list.load(); });
  });
</script>
{#if identity.signedIn}
<section class="glass panel scope" aria-label="Narrow data by person, team and project">
  <label>Person<select aria-label="Person" bind:value={oversight.filters.owner}><option value="">Any person</option>
    {#each people.rows as person (person.id)}<option value={person.username}>{person.display_name || person.username}</option>{/each}
  </select></label>
  <label>Group/team<select aria-label="Group/team" bind:value={oversight.filters.team}><option value="">Any team</option>
    {#each teams.rows as team (team.id)}<option value={team.name}>{team.name}</option>{/each}
  </select></label>
  <label>Project<select aria-label="Project" bind:value={oversight.filters.project}><option value="">Any project</option>
    {#each projectOptions.rows as project (project.id)}<option value={project.code}>{project.code}</option>{/each}
  </select></label>
  <label>Lab<select aria-label="Lab" bind:value={oversight.filters.lab}><option value="">Any lab</option>
    {#each labs.rows as lab (lab.id)}<option value={lab.handle}>{lab.name || lab.handle}</option>{/each}
  </select></label>
  <button class="btn small" onclick={() => oversight.filters = { owner: '', team: '', project: '', lab: '' }}>Clear filters</button>
  {#if [people, teams, projectOptions, labs].some(list => list.cursor || list.error)}
    <div class="extras">
      {#each [[people, 'people'], [teams, 'teams'], [projectOptions, 'projects'], [labs, 'labs']] as [list, label]}
        {#if typeof list !== 'string'}
          {#if list.cursor}<button class="btn small" disabled={list.loading} onclick={() => void list.load(true)}>More {label}</button>{/if}
          {#if list.error}<p class="error small" role="status">{label}: {list.error} <button class="btn small" disabled={list.loading} onclick={() => void list.load(false, { force: true })}>Retry {label}</button></p>{/if}
        {/if}
      {/each}
    </div>
  {/if}
</section>
{/if}
<style>
  .scope { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: end; padding: var(--space-2) var(--space-3); min-width: 0; }
  label { display: grid; gap: var(--space-1); font-size: 0.75rem; flex: 1 1 192px; min-width: min(100%, max(12rem, 192px)); }
  select { appearance: none; -webkit-appearance: none;
    width: 100%; min-width: 0; max-width: 100%; height: max(2.25rem, 36px); min-height: max(2.25rem, 36px); font-size: 0.9rem; line-height: 1.25rem;
    padding: var(--space-2) 2rem var(--space-2) var(--space-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    background-image: linear-gradient(45deg, transparent 50%, var(--text-muted) 50%), linear-gradient(135deg, var(--text-muted) 50%, transparent 50%);
    background-position: calc(100% - 1rem - 4px) 50%, calc(100% - 1rem) 50%; background-size: 4px 4px; background-repeat: no-repeat; }
  option { padding: 6px 10px; min-height: 28px; white-space: normal; }
  .scope > button { flex: none; white-space: nowrap; }
  .extras { display: flex; flex-wrap: wrap; gap: var(--space-2); flex-basis: 100%; min-width: 0; }
  p { width: 100%; margin: 0; overflow-wrap: anywhere; }
  @media (max-width: 1100px) { label { flex-basis: calc(50% - var(--space-1)); } }
</style>
