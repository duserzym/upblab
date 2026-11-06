import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  studioStatus: vi.fn(), getVersion: vi.fn(),
  platform: { isDesktop: false },
  localService: { status: null as null | { bundle: string; postgres: { version: string } } },
  shell: { studioConfig: { path: '/invented/Studio.app', checkout: '' } },
}));
vi.mock('./platform', () => ({ get isDesktop() { return mocks.platform.isDesktop; }, studioStatus: mocks.studioStatus }));
vi.mock('./localService.svelte', () => ({ localService: mocks.localService }));
vi.mock('./shell.svelte', () => ({ shell: mocks.shell }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: mocks.getVersion }));
import { collectVersions, moduleVersions, shellVersion } from './versions';
beforeEach(() => {
  mocks.platform.isDesktop = false;
  mocks.localService.status = null;
  mocks.studioStatus.mockResolvedValue({ found: false, path: null });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('uses the web build version and the native package version', async () => {
  expect(await shellVersion()).toBe(__APP_VERSION__);
  mocks.platform.isDesktop = true;
  mocks.getVersion.mockResolvedValue('0.2.0-beta.1');
  expect(await shellVersion()).toBe('0.2.0-beta.1');
});
it('reads release and local sources from the generated manifest', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ modules: [
    { name: 'grainatlas', version: '0.2.0', source: 'release' },
    { name: 'invented', version: '0.1.0', source: 'local' },
  ] }) } as Response);
  expect(await moduleVersions()).toEqual([
    { name: 'grainatlas', version: '0.2.0', source: 'release' },
    { name: 'invented', version: '0.1.0', source: 'local' },
  ]);
});
it('reports bundled service, PostgreSQL and detected checkout without starting anything', async () => {
  mocks.localService.status = { bundle: '0.3.0', postgres: { version: '17.11.0' } };
  mocks.studioStatus.mockResolvedValue({ found: true, kind: 'checkout', path: '/invented/UPbRPy' });
  expect(await collectVersions()).toMatchObject({
    service: '0.3.0', postgres: '17.11.0', studio: { found: true, kind: 'checkout', path: '/invented/UPbRPy' },
  });
  expect(mocks.studioStatus).toHaveBeenCalledWith(mocks.shell.studioConfig);
});
it('keeps absent bundles and detection failures readable', async () => {
  vi.mocked(fetch).mockRejectedValue(new Error('not bundled'));
  mocks.studioStatus.mockRejectedValue(new Error('not installed'));
  expect(await collectVersions()).toMatchObject({ modules: [], service: null, postgres: null, studio: { found: false, path: null } });
});
