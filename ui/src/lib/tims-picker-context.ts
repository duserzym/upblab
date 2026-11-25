import type { PickerMount } from './tims-spot-finder';
export interface PickerContext { mount?: PickerMount; sample: string; search: string }
export interface Viewer { server: string; account: string }
export interface LocalStore { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const pickerContextKey = (viewer: Viewer, batch: string) => `tims.picker.${JSON.stringify([viewer.server.replace(/\/+$/, ''), viewer.account, batch])}`;
export const recentMountsKey = (viewer: Viewer) => `tims.mounts.${JSON.stringify([viewer.server.replace(/\/+$/, ''), viewer.account])}`;
const memory = new Map<string, unknown>();
function browserStorage(): LocalStore | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
function readLocal(key: string, storage = browserStorage()): unknown {
  if (memory.has(key)) return memory.get(key);
  try { return JSON.parse(storage?.getItem(key) ?? 'null'); } catch { return null; }
}
function writeLocal(key: string, value: unknown, storage = browserStorage()) {
  memory.set(key, value);
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* Viewer preferences work in memory when storage is unavailable. */ }
}
function isMount(value: unknown): value is PickerMount {
  return !!value && typeof value === 'object' && typeof (value as PickerMount).id === 'string' && typeof (value as PickerMount).label === 'string';
}
export function loadPickerContext(viewer: Viewer, batch: string, storage?: LocalStore): PickerContext {
  const value = readLocal(pickerContextKey(viewer, batch), storage) as Partial<PickerContext> | null;
  return { ...(isMount(value?.mount) ? { mount: value.mount } : {}), sample: typeof value?.sample === 'string' ? value.sample : '', search: typeof value?.search === 'string' ? value.search : '' };
}
export function savePickerContext(viewer: Viewer, batch: string, context: PickerContext, storage?: LocalStore) { writeLocal(pickerContextKey(viewer, batch), context, storage); }
export function loadRecentMounts(viewer: Viewer, storage?: LocalStore): PickerMount[] {
  const value = readLocal(recentMountsKey(viewer), storage);
  return Array.isArray(value) ? [...new Map(value.filter(isMount).map(row => [row.id, row])).values()].slice(0, 5) : [];
}
export function rememberMount(viewer: Viewer, mount: PickerMount, storage?: LocalStore) {
  const next = [mount, ...loadRecentMounts(viewer, storage).filter(row => row.id !== mount.id)].slice(0, 5);
  writeLocal(recentMountsKey(viewer), next, storage); return next;
}
export const normaliseMount = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const projectNames = (mount: PickerMount) => (mount.projects ?? []).map(p => typeof p === 'string' ? p : p.name || p.code || '').filter(Boolean);
export function magnification(mount: PickerMount): string {
  if (mount.magnification != null && String(mount.magnification).trim()) return `${String(mount.magnification).replace(/[x×]$/i, '')}X`;
  return mount.label.match(/(?:^|[^\d])(\d+(?:\.\d+)?)\s*[x×](?=$|[^a-z])/i)?.[1]?.concat('X') ?? 'Magnification unrecorded';
}
export function mountGroups(mounts: readonly PickerMount[], recent: readonly PickerMount[], query: string) {
  const words = query.trim().split(/\s+/).map(normaliseMount).filter(Boolean);
  const matches = (mount: PickerMount) => { const text = normaliseMount([mount.label, ...(mount.sample_names ?? []), ...(mount.projects ?? []).flatMap(p => typeof p === 'string' ? [p] : [p.name ?? '', p.code ?? ''])].join(' ')); return words.every(word => text.includes(word)); };
  const rows = new Map([...recent, ...mounts].map(m => [m.id, m]));
  const pinned = recent.flatMap(m => { const latest = rows.get(m.id)!; return matches(latest) ? [latest] : []; });
  const pinnedIds = new Set(pinned.map(m => m.id)), groups = new Map<string, PickerMount[]>();
  for (const mount of rows.values()) {
    if (pinnedIds.has(mount.id) || !matches(mount)) continue;
    const group = projectNames(mount).sort((a, b) => a.localeCompare(b))[0] || [...(mount.sample_names ?? [])].sort()[0] || 'Other mounts';
    const list = groups.get(group) ?? []; list.push(mount); groups.set(group, list);
  }
  return [...(pinned.length ? [{ label: 'Recent', mounts: pinned }] : []), ...[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([label, mounts]) => ({ label, mounts: mounts.sort((a, b) => a.label.localeCompare(b.label)) }))];
}
