/** Local preferences only; a future server sync would enqueue these in ADR-0004's outbox. */
export interface HomePin { kind: 'session' | 'mount'; id: string; label: string; pinned_at: string }
export type HomePins = Record<string, HomePin[]>;
export const MAX_HOME_PINS = 50;

export function pinAccountKey(server: string | undefined, username: string | undefined): string | null {
  return server && username ? `${server}|${username}` : null;
}

function readPin(value: unknown): HomePin | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { kind, id, label, pinned_at } = value as Record<string, unknown>;
  if ((kind !== 'session' && kind !== 'mount') || typeof id !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(id)
    || typeof label !== 'string' || !label.trim() || label.length > 512 || /[\x00-\x1f]/.test(label)
    || typeof pinned_at !== 'string' || !Number.isFinite(Date.parse(pinned_at))) return null;
  return { kind, id, label: label.trim(), pinned_at };
}

/** Drop malformed entries, extra fields and duplicate items; preserve the saved pin order. */
export function readHomePins(value: unknown): HomePins {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, entries]) => {
    const separator = key.lastIndexOf('|');
    if (separator <= 0 || separator === key.length - 1 || key.length > 2048 || /[\x00-\x1f]/.test(key) || !Array.isArray(entries)) return [];
    const seen = new Set<string>();
    const pins: HomePin[] = [];
    for (const entry of entries) {
      const pin = readPin(entry);
      if (!pin || seen.has(`${pin.kind}|${pin.id}`)) continue;
      seen.add(`${pin.kind}|${pin.id}`);
      pins.push(pin);
      if (pins.length === MAX_HOME_PINS) break;
    }
    return [[key, pins]];
  }));
}

export function hasHomePin(pins: readonly HomePin[], kind: HomePin['kind'], id: string): boolean {
  return pins.some(pin => pin.kind === kind && pin.id === id);
}

/** Immutable account-scoped updates, applied before any persistence finishes. Full lists keep their oldest pins. */
export function toggleHomePin(all: HomePins, account: string, item: Omit<HomePin, 'pinned_at'>, at = new Date().toISOString()): HomePins {
  const pins = all[account] ?? [];
  if (hasHomePin(pins, item.kind, item.id))
    return { ...all, [account]: pins.filter(pin => pin.kind !== item.kind || pin.id !== item.id) };
  const pin = readPin({ ...item, pinned_at: at });
  if (!pin || pins.length >= MAX_HOME_PINS) return all;
  return { ...all, [account]: [...pins, pin] };
}
