import { describe, expect, it } from 'vitest';
import { atlasFileUrl, atlasStatus, capInventory, kindColor, kindSegments, mountsShown, notReduced, newestMounts, runStatus, sessionsByMineral, sessionsShown, thumbnailPaths } from './home';
import type { MountRow, RunOut, SessionRow } from './overview.svelte';

const run: RunOut = { id: 'r', session_id: 's', pipeline_name: 'UPbRPy', pipeline_version: '0.1', status: 'completed', started_at: '2026-11-05', completed_at: '2026-11-05', upbrpy_version: '0.1', is_preferred_for_session: true, run_by: null, result_count: 2 };
const session = (key: string, date: string | null, analyst = 'Demo analyst'): SessionRow => ({ session: { id: key, session_key: key, material: 'zircon', analyst, instrument: { name: 'Demo instrument' }, started_at: date, acquisition_count: 10 }, runs: 0, preferred: null, latest: null });
const mount = (name: string, date: string | null = null): MountRow => ({ mount: { id: name, label: name, mount_type: 'epoxy', grain_count: 1, spot_count: 2 }, atlas: date ? { projectId: name, name: `${name} images`, version: 3, publishedAt: date } : null });

describe('Home filtering and sorting', () => {
  it('searches session keys, material, analyst and instrument without mutating input', () => {
    const rows = [session('B', '2026-11-01'), session('A', '2026-11-05', 'Other'), session('C', null)];
    expect(sessionsShown(rows, '  zircon DEMO instrument ', 'newest').map(r => r.session.session_key)).toEqual(['A', 'B', 'C']);
    expect(sessionsShown(rows, 'other', 'az').map(r => r.session.session_key)).toEqual(['A']);
    expect(sessionsShown(rows, 'b', 'az')).toHaveLength(1);
    expect(sessionsShown(rows, '', 'oldest').map(r => r.session.session_key)).toEqual(['B', 'A', 'C']);
    expect(sessionsShown(rows, '', 'za').map(r => r.session.session_key)).toEqual(['C', 'B', 'A']);
    expect(rows[0].session.session_key).toBe('B');
  });
  it('groups mineral names case-insensitively and preserves the chosen order within a mineral', () => {
    const rutile = session('R', null);
    rutile.session.material = ' Rutile ';
    const older = session('Old', '2025-01-01');
    older.session.material = 'Zircon';
    const newer = session('New', '2026-11-05');
    expect(sessionsByMineral(sessionsShown([older, rutile, newer], '', 'newest'))).toEqual([
      ['rutile', [rutile]], ['zircon', [newer, older]],
    ]);
  });
  it('orders UUIDv7 mounts by creation instead of the API label order', () => {
    const first = { ...mount('A').mount, id: '01900000-0000-7000-8000-000000000000' };
    const recent = { ...mount('B').mount, id: '01910000-0000-7000-8000-000000000000' };
    expect(newestMounts([first, recent])).toEqual([recent, first]);
    expect(newestMounts([mount('A').mount, mount('B').mount]).map(m => m.label)).toEqual(['A', 'B']);
  });
  it('searches mount type and atlas names and orders by publication date', () => {
    const rows = [mount('B'), mount('A', '2026-11-05'), mount('C', '2026-11-01')];
    expect(mountsShown(rows, 'epoxy', 'newest').map(r => r.mount.label)).toEqual(['A', 'C', 'B']);
    expect(mountsShown(rows, '', 'oldest').map(r => r.mount.label)).toEqual(['C', 'A', 'B']);
    expect(mountsShown(rows, 'images', 'az').map(r => r.mount.label)).toEqual(['A', 'C']);
    expect(mountsShown(rows, 'C images', 'az')).toEqual([rows[2]]);
    expect(mountsShown(rows, '', 'az', 'with').map(r => r.mount.label)).toEqual(['A', 'C']);
    expect(mountsShown(rows, 'B', 'newest', 'with')).toEqual([]);
    expect(mountsShown(rows, '', 'newest', 'without')).toEqual([rows[0]]);
    expect(rows.map(r => r.mount.label)).toEqual(['B', 'A', 'C']);
  });
  it('excludes pending and failed atlas lookups from both definite filters', () => {
    const pending = { ...mount('Pending'), detailsPending: true };
    const failed: MountRow = { ...mount('Failed'), atlas: 'error' };
    expect(mountsShown([pending, failed], '', 'az')).toEqual([failed, pending]);
    for (const filter of ['with', 'without'] as const) expect(mountsShown([pending, failed], '', 'az', filter)).toEqual([]);
  });
  it('sorts atlas matches by mount label even when atlas names sort differently', () => {
    const a = mount('A', '2026-11-05'), b = mount('B', '2026-11-01');
    if (a.atlas && a.atlas !== 'error') a.atlas.name = 'Z images';
    expect(mountsShown([b, a], 'images', 'az', 'with')).toEqual([a, b]);
  });
});
describe('Sessions without a preferred completed run', () => {
  it('includes zero runs, unpreferred completed runs, and preferred runs that have not completed', () => {
    const row = session('A', null);
    expect(notReduced(row)).toBe(true);
    expect(notReduced({ ...row, runs: 1, completed: run })).toBe(true);
    for (const status of ['pending', 'queued', 'running', 'failed'])
      expect(notReduced({ ...row, runs: 1, preferred: { ...run, status } })).toBe(true);
    expect(notReduced({ ...row, runs: 2, preferred: run, latest: { ...run, status: 'failed' } })).toBe(false);
  });
  it('excludes unknown and pending summaries without treating them as reduced', () => {
    const row = session('A', null);
    expect(notReduced({ ...row, runs: null })).toBe(false);
    expect(notReduced({ ...row, detailsPending: true })).toBe(false);
  });
});
describe('Home atlas status', () => {
  it('labels published, absent, pending and unknown atlases separately', () => {
    const published = mount('A', '2026-11-11T12:00:00Z');
    expect(atlasStatus(published)).toEqual({ text: 'Atlas v3 · 11 Nov', label: 'Has a published atlas, version 3' });
    expect(atlasStatus(mount('B'))).toEqual({ text: 'No atlas', label: 'No published atlas' });
    expect(atlasStatus({ ...mount('C'), detailsPending: true })).toEqual({ text: 'checking…', label: 'Checking for a published atlas' });
    expect(atlasStatus({ ...mount('D'), atlas: 'error' })).toEqual({ text: 'atlas unknown', label: 'Published atlas status unknown' });
  });
  it('handles older published atlases without a version, date or name', () => {
    expect(atlasStatus({ ...mount('A'), atlas: { projectId: 'p', name: null, version: null, publishedAt: null } }))
      .toEqual({ text: 'Atlas', label: 'Has a published atlas' });
    expect(atlasStatus(mount('A', 'invalid date')).text).toBe('Atlas v3');
  });
});
describe('Home run status', () => {
  it('distinguishes no runs, failed reads, unpreferred runs and preferred runs', () => {
    const row = session('A', null);
    expect(runStatus(row)).toEqual({ tone: 'text-faint', text: 'not reduced' });
    expect(runStatus({ ...row, runs: null }).text).toBe('reductions unavailable');
    expect(runStatus({ ...row, runs: null, detailsPending: true }).text).toBe('loading reductions…');
    expect(runStatus({ ...row, runs: 2, detailsPending: true }).text).toBe('2 runs · loading reductions…');
    expect(runStatus({ ...row, runs: 2 }).text).toBe('2 runs, none preferred');
    expect(runStatus({ ...row, runs: 1, preferred: run, latest: run })).toMatchObject({ tone: 'ok', text: expect.stringContaining('preferred · UPbRPy 0.1') });
    for (const status of ['failed', 'running']) expect(runStatus({ ...row, runs: 2, preferred: run, latest: { ...run, status } })).toEqual({ tone: 'warning', text: `${status} · 2 runs` });
  });
});
describe('Home spot bars', () => {
  it('scales the bar to the largest visible session and stacks by kind', () => {
    expect(kindSegments(20, 40, { sample: 15, primary_standard: 5 })).toEqual([
      { kind: 'sample', count: 15, x: 0, width: 37.5 }, { kind: 'primary_standard', count: 5, x: 37.5, width: 12.5 },
    ]);
    expect(kindSegments(0, 0)).toEqual([]);
    expect(kindSegments(10, 10, { sample: -1, blank: 0 })[0].width).toBe(100);
    expect(kindColor('other')).toBe('var(--text-faint)');
  });
  it('shows unknown counts without labeling them as samples or inflating known categories', () => {
    expect(kindSegments(10, 40)).toEqual([{ kind: 'unclassified', count: 10, x: 0, width: 25 }]);
    expect(kindSegments(20, 40, { sample: 15 })).toEqual([
      { kind: 'sample', count: 15, x: 0, width: 37.5 }, { kind: 'unclassified', count: 5, x: 37.5, width: 12.5 },
    ]);
  });
});
describe('Home atlas thumbnails', () => {
  it('uses a thumbnail or lowest pyramid level from the published manifest', () => {
    const files = { 'pyramid/area1/2/0_0.webp': 'sha', 'pyramid/area1/0/0_0.webp': 'sha', 'project.json': 'sha' };
    expect(thumbnailPaths({ files: { ...files, 'pyramid/area2/1/0_0.webp': 'sha' } })).toEqual(['pyramid/area1/2/0_0.webp', 'pyramid/area2/1/0_0.webp']);
    expect(thumbnailPaths({ files: { ...files, 'thumbnail.png': 'sha' } })).toEqual(['thumbnail.png']);
    expect(thumbnailPaths({ files: {} })).toEqual([]);
    // grainatlas atlas.json: a list of { path, sha256, size }.
    expect(thumbnailPaths({ files: [
      { path: 'grains.geojson', sha256: 'a', size: 1 },
      { path: 'pyramid/001_WG26/3/0_0.webp', sha256: 'b', size: 9 },
      { path: 'pyramid/001_WG26/0/0_0.webp', sha256: 'c', size: 6 },
      { path: '../bad.png', sha256: 'd', size: 1 },
    ] })).toEqual(['pyramid/001_WG26/3/0_0.webp']);
    expect(thumbnailPaths({ files: [] })).toEqual([]);
    expect(thumbnailPaths(null)).toEqual([]);
  });
  it('rejects traversal, external URLs and query strings and encodes access separately', () => {
    expect(thumbnailPaths({ files: { '../bad.png': '', 'https://other/image.png': '', '/bad.png': '', '%2e%2e/bad.png': '', 'bad.png?token=x': '' } })).toEqual([]);
    expect(atlasFileUrl('http://lab/prefix/', 'project', 'pyramid/area 1/0/0_0.webp', 'read+/token')).toBe('http://lab/prefix/atlas/projects/project/pyramid/area%201/0/0_0.webp?access=read%2B%2Ftoken');
  });
});


describe('Home inventory cap', () => {
  it('keeps all rows through 500 and explicitly caps larger inventories without changing input', () => {
    for (const size of [0, 12, 15, 40, 500, 501, 800]) {
      const items = Array.from({ length: size }, (_, i) => i);
      expect(capInventory(items)).toEqual(items.slice(0, Math.min(500, size)));
      expect(items).toHaveLength(size);
    }
  });
  it('searches rows beyond the previous twelve-row subset', () => {
    const sessions = Array.from({ length: 15 }, (_, i) => session(`Session ${i}`, null));
    const mounts = Array.from({ length: 40 }, (_, i) => mount(`Zircon_mount_${i}`, '2026-11-01'));
    expect(sessionsShown(capInventory(sessions), 'Session 14', 'az')).toEqual([sessions[14]]);
    expect(mountsShown(capInventory(mounts), 'Zircon_mount_37', 'az')).toEqual([mounts[37]]);
    expect(mountsShown(capInventory(mounts), 'Zircon_mount_37 images', 'az', 'with')).toEqual([mounts[37]]);
  });
});
