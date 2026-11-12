import { describe, expect, it } from 'vitest';
import { normalise, spotGroupKey } from './review-data';
import { allShown, defaultShown, filterRows, groupState, noneShown, rangeToggle, recallShown, reconcile, rememberShown, setGroup, soloSample, toggleSample } from './sample-filter';

const samples = [
  { key: 'a', reference: false }, { key: 'b', reference: false },
  { key: 'c', reference: true }, { key: 'd', reference: true },
];
const ordered = samples.map(sample => sample.key);

describe('sample display filters', () => {
  it('defaults to samples, or all standards when there are no samples', () => {
    expect(defaultShown(samples)).toEqual(['a', 'b']);
    expect(defaultShown(samples.slice(2))).toEqual(['c', 'd']);
    expect(defaultShown(samples.slice(0, 2))).toEqual(['a', 'b']);
    expect(defaultShown([])).toEqual([]);
  });

  it('toggles independently in chip order without mutating inputs', () => {
    const shown = ['b'];
    expect(toggleSample(shown, ordered, 'a')).toEqual(['a', 'b']);
    expect(toggleSample(shown, ordered, 'b')).toEqual([]);
    expect(toggleSample(shown, ordered, 'missing')).toEqual(['b']);
    expect(shown).toEqual(['b']);
    expect(soloSample('c')).toEqual(['c']);
    expect(allShown(ordered)).toEqual(ordered);
    expect(allShown(ordered)).not.toBe(ordered);
    expect(noneShown()).toEqual([]);
  });

  it('switches whole groups while preserving the other group', () => {
    expect(setGroup(['a', 'c'], samples, false, true)).toEqual(['a', 'b', 'c']);
    expect(setGroup(['a', 'c'], samples, false, false)).toEqual(['c']);
    expect(setGroup(['a'], samples, true, true)).toEqual(['a', 'c', 'd']);
    expect(setGroup(ordered, samples, true, false)).toEqual(['a', 'b']);
    expect(setGroup([], [], true, true)).toEqual([]);
  });

  it('reports all, none and partial group states independently', () => {
    expect(groupState(['a', 'b'], samples, false)).toBe('all');
    expect(groupState(['a', 'b'], samples, true)).toBe('none');
    expect(groupState(['a', 'c'], samples, false)).toBe('some');
    expect(groupState(['a', 'c'], samples, true)).toBe('some');
    expect(groupState(['c', 'd'], samples, true)).toBe('all');
    expect(groupState([], [], false)).toBe('none');
  });

  it('sets forward and reverse inclusive ranges to the clicked chip’s new state', () => {
    expect(rangeToggle(['a'], ordered, 'b', 'd')).toEqual(ordered);
    expect(rangeToggle(['a'], ordered, 'd', 'b')).toEqual(ordered);
    expect(rangeToggle(['a', 'c', 'd'], ordered, 'b', 'd')).toEqual(['a']);
    expect(rangeToggle(ordered, ordered, 'd', 'b')).toEqual(['a']);
    expect(rangeToggle(['a'], ordered, 'a', 'a')).toEqual([]);
    expect(rangeToggle([], ordered, 'c', 'c')).toEqual(['c']);
  });

  it('falls back to a single toggle without a valid anchor or target', () => {
    expect(rangeToggle(['a'], ordered, null, 'b')).toEqual(['a', 'b']);
    expect(rangeToggle(['a'], ordered, 'removed', 'a')).toEqual([]);
    expect(rangeToggle(['a'], ordered, 'a', 'removed')).toEqual(['a']);
    expect(rangeToggle([], [], null, 'a')).toEqual([]);
  });

  it('reconciles remembered keys, preserves deliberate emptiness and defaults only when absent', () => {
    expect(reconcile(undefined, ordered, samples)).toEqual(['a', 'b']);
    expect(reconcile([], ordered, samples)).toEqual([]);
    expect(reconcile(['d', 'gone', 'a', 'a'], ordered, samples)).toEqual(['a', 'd']);
    expect(reconcile(['gone'], ordered, samples)).toEqual([]);
    expect(reconcile(undefined, [], [])).toEqual([]);
  });

  it('filters by group keys, including samples and standards sharing a name', () => {
    const rows = [normalise({ label: 'one', sample_name: 'Shared' }), normalise({ label: 'two', sample_name: 'Shared', kind: 'primary_standard' })];
    expect(filterRows(rows, [spotGroupKey(rows[0])])).toEqual([rows[0]]);
    expect(filterRows(rows, [spotGroupKey(rows[1])])).toEqual([rows[1]]);
    expect(filterRows(rows, rows.map(spotGroupKey))).toEqual(rows);
    expect(filterRows(rows, [])).toEqual([]);
    expect(rows).toHaveLength(2);
  });

  it('remembers scopes and grouping modes separately and copies both ways', () => {
    expect(recallShown('session:unseen|grouped')).toBeUndefined();
    const shown = ['a'];
    rememberShown('session:test|grouped', shown);
    rememberShown('session:test|ungrouped', ['b']);
    rememberShown('mount:test|grouped', []);
    shown.push('c');
    const recalled = recallShown('session:test|grouped')!;
    recalled.push('d');
    expect(recallShown('session:test|grouped')).toEqual(['a']);
    expect(recallShown('session:test|ungrouped')).toEqual(['b']);
    expect(recallShown('mount:test|grouped')).toEqual([]);
    rememberShown('session:test|grouped', []);
    expect(recallShown('session:test|grouped')).toEqual([]);
  });
});
