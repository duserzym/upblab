import { oversight } from './oversight.svelte';
import { connectivity } from './connectivity.svelte';
import { identity } from './identity.svelte';
import { isDesktop, launchGrainAtlas, studioStatus } from './platform';
import { atlasEditorUrl } from './links';
import { shell } from './shell.svelte';
import { appWatch } from './app-watch.svelte';
import { overview } from './overview.svelte';
import { review } from './review.svelte';
import { compareStudioVersions } from './studio-version';

export interface AtlasTarget { project: string | null; mount: string | null; spot?: string | null; grain?: string | null; revision?: number }
export interface StudioTarget { session: string | null; run: string | null; acquisition?: string | null }
export interface AppRequest<T> {
  target: T; from: string;
  state: 'launching' | 'launched' | 'missing' | 'failed' | 'fallback' | 'outdated'; message: string;
}
class Apps {
  atlas = $state<AppRequest<AtlasTarget> | null>(null);
  studio = $state<AppRequest<StudioTarget> | null>(null);
}
export const apps = new Apps();
let atlasSequence = 0, studioSequence = 0;
export async function editInAtlas(target: AtlasTarget, from: string) {
  oversight.assertWritable();
  const seq = ++atlasSequence;
  const origin = `${identity.target?.server}:${identity.revision}`;
  const current = () => origin === `${identity.target?.server}:${identity.revision}`;
  const request: AppRequest<AtlasTarget> = { target, from, state: 'launching', message: '' };
  apps.atlas = request;
  connectivity.grainAtlasLocal = null;
  try {
    if (!target.project) throw new Error('No grainatlas project is available for this mount.');
    if (connectivity.offlineCopy) {
      const copy = connectivity.offlineCopy;
      const view = shell.view === 'review' ? 'review' : 'home';
      if (isDesktop) {
        await launchGrainAtlas(target.project, undefined, undefined, target.revision, target.spot, target.grain);
        if (current() && copy === connectivity.offlineCopy) connectivity.grainAtlasLocal = view;
      } else {
        const url = new URL(atlasEditorUrl(shell.homeUrl('images'), target.project, target.spot, target.grain), location.href);
        url.searchParams.delete('server'); url.searchParams.delete('code');
        window.open(url.href, '_blank', 'noopener');
      }
      if (seq === atlasSequence) apps.atlas = { ...request, state: isDesktop ? 'launched' : 'fallback' };
      return;
    }
    if (!isDesktop) {
      window.open(atlasEditorUrl(shell.homeUrl('images'), target.project, target.spot, target.grain), '_blank', 'noopener');
      if (seq === atlasSequence) apps.atlas = { ...request, state: 'fallback' };
      if (current() && from !== 'tims') appWatch.atlas(target.project, target.mount);
      return;
    }
    const server = identity.target?.server;
    const code = await identity.handoff();
    if (!current()) return;
    if (!server || !code) throw new Error('Sign in to open this project in GrainAtlas.');
    await launchGrainAtlas(target.project, server, code, target.revision, target.spot, target.grain);
    if (seq === atlasSequence) apps.atlas = { ...request, state: 'launched' };
    if (current() && from !== 'tims') appWatch.atlas(target.project, target.mount);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (seq === atlasSequence) apps.atlas = { ...request, state: message.startsWith('GrainAtlas is not installed') ? 'missing' : 'failed', message };
  }
}
/** Inspect only metadata already loaded for this exact run or a session's preferred run. */
function loadedStudioVersion(target: StudioTarget): string | undefined {
  const summaries = overview.sessions.flatMap(row => [row.preferred, row.latest, row.completed, row.session.preferred_run]);
  const runs = [...review.runs, ...summaries, ...review.sessions.map(session => session.preferred_run)];
  const session = overview.sessions.find(row => row.session.id === target.session);
  const runId = target.run ?? review.runs.find(run => run.session_id === target.session && run.is_preferred_for_session)?.id
    ?? session?.preferred?.id ?? session?.session.preferred_run?.id
    ?? review.sessions.find(session => session.id === target.session)?.preferred_run?.id
    ?? (review.scope?.kind === 'session' && review.scope.id === target.session && review.run?.is_preferred ? review.run.run_id : undefined)
    ?? review.rows.find(row => row.sessionId === target.session && row.runId && review.runInfo[row.runId]?.is_preferred)?.runId;
  if (!runId) return undefined;
  return runs.find(run => run?.id === runId && run.upbrpy_version)?.upbrpy_version
    ?? review.runInfo[runId]?.upbrpy_version
    ?? (review.run?.run_id === runId ? review.run.upbrpy_version : undefined);
}

export async function openInStudio(target: StudioTarget, from: string) {
  await requestStudio(target, from, false);
}

export async function openStudioAnyway() {
  const request = apps.studio;
  if (request?.state === 'outdated') await requestStudio(request.target, request.from, true);
}

async function requestStudio(target: StudioTarget, from: string, allowOutdated: boolean) {
  oversight.assertWritable();
  const seq = ++studioSequence;
  const origin = `${identity.target?.server}:${identity.revision}`;
  const current = () => seq === studioSequence && apps.studio !== null && origin === `${identity.target?.server}:${identity.revision}`;
  const request: AppRequest<StudioTarget> = { target, from, state: 'launching', message: '' };
  apps.studio = request;
  if (!target.run && !target.session) {
    apps.studio = { ...request, state: 'failed', message: 'Not measured yet.' }; return;
  }
  try {
    const saved = isDesktop && !allowOutdated ? loadedStudioVersion(target) : undefined;
    if (saved) {
      const status = await studioStatus(shell.studioConfig).catch(() => null);
      if (!current()) return;
      if (status?.found && compareStudioVersions(status.version, saved) === -1) {
        apps.studio = { ...request, state: 'outdated', message: `Saved by UPbRPy Studio ${saved}; you have ${status.version}. Update Studio to open it.` };
        return;
      }
    }
    const url = new URL(target.run ? `upbr://run/${target.run}` : `upbr://session/${target.session}`);
    if (target.acquisition) url.searchParams.set('acquisition', target.acquisition);
    url.searchParams.set('via', 'upblab');
    await shell.handleLink(url.href, from);
    if (!current()) return;
    const result = shell.studio;
    apps.studio = { ...request, state: result?.state === 'web' ? 'fallback' : result?.state ?? 'failed', message: result?.error ?? '' };
    if (target.session && (result?.state === 'launched' || result?.state === 'web')) appWatch.session(target.session);
  } catch (err) { if (current()) apps.studio = { ...request, state: 'failed', message: String(err) }; }
}
