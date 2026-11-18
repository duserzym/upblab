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
  {#each [[people, 'people'], [teams, 'teams'], [projectOptions, 'projects'], [labs, 'labs']] as [list, label]}
    {#if typeof list !== 'string'}
      {#if list.cursor}<button class="btn small" disabled={list.loading} onclick={() => void list.load(true)}>More {label}</button>{/if}
      {#if list.error}<p class="error small" role="status">{label}: {list.error} <button class="btn small" disabled={list.loading} onclick={() => void list.load(false, { force: true })}>Retry {label}</button></p>{/if}
    {/if}
  {/each}
</section>
{/if}
<style>
  .scope { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: end; padding: var(--space-2) var(--space-3); min-width: 0; }
  label { display: grid; gap: var(--space-1); font-size: 0.75rem; flex: 1 1 9rem; min-width: 0; }
  select { width: 100%; min-width: 0; max-width: 100%; }
  p { width: 100%; margin: 0; overflow-wrap: anywhere; }
</style>
