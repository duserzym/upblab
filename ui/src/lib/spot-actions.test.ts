import { beforeEach, expect, it, vi } from 'vitest';
import { normalise } from './review-data';
import { rows } from '../../tests/fixtures/review';
import { atlasStatusFixture } from '../../tests/fixtures/atlas-sync';
vi.mock('./apps.svelte', () => ({ editInAtlas: vi.fn(async () => {}), openInStudio: vi.fn(async () => {}) }));
vi.mock('./atlas-sync.svelte', () => ({ atlasSync: { status: null } }));
vi.mock('./review.svelte', () => ({ review: { rows: [], selectedKey: null, fromImages: vi.fn() } }));
vi.mock('./shell.svelte', () => ({ shell: { note: vi.fn() } }));
const { dispatchSpotAction } = await import('./spot-actions');
const { editInAtlas, openInStudio } = await import('./apps.svelte');
const { atlasSync } = await import('./atlas-sync.svelte');
const { review } = await import('./review.svelte');
const { shell } = await import('./shell.svelte');
const spot = normalise({ ...rows[1], session_id: 'session-demo' });
const event = (action = 'edit', project = 'project-demo', id = 'atlas-2') => ({ type: 'lab.spot.action', action, project, spot: id });
beforeEach(() => {
  vi.clearAllMocks();
  review.rows = [spot]; review.selectedKey = spot.key;
  atlasSync.status = null;
  vi.mocked(review.fromImages).mockResolvedValue(undefined);
});
it('opens the requested spot in the editor with its Review mount', async () => {
  await dispatchSpotAction(event(), 'images');
  expect(editInAtlas).toHaveBeenCalledExactlyOnceWith({ project: 'project-demo', mount: 'mount-demo', spot: 'atlas-2' }, 'review');
  expect(openInStudio).not.toHaveBeenCalled();
});
it('uses only a matching project status when no Review mount is loaded', async () => {
  review.rows = [];
  atlasSync.status = atlasStatusFixture;
  await dispatchSpotAction(event(), 'grainatlas');
  expect(editInAtlas).toHaveBeenLastCalledWith(expect.objectContaining({ mount: atlasStatusFixture.mount }), 'review');
  await dispatchSpotAction(event('edit', 'other-project'), 'grainatlas');
  expect(editInAtlas).toHaveBeenLastCalledWith({ project: 'other-project', mount: null, spot: 'atlas-2' }, 'review');
});
it('opens a loaded result in Studio, matching both atlas spot and project', async () => {
  review.rows.unshift({ ...spot, key: 'other', atlasProjectId: 'other-project', runId: 'wrong-run' });
  await dispatchSpotAction(event('studio'), 'grainatlas');
  expect(openInStudio).toHaveBeenCalledExactlyOnceWith({ session: 'session-demo', run: 'run-preferred', acquisition: 'acq-2' }, 'review');
  expect(review.fromImages).not.toHaveBeenCalled();
});
it('looks up and selects an unloaded result before opening Studio', async () => {
  review.rows = [];
  vi.mocked(review.fromImages).mockResolvedValue(spot);
  await dispatchSpotAction(event('studio'), 'images');
  expect(review.fromImages).toHaveBeenCalledExactlyOnceWith({ type: 'lab.spot.selected', project: 'project-demo', spot: 'atlas-2', via: 'user' });
  expect(openInStudio).toHaveBeenCalledWith({ session: 'session-demo', run: 'run-preferred', acquisition: 'acq-2' }, 'review');
});
it('records a missing or unmeasured result and does not launch an app', async () => {
  review.rows = [];
  for (const result of [undefined, { ...spot, sessionId: null, runId: null }, { ...spot, atlasProjectId: 'other' }]) {
    vi.mocked(review.fromImages).mockResolvedValue(result);
    await dispatchSpotAction(event('studio'), 'images');
  }
  expect(shell.note).toHaveBeenCalledTimes(3);
  expect(openInStudio).not.toHaveBeenCalled();
  expect(editInAtlas).not.toHaveBeenCalled();
});
it('ignores malformed requests and sources outside Images', async () => {
  for (const bad of [event('unknown'), event('edit', 'bad/id'), event('studio', 'project-demo', ''), { type: 'lab.spot.action' }])
    await dispatchSpotAction(bad, 'images');
  await dispatchSpotAction(event(), 'sessions');
  expect(editInAtlas).not.toHaveBeenCalled();
  expect(openInStudio).not.toHaveBeenCalled();
  expect(review.fromImages).not.toHaveBeenCalled();
  expect(shell.note).not.toHaveBeenCalled();
});
