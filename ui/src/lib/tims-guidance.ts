import type { LocalStore, Viewer } from './tims-picker-context';
export const guidedSteps = ['Batch & capsule set', 'Grains', 'Spike', 'Chemistry', 'Review & complete'] as const;
export type GuidedStep = 0 | 1 | 2 | 3 | 4;
const key = (viewer: Viewer, suffix: string) => `tims.guidance.${JSON.stringify([viewer.server.replace(/\/+$/, ''), viewer.account, suffix])}`;
const memory = new Map<string, string>();
function storage(): LocalStore | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
function get(name: string, store = storage()) { try { return memory.get(name) ?? store?.getItem(name); } catch { return memory.get(name); } }
function set(name: string, value: string, store = storage()) { memory.set(name, value); try { store?.setItem(name, value); } catch { /* Viewer-local fallback. */ } }
export function loadGuidedStep(viewer: Viewer, batch: string, store?: LocalStore): GuidedStep {
  const value = Number(get(key(viewer, batch), store));
  return Number.isInteger(value) && value >= 0 && value < guidedSteps.length ? value as GuidedStep : 0;
}
export function saveGuidedStep(viewer: Viewer, batch: string, step: GuidedStep, store?: LocalStore) { set(key(viewer, batch), String(step), store); }
export function loadReadability(viewer: Viewer, store?: LocalStore) {
  const value = get(key(viewer, 'readability'), store);
  return value && Number.isFinite(Number(value)) && Number(value) > 0 ? value : '0.00001';
}
export function saveReadability(viewer: Viewer, value: string, store?: LocalStore) {
  if (Number.isFinite(Number(value)) && Number(value) > 0) set(key(viewer, 'readability'), value, store);
}

export type ListView = 'rows' | 'calendar' | 'lanes';
export function loadListView(viewer: Viewer, store?: LocalStore): ListView {
  const value = get(key(viewer, 'list-view'), store);
  return value === 'calendar' || value === 'lanes' ? value : 'rows';
}
export function saveListView(viewer: Viewer, value: ListView, store?: LocalStore) { set(key(viewer, 'list-view'), value, store); }
