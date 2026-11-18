import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('omits server and code from GrainAtlas IPC for a known copy, including local path opens', async () => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  const { connectivity } = await import('./connectivity.svelte');
  const platform = await import('./platform');
  const { invoke } = await import('@tauri-apps/api/core');
  connectivity.offlineCopy = 'invented copy';
  await platform.launchGrainAtlas('p', 'http://127.0.0.1:8765', 'never-send', 41, 'spot');
  expect(invoke).toHaveBeenLastCalledWith('grainatlas_launch', { project: 'p', revision: 41, spot: 'spot' });
  await platform.openGrainAtlasPaths(['/invented/project.gaproj']);
  expect(invoke).toHaveBeenLastCalledWith('grainatlas_open_paths', { paths: ['/invented/project.gaproj'] });
  expect(connectivity.grainAtlasLocal).toBe(true);
  connectivity.reset();
  await platform.launchGrainAtlas('p', 'https://lab', 'code');
  expect(invoke).toHaveBeenLastCalledWith('grainatlas_launch', { project: 'p', server: 'https://lab', code: 'code' });
});
