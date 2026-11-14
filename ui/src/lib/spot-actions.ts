import { spotAction } from '@lab/bridge';
import { editInAtlas, openInStudio } from './apps.svelte';
import { atlasSync } from './atlas-sync.svelte';
import { review } from './review.svelte';
import { shell } from './shell.svelte';

/** A module's explicit opener request shares Review's selection and app openers. */
export async function dispatchSpotAction(event: unknown, source: string): Promise<void> {
  if (source !== 'images' && source !== 'grainatlas') return;
  const action = spotAction(event);
  if (!action) return;
  const matches = review.rows.filter(row => row.atlasSpotId === action.spot && row.atlasProjectId === action.project);
  const row = matches.find(row => row.key === review.selectedKey) ?? matches[0];
  if (action.action === 'edit') {
    const status = atlasSync.status;
    await editInAtlas({ project: action.project, mount: row?.mountId ?? (status?.project === action.project ? status.mount : null), spot: action.spot }, 'review');
    return;
  }
  const target = row ?? await review.fromImages({ type: 'lab.spot.selected', project: action.project, spot: action.spot, via: 'user' });
  if (target && target.atlasSpotId === action.spot && target.atlasProjectId === action.project && (target.runId || target.sessionId)) {
    await openInStudio({ session: target.sessionId, run: target.runId, acquisition: target.acquisitionId }, 'review');
  } else {
    shell.note(`Images spot ${action.project}/${action.spot}`, 'review', 'No measured result found for this spot.');
  }
}
