import { localService } from './localService.svelte';
import { isDesktop, studioStatus, type StudioStatus } from './platform';
import { shell } from './shell.svelte';

export interface ModuleVersion {
  name: string;
  version: string;
  source: 'release' | 'local';
}
export interface BuildVersions {
  shell: string;
  modules: ModuleVersion[];
  service: string | null;
  postgres: string | null;
  studio: StudioStatus;
}
export async function shellVersion(): Promise<string> {
  if (!isDesktop) return __APP_VERSION__;
  return (await import('@tauri-apps/api/app')).getVersion();
}

/** Only reports the manifest produced by fetch-modules, never another checkout's data. */
export async function moduleVersions(): Promise<ModuleVersion[]> {
  try {
    const response = await fetch('./modules/manifest.json', { cache: 'no-store' });
    if (!response.ok) return [];
    const data = await response.json() as { modules?: { name: string; version: string; source: string }[] };
    return (Array.isArray(data.modules) ? data.modules : []).map((m) => ({
      name: m.name, version: m.version, source: m.source === 'release' || /^https?:\/\//.test(m.source) ? 'release' : 'local',
    }));
  } catch { return []; }
}

export async function collectVersions(): Promise<BuildVersions> {
  const status = localService.status;
  const config = shell.studioConfig;
  const [version, modules, studio] = await Promise.all([
    shellVersion().catch(() => __APP_VERSION__), moduleVersions(),
    studioStatus(config).catch(() => ({ found: false, path: null })),
  ]);
  return { shell: version, modules, service: status?.bundle ?? null, postgres: status?.postgres.version ?? null, studio };
}
