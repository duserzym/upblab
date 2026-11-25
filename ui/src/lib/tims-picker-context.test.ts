import { describe, expect, it } from 'vitest';
import { loadPickerContext, loadRecentMounts, magnification, mountGroups, pickerContextKey, recentMountsKey, rememberMount, savePickerContext, type LocalStore } from './tims-picker-context';
import type { PickerMount } from './tims-spot-finder';
const mount = (id: string, label = id, extra: Partial<PickerMount> = {}): PickerMount => ({ id, label, atlas: null, ...extra });
function store(): LocalStore { const rows = new Map<string, string>(); return { getItem: key => rows.get(key) ?? null, setItem: (key, value) => { rows.set(key, value); } }; }
describe('viewer-local capsule picker', () => {
  it('separates accounts, servers and batches with unambiguous keys', () => {
    const viewer = { server: 'https://invented.example/', account: 'a' };
    expect(pickerContextKey(viewer, 'b')).toBe(pickerContextKey({ ...viewer, server: 'https://invented.example' }, 'b'));
    expect(new Set([pickerContextKey(viewer, 'b'), pickerContextKey(viewer, 'c'), pickerContextKey({ ...viewer, account: 'c' }, 'b'), pickerContextKey({ ...viewer, server: 'https://other.example' }, 'b')]).size).toBe(4);
  });
  it('carries the mount, sample and search per batch, through local storage', () => {
    const storage = store(), viewer = { server: 'https://carry.example', account: 'viewer' };
    const value = { mount: mount('m', 'Invented 150X'), sample: 'Demo-A', search: '621' };
    savePickerContext(viewer, 'batch', value, storage);
    expect(JSON.parse(storage.getItem(pickerContextKey(viewer, 'batch'))!)).toEqual(value);
    expect(loadPickerContext(viewer, 'batch', storage)).toEqual(value);
    expect(loadPickerContext(viewer, 'other', storage)).toEqual({ sample: '', search: '' });
  });
  it('keeps the last five mounts, deduplicated and newest first', () => {
    const storage = store(), viewer = { server: 'https://recent.example', account: 'viewer' };
    for (let i = 0; i < 8; i++) rememberMount(viewer, mount(String(i)), storage);
    rememberMount(viewer, mount('4', 'Renamed'), storage);
    expect(loadRecentMounts(viewer, storage).map(m => m.id)).toEqual(['4', '7', '6', '5', '3']);
    expect(JSON.parse(storage.getItem(recentMountsKey(viewer))!)).toHaveLength(5);
    expect(loadRecentMounts({ ...viewer, account: 'someone-else' }, storage)).toEqual([]);
  });
  it('ignores corrupt storage and retains context in memory when storage is denied', () => {
    const viewer = { server: 'https://denied.example', account: 'viewer' };
    const denied = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } };
    expect(loadPickerContext(viewer, 'a', denied)).toEqual({ sample: '', search: '' });
    savePickerContext(viewer, 'a', { sample: 'Demo', search: '12' }, denied);
    expect(loadPickerContext(viewer, 'a', denied).search).toBe('12');
    expect(loadRecentMounts(viewer, { getItem: () => '{bad', setItem: () => {} })).toEqual([]);
    expect(loadPickerContext(viewer, 'b', { getItem: () => '{"mount":{"id":2},"search":12}', setItem: () => {} })).toEqual({ sample: '', search: '' });
  });
});
describe('mount list', () => {
  it('reads magnification metadata before parsing a label', () => {
    expect(magnification(mount('a', 'Demo_150X'))).toBe('150X');
    expect(magnification(mount('a', 'Demo 75.5×'))).toBe('75.5X');
    expect(magnification(mount('a', 'Demo_150X', { magnification: 200 }))).toBe('200X');
    expect(magnification(mount('a', 'Demo'))).toBe('Magnification unrecorded');
  });
  it('matches label, samples and projects ignoring case and separators', () => {
    const rows = [mount('a', 'Grenville_XS_150X', { sample_names: ['DEMO-A'], projects: [{ name: 'North_Study' }] })];
    for (const query of ['grenville-xs', 'demo a', 'NORTH-STUDY', '150x']) expect(mountGroups(rows, [], query)[0].mounts).toEqual(rows);
    expect(mountGroups(rows, [], 'absent')).toEqual([]);
  });
  it('pins recents in usage order and sorts the rest by group then label', () => {
    const rows = [mount('a', 'Zulu', { projects: ['Project B'] }), mount('b', 'Beta', { projects: ['Project A'] }), mount('c', 'Alpha', { projects: ['Project A'] }), mount('d', 'Delta', { sample_names: ['Sample C'] })];
    const groups = mountGroups(rows, [rows[0]], '');
    expect(groups.map(g => g.label)).toEqual(['Recent', 'Project A', 'Sample C']);
    expect(groups.flatMap(g => g.mounts.map(m => m.id))).toEqual(['a', 'c', 'b', 'd']);
  });
  it('filters Recent as well as other groups using the latest loaded metadata', () => {
    const recent = mount('a', 'Recent 150X', { projects: ['Old project'] });
    const rows = [{ ...recent, projects: ['Current project'] }, mount('b', 'Other 50X', { projects: ['Other project'] })];
    expect(mountGroups(rows, [recent], 'other-project')).toEqual([{ label: 'Other project', mounts: [rows[1]] }]);
    expect(mountGroups(rows, [recent], 'current-project')).toEqual([{ label: 'Recent', mounts: [rows[0]] }]);
    expect(mountGroups(rows, [recent], 'old-project')).toEqual([]);
  });
  it('uses a loaded list of 5,000 mounts without any detail requests', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => mount(`m-${i}`, `Synthetic ${i}`, { projects: [`Project ${i % 10}`], grain_count: 100 }));
    const start = performance.now();
    expect(mountGroups(rows, [], 'Synthetic').flatMap(g => g.mounts)).toHaveLength(5000);
    expect(mountGroups(rows, [], 'mismatch')).toEqual([]);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
