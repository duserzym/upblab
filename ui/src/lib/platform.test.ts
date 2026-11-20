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
  expect(connectivity.grainAtlasLocal).toBe('home');
  connectivity.reset();
  await platform.launchGrainAtlas('p', 'https://lab', 'code');
  expect(invoke).toHaveBeenLastCalledWith('grainatlas_launch', { project: 'p', server: 'https://lab', code: 'code' });
});

it.each(['project', 'paths'])('does not announce a failed local %s launch', async kind => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  const { connectivity } = await import('./connectivity.svelte');
  const platform = await import('./platform');
  const { invoke } = await import('@tauri-apps/api/core');
  connectivity.offlineCopy = 'invented copy';
  connectivity.grainAtlasLocal = 'home';
  vi.mocked(invoke).mockRejectedValueOnce(new Error('GrainAtlas is not installed'));
  const launch = kind === 'project' ? platform.launchGrainAtlas('p', 'https://copy.invalid', 'never-send')
    : platform.openGrainAtlasPaths(['/invented/project.gaproj']);
  await expect(launch).rejects.toThrow('GrainAtlas is not installed');
  expect(connectivity.grainAtlasLocal).toBeNull();
});
it('passes both source grain and spot identities to the GrainAtlas host', async () => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  const platform = await import('./platform'); const { invoke } = await import('@tauri-apps/api/core');
  await platform.launchGrainAtlas('synthetic-project', 'https://lab', 'synthetic-code', undefined, 'synthetic-spot', 'synthetic-grain');
  expect(invoke).toHaveBeenLastCalledWith('grainatlas_launch', { project: 'synthetic-project', server: 'https://lab', code: 'synthetic-code', spot: 'synthetic-spot', grain: 'synthetic-grain' });
});
