import { describe, expect, it } from 'vitest';
import { prefetchPaths } from './read-prefetch';
const mounts = Array.from({ length: 3000 }, (_, n) => ({ id: `mount-${n}`, label: `Mount ${n}`, grain_count: 0, spot_count: 0 }));
const sessions = Array.from({ length: 3000 }, (_, n) => ({ id: `session-${n}`, started_at: new Date(Date.UTC(2026,0,1,0,n)).toISOString() }));
describe('prefetchPaths', () => {
  it('bounds thousands of rows to 20 newest of each, uses exact default reads and no depth endpoints', () => {
    const paths = prefetchPaths(sessions, mounts, '');
    expect(paths).toHaveLength(142); expect(new Set(paths).size).toBe(142);
    expect(paths).toContain('/v1/sessions?limit=500'); expect(paths).toContain('/v1/mounts?limit=500');
    for (const tail of ['', '/reductions', '/results?run=preferred', '/acquisitions']) expect(paths).toContain(`/v1/sessions/session-2999${tail}`);
    for (const tail of ['', '/atlas', '/results']) expect(paths).toContain(`/v1/mounts/mount-0${tail}`);
    expect(paths).not.toContain('/v1/sessions/session-0'); expect(paths).not.toContain('/v1/mounts/mount-20');
    expect(paths.some(p => p.includes('depth-profile') || p.includes('/v1/acquisitions/'))).toBe(false);
  });
  it('adds the last scope with encoded ids/runs, deduplicates and tolerates bad settings', () => {
    const paths = prefetchPaths([], [], JSON.stringify({ kind: 'session', id: 's a', run: 'r/b' }));
    expect(paths).toContain('/v1/sessions/s%20a/results?run=r%2Fb');
    expect(prefetchPaths([], [], JSON.stringify({ kind: 'mount', id: 'last' }))).toContain('/v1/mounts/last/results');
    expect(prefetchPaths([], [], 'bad')).toHaveLength(2);
    expect(prefetchPaths(sessions, mounts, JSON.stringify({ kind: 'session', id: 'session-2999' }))).toHaveLength(142);
  });
});
