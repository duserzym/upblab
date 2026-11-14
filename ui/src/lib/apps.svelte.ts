import { identity } from './identity.svelte';
import { isDesktop, launchGrainAtlas } from './platform';
import { shell } from './shell.svelte';
import { appWatch } from './app-watch.svelte';

export interface AtlasTarget { project: string | null; mount: string | null; spot?: string | null; grain?: string | null; revision?: number }
export interface StudioTarget { session: string | null; run: string | null; acquisition?: string | null }
export interface AppRequest<T> {
  target: T; from: string;
  state: 'launching' | 'launched' | 'missing' | 'failed' | 'fallback'; message: string;
}
class Apps {
  atlas = $state<AppRequest<AtlasTarget> | null>(null);
  studio = $state<AppRequest<StudioTarget> | null>(null);
}
export const apps = new Apps();
let atlasSequence = 0, studioSequence = 0;
export async function showInImages(target: AtlasTarget, from: string) {
  try {
    const link = target.project ? `grainatlas://project/${target.project}${target.spot ? `/spot/${target.spot}` : ''}`
      : target.mount ? `laicpmsdb://mount/${target.mount}` : null;
    if (link) await shell.handleLink(link, from);
  } catch { /* Openers never interrupt the current view with an exception. */ }
}
export async function editInAtlas(target: AtlasTarget, from: string) {
  const seq = ++atlasSequence;
  const origin = `${identity.target?.server}:${identity.revision}`;
  const current = () => origin === `${identity.target?.server}:${identity.revision}`;
  const request: AppRequest<AtlasTarget> = { target, from, state: 'launching', message: '' };
  apps.atlas = request;
  try {
    if (isDesktop && target.project) {
      const server = identity.target?.server;
      const code = await identity.handoff();
      if (code && server && current()) {
        await launchGrainAtlas(target.project, server, code, target.revision, target.spot, target.grain);
        if (seq === atlasSequence) apps.atlas = { ...request, state: 'launched' };
        if (current()) appWatch.atlas(target.project, target.mount);
        return;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('GrainAtlas is not installed')) {
      if (seq === atlasSequence) apps.atlas = { ...request, state: 'missing', message };
      return;
    }
    request.message = message;
  }
  if (seq === atlasSequence) {
    apps.atlas = { ...request, state: 'fallback' };
    if (current()) await showInImages(target, from);
  }
}
export async function openInStudio(target: StudioTarget, from: string) {
  const seq = ++studioSequence;
  const request: AppRequest<StudioTarget> = { target, from, state: 'launching', message: '' };
  apps.studio = request;
  if (!target.run && !target.session) {
    apps.studio = { ...request, state: 'failed', message: 'Not measured yet.' }; return;
  }
  try {
    const url = new URL(target.run ? `upbr://run/${target.run}` : `upbr://session/${target.session}`);
    if (target.acquisition) url.searchParams.set('acquisition', target.acquisition);
    url.searchParams.set('via', 'upblab');
    await shell.handleLink(url.href, from);
    if (seq !== studioSequence) return;
    const result = shell.studio;
    apps.studio = { ...request, state: result?.state === 'web' ? 'fallback' : result?.state ?? 'failed', message: result?.error ?? '' };
    if (target.session && (result?.state === 'launched' || result?.state === 'web')) appWatch.session(target.session);
  } catch (err) { if (seq === studioSequence) apps.studio = { ...request, state: 'failed', message: String(err) }; }
}
