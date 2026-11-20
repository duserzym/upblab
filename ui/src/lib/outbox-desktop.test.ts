import { expect, it, vi } from 'vitest';
vi.mock('./platform', () => ({ isDesktop: true }));
vi.mock('./identity.svelte', () => ({ identity: { signedIn: false } }));
const { values, store, load } = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const store = { get: vi.fn(async (key: string) => values.get(key)), set: vi.fn(async (key: string, value: unknown) => { values.set(key, structuredClone(value)); }), save: vi.fn(async () => {}) };
  return { values, store, load: vi.fn(async () => store) };
});
vi.mock('@tauri-apps/plugin-store', () => ({ load }));
import { durableOutboxStorage } from './outbox.svelte';
it('uses the desktop outbox store with explicit durable saves', async () => {
  await durableOutboxStorage.write('synthetic-account-server', []);
  expect(load).toHaveBeenCalledWith('outbox.json', { defaults: {}, autoSave: false }); expect(store.save).toHaveBeenCalledTimes(1);
  expect(values.get('synthetic-account-server')).toEqual([]); expect(await durableOutboxStorage.read('synthetic-account-server')).toEqual([]);
});
