import { describe, expect, it, vi } from 'vitest';
import type { ViewerRegionEvent } from '@lab/bridge';
import { imageMount, imagesTitle, regionSummary } from './region-summary';
import { RegionResults } from './region-results';
import { normalise } from './review-data';
import { session, timsFraction } from '../../tests/fixtures/review';

const expectedLocalDate = (value: string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const region: ViewerRegionEvent = { type: 'lab.viewer.region', kind: 'mount', project: 'project-demo', mount: 'mount-demo',
  mountLabel: 'Demo', area: null, areaLabel: null, sample: null, spots: [] };
const rows = [
  { spot_id: 's1', atlas_spot_id: 'a1', grain_id: 'grain-1', grain_label: 'g1', acquisition_id: 'ac1', session_id: 'old', session_key: 'Old', session_started_at: '2025-01-01', sample_name: 'Sample A' },
  { spot_id: 's1', atlas_spot_id: 'a1', grain_id: 'grain-1', acquisition_id: 'ac2', session_id: 'new', session_key: 'New', session_started_at: '2026-01-01', sample_name: 'Sample A' },
  { spot_id: 's2', atlas_spot_id: 'a2', grain_label: 'g2', acquisition_id: 'ac3', session_id: session.id, sample_name: 'Sample B' },
  { atlas_spot_id: 'a3', grain_label: 'g3', sample_name: 'Sample B' },
  { spot_id: 's4', grain_label: 'g4', acquisition_id: 'ac4', session_id: 'undated' },
].map(row => normalise(row));
describe('region summary', () => {
  it('counts distinct physical spots and grains across sessions, including plucked grains', () => {
    const result = regionSummary(region, rows, [session], [timsFraction]);
    expect(result).toMatchObject({ grains: 4, spots: 4, analysed: 3, plucked: 1 });
    expect(result.fractions.map(match => match.fraction.id)).toEqual([timsFraction.id]);
    expect(result.sessions.map(s => [s.key, s.date, s.spots])).toEqual([
      [session.session_key, expectedLocalDate(session.started_at), 1], ['New', expectedLocalDate('2026-01-01'), 1], ['Old', expectedLocalDate('2025-01-01'), 1], ['undated', 'date not loaded', 1],
    ]);
  });
  it('uses case-insensitive atlas membership for areas and samples', () => {
    for (const kind of ['area', 'sample'] as const) {
      const result = regionSummary({ ...region, kind, spots: ['A1', 'a1'] }, rows, [], []);
      expect(result).toMatchObject({ grains: 1, spots: 1, analysed: 1, matchedBySample: false });
      expect(result.sessions).toHaveLength(2);
    }
  });
  it('falls back by sample name only for sample events with nonmatching spot ids', () => {
    const event = { ...region, kind: 'sample' as const, sample: 'sample b', spots: ['absent'] };
    expect(regionSummary(event, rows, [], [])).toMatchObject({ matchedBySample: true, spots: 2 });
    expect(regionSummary({ ...event, spots: [] }, rows, [], []).spots).toBe(0);
    expect(regionSummary({ ...event, kind: 'area' }, rows, [], []).spots).toBe(0);
  });
  it('prefers mount session dates over the session list and tolerates missing optional columns', () => {
    const result = regionSummary(region, rows, [{ ...session, id: 'old', started_at: '2027-01-01' }], []);
    expect(result.sessions.find(s => s.id === 'old')?.date).toBe(expectedLocalDate('2025-01-01'));
    expect(result.sessions.find(s => s.id === session.id)?.date).toBe('date not loaded');
    const normal = normalise({ session_started_at: '2026-01-02', sample_id: 'sample-a', sample_name: 'A' });
    expect(normal.values).toMatchObject({ session_started_at: '2026-01-02', sample_id: 'sample-a', sample_name: 'A' });
    expect(normal.sampleName).toBe('A');
  });
  it('deduplicates fractions and ignores retired sources and fractions', () => {
    expect(regionSummary(region, rows, [], [{ ...timsFraction, retired_at: '2026-01-01' }]).plucked).toBe(0);
    expect(regionSummary(region, rows, [], [{ ...timsFraction, sources: timsFraction.sources.map(s => ({ ...s, retired_at: '2026-01-01' })) }]).fractions).toHaveLength(0);
  });
  it('summarises 5,000 spots / 40 sessions under 50 ms with one mount results request', async () => {
    const large = Array.from({ length: 5000 }, (_, i) => ({ spot_id: `s${i}`, atlas_spot_id: `a${i}`, grain_id: `g${i >> 1}`,
      acquisition_id: `ac${i}`, session_id: `session${i % 40}`, sample_name: 'Invented' }));
    const get = vi.fn(async () => ({ status: 200, body: { spots: large } }));
    const cache = new RegionResults();
    const loaded = await cache.load('account/server', 'm', get);
    const start = performance.now();
    const result = regionSummary(region, loaded, [], []);
    const elapsed = performance.now() - start;
    console.info(`Region benchmark: ${elapsed.toFixed(2)} ms; ${get.mock.calls.length} results request; 5,000 spots / 40 sessions`);
    expect(result).toMatchObject({ grains: 2500, spots: 5000, analysed: 5000 });
    expect(result.sessions).toHaveLength(40);
    expect(elapsed).toBeLessThan(50);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('images title', () => {
  const samples = ['A', 'B', 'C'].map(sample_name => normalise({ sample_name }));
  const refs = ['91500', 'Plesovice'].map(reference_material_name => normalise({ kind: 'standard', reference_material_name }));
  it('names up to two unknowns and counts the rest, with standards in the tooltip', () => {
    expect(imagesTitle('Demo', [...refs, ...samples])).toEqual({ label: 'Demo', samples: 'A, B +1', text: 'SEM images · Demo · A, B +1', full: 'Mount Demo: A, B, C; standards 91500, Plesovice' });
  });
  it('names references only when there are no unknowns', () => {
    expect(imagesTitle('Demo', refs).samples).toBe('91500, Plesovice');
    expect(imagesTitle('Demo', samples.slice(0, 1)).samples).toBe('A');
  });
  it('handles empty labels and empty mounts', () => {
    expect(imagesTitle(null, samples).text).toBe('SEM images');
    expect(imagesTitle('Demo', []).text).toBe('SEM images · Demo');
  });
  it('prefers the reported known project and ignores unrelated status', () => {
    const row = normalise({ atlas_project_id: 'p1', mount_id: 'm1' });
    const mounts = [{ id: 'm1', label: 'One' }, { id: 'm2', label: 'Two', project: 'p2' }];
    expect(imageMount({ project: 'p1', mount: null, name: 'Atlas' }, { mount: 'm2' }, [row], mounts).label).toBe('One');
    expect(imageMount({ project: 'p2', mount: 'm2', name: 'Atlas' }, { mount: 'm1' }, [row], mounts).label).toBe('Two');
    expect(imageMount({ project: 'other', mount: 'other', name: 'Unrelated' }, { mount: 'm1' }, [row], mounts).label).toBe('One');
    expect(imageMount({ project: 'p1', mount: null, name: 'Atlas' }, { mount: null }, [row], []).label).toBe('Atlas');
  });
});
