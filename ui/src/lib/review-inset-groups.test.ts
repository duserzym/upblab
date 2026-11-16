import { describe, expect, it } from 'vitest';
import { groupSpots, normalise, type ReviewSpot } from './review-data';
import { groupUnregistered } from './review-selection';
import { reviewInsetGroups } from './review-inset-groups';

const spot = (key: string, sample: string, project: string | null, atlas: string | null, reference = false) => normalise({
  acquisition_id: key, label: key, sample_name: sample, atlas_project_id: project, atlas_spot_id: atlas,
  kind: reference ? 'primary_standard' : 'sample',
});
const a1 = spot('a1', 'Sample A', 'p', 's2'), a2 = spot('a2', 'Sample A', 'p', 's1');
const b = spot('b', 'Sample B', 'p', 's3'), other = spot('other', 'Sample A', 'q', 's4');
const reference = spot('ref', 'Reference', 'p', 's5', true);
const color = (name: string) => ({ 'Sample A': '#112233', 'Sample B': '#abcdef', Reference: '#445566' })[name] ?? '#778899';
const build = (rows: ReviewSpot[], groupView = true, order = groupSpots(rows).map(group => group.key)) =>
  reviewInsetGroups(rows, groupView, order, color);

describe('Review mount inset groups', () => {
  it('follows layer-tree order per project, sorts and deduplicates atlas spot ids, and uses Review colours', () => {
    const rows = [a1, a2, b, other, { ...a1, key: 'another-acquisition' }, reference];
    expect(build(rows, true, ['true:Reference', 'false:Sample B', 'false:Sample A'])).toEqual({
      p: [
        { name: 'Reference', color: '#445566', spots: ['s5'] },
        { name: 'Sample B', color: '#abcdef', spots: ['s3'] },
        { name: 'Sample A', color: '#112233', spots: ['s1', 's2'] },
      ],
      q: [{ name: 'Sample A', color: '#112233', spots: ['s4'] }],
    });
  });

  it('includes only already shown rows, respecting sample, text and hidden-spot filtering', () => {
    // Sample A and the reference are toggled off, and the second B spot is hidden/filtered out.
    expect(build([b])).toEqual({ p: [{ name: 'Sample B', color: '#abcdef', spots: ['s3'] }] });
    expect(build([reference])).toEqual({ p: [{ name: 'Reference', color: '#445566', spots: ['s5'] }] });
  });

  it('leaves out groups and projects without atlas spots', () => {
    expect(build([a1, spot('unmapped', 'Empty', 'empty-project', null), spot('no-project', 'Empty', null, 's')]))
      .toEqual({ p: [{ name: 'Sample A', color: '#112233', spots: ['s2'] }] });
    expect(build([])).toEqual({});
    expect(build([spot('unmapped', 'Empty', 'empty-project', null)])).toEqual({});
  });

  it('uses inferred group names and their colours for unregistered spots', () => {
    const rows = groupUnregistered([normalise({ acquisition_id: 'u', label: 'Sample A_1', atlas_project_id: 'p', atlas_spot_id: 'u' })]);
    expect(build(rows)).toEqual({ p: [{ name: 'Sample A', color: '#112233', spots: ['u'] }] });
  });

  it('omits groups at spot level and restores them at group level with the same shown rows', () => {
    expect(build([a1, b], false)).toBeUndefined();
    expect(build([], false)).toBeUndefined();
    expect(build([a1, b], true)?.p.map(group => group.name)).toEqual(['Sample A', 'Sample B']);
  });
});
