import type { SpikeDefault, VersionOut } from './tims-api';
/** A pinned batch or capsule assignment always wins over a newer lab default. */
export function defaultSpikeVersion(pinned: string, settings: SpikeDefault | null): VersionOut | null {
  if (pinned || !settings?.version || settings.version.status !== 'current' || settings.source === 'choose') return null;
  return settings.version;
}
