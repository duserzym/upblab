<script lang="ts">
  import { oversight, READ_ONLY_REASON } from '../lib/oversight.svelte';
  import { fromFileList } from '../lib/drop';
  import { isDesktop, pickPaths, pickSessionPaths } from '../lib/platform';
  import { review } from '../lib/review.svelte';
  import { shell } from '../lib/shell.svelte';
  import type { Upload } from '../lib/upload.svelte';

  let { card, showChoose = true }: { card: Upload; showChoose?: boolean } = $props();
  let folderInput = $state<HTMLInputElement>();
  let filesInput = $state<HTMLInputElement>();
  const sessions = $derived(card.target === 'sessions');
  /** Start the upload (Home's action tiles call this directly, one click). */
  export async function choose() {
    if (oversight.viewAs) return;
    if (!isDesktop) { if (sessions) folderInput?.click(); else card.open = true; return; }
    try {
      const paths = await (sessions ? pickSessionPaths() : pickPaths(true));
      if (paths.length) await card.openPaths(paths);
    } catch (err) { card.error = String(err); }
  }
  function chosen(input: HTMLInputElement | undefined) {
    if (!input) return;
    if (input.files?.length) void card.openWebFiles(fromFileList(input.files));
    input.value = '';
  }
  function showReview() {
    const id = card.session?.id;
    if (!id) return;
    shell.show('review');
    void review.open({ kind: 'session', id, run: card.completeRun ?? 'preferred' });
  }
</script>

<section class="stack upload-card" data-testid="upload-{card.target}">
  <div class="row">
    {#if showChoose}<button class="btn primary" disabled={!!oversight.viewAs} title={oversight.viewAs ? READ_ONLY_REASON : undefined} onclick={() => void choose()}>{sessions ? 'Upload LA-ICP-MS session…' : 'Upload image set…'}</button>
    {:else}<button class="btn" disabled={!!oversight.viewAs} title={oversight.viewAs ? READ_ONLY_REASON : undefined} onclick={() => void choose()}>{sessions ? 'Choose another session…' : 'Choose another image set…'}</button>{/if}
    {#if !isDesktop && sessions}<button class="btn" disabled={!!oversight.viewAs} title={oversight.viewAs ? READ_ONLY_REASON : undefined} onclick={() => filesInput?.click()}>Choose session files…</button>{/if}
    {#if card.open || card.error}<button class="btn" aria-label="Dismiss {sessions ? 'session' : 'image'} upload" onclick={() => { card.close(); card.error = ''; }}>Dismiss</button>{/if}
  </div>
  <p class="muted small">{sessions ? 'Upload a Rich CSV, a per-spot folder, or both in Sessions. Then choose mounts and review the spot pairs.' : isDesktop ? 'SEM package folder, .grainatlas folder or .gaproj file. Opens in standalone grainatlas.' : 'Open grainatlas in a new browser tab and drop the files there.'}</p>
  {#if !sessions && !isDesktop}<a class="btn" href={shell.homeUrl('images')} target="_blank" rel="noopener">Open grainatlas</a>{/if}
  {#if !isDesktop}
    <input bind:this={folderInput} aria-label="{sessions ? 'Session' : 'Image set'} folder" type="file" webkitdirectory multiple hidden onchange={() => chosen(folderInput)} />
    {#if sessions}<input bind:this={filesInput} aria-label="Session files" type="file" multiple hidden onchange={() => chosen(filesInput)} />{/if}
  {/if}
  {#if card.open}
    <ol class="small" aria-label="{sessions ? 'Session' : 'Image'} upload progress" aria-live="polite">
      {#each card.steps as step}
        <li><span class="dot" style:background={step.done ? 'var(--ok)' : 'var(--text-faint)'} aria-hidden="true"></span><span>{step.text}{step.done ? ' ✓' : ''}</span></li>
      {/each}
    </ol>
    {#if sessions && card.session}
      <div class="row">
        <button class="btn" onclick={() => void shell.handleLink(`upbdb://session/${card.session!.id}`, 'home')}>Open in Sessions</button>
        <button class="btn" disabled={!!oversight.viewAs} title={oversight.viewAs ? READ_ONLY_REASON : undefined} onclick={() => void shell.handleLink(`upbr://session/${card.session!.id}`, 'home')}>Reduce in UPbRPy Studio</button>
        <button class="btn" disabled={!card.ready} onclick={showReview}>Review</button>
      </div>
      {#if !card.ready}<p class="faint small">Review is available once a reduction run is submitted from UPbRPy Studio</p>{/if}
    {/if}
  {/if}
  {#if card.error}<p class="error small" role="alert">{card.error}</p>{/if}
</section>

<style>
  .upload-card { min-width: 0; gap: var(--space-2); overflow-wrap: anywhere; }
  p { margin: 0; }
  ol { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--space-1); }
  li { display: flex; align-items: baseline; gap: var(--space-2); }
  .dot { flex: none; }
  select { max-width: 100%; min-width: 0; }
</style>
