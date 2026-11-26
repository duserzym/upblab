import { expect, it } from 'vitest';
import { loadGuidedStep, saveGuidedStep, loadReadability, saveReadability, loadListView, saveListView } from './tims-guidance';
const store = () => { const rows = new Map<string, string>(); return { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); } }; };
it('remembers steps per account, server and batch with trailing URL slash normalization', () => {
  const storage = store(), viewer = { server: 'https://invented.example/', account: 'guide-one' };
  expect(loadGuidedStep(viewer, 'new', storage)).toBe(0);
  saveGuidedStep(viewer, 'b', 2, storage);
  expect(loadGuidedStep({ ...viewer, server: 'https://invented.example' }, 'b', storage)).toBe(2);
  expect(loadGuidedStep({ ...viewer, account: 'guide-two' }, 'b', storage)).toBe(0);
  expect(loadGuidedStep({ ...viewer, server: 'https://other.example' }, 'b', storage)).toBe(0);
  expect(loadGuidedStep(viewer, 'other', storage)).toBe(0);
});
it('guards unavailable storage and rejects invalid persisted steps', () => {
  const viewer = { server: 'invented', account: 'blocked' };
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  expect(loadGuidedStep(viewer, 'b', blocked)).toBe(0);
  saveGuidedStep(viewer, 'b', 3, blocked);
  expect(loadGuidedStep(viewer, 'b', blocked)).toBe(3);
  expect(loadGuidedStep(viewer, 'invalid', { ...blocked, getItem: () => '99' })).toBe(0);
});
it('defaults readability to 0.00001 g, retains last positive reading per viewer, never stores invalid input', () => {
  const storage = store(), viewer = { server: 'invented', account: 'balance' };
  expect(loadReadability(viewer, storage)).toBe('0.00001');
  saveReadability(viewer, '0.000001', storage);
  saveReadability(viewer, '-1', storage); saveReadability(viewer, 'bad', storage);
  expect(loadReadability(viewer, storage)).toBe('0.000001');
  expect(loadReadability({ ...viewer, account: 'another' }, storage)).toBe('0.00001');
});

it('remembers list views per viewer, defaults invalid views and falls back in memory', () => {
  const storage = store(), viewer = { server: 'https://list.example/', account: 'one' };
  expect(loadListView(viewer, storage)).toBe('rows');
  saveListView(viewer, 'calendar', storage);
  expect(loadListView({ ...viewer, server: 'https://list.example' }, storage)).toBe('calendar');
  expect(loadListView({ ...viewer, account: 'two' }, storage)).toBe('rows');
  expect(loadListView({ ...viewer, server: 'other' }, storage)).toBe('rows');
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  saveListView({ ...viewer, account: 'blocked-list' }, 'lanes', blocked);
  expect(loadListView({ ...viewer, account: 'blocked-list' }, blocked)).toBe('lanes');
  expect(loadListView({ ...viewer, account: 'invalid-list' }, { ...storage, getItem: () => 'tiles' })).toBe('rows');
});
