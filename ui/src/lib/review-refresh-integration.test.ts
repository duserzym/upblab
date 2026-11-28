import { expect, it, vi } from 'vitest';
import { table, rows, runs, session, mount, profile } from '../../tests/fixtures/review';
import { inventedElements } from '../../tests/fixtures/tims-atlas';
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'https://synthetic.invalid' }, signedIn: true, revision: 0, get: vi.fn() } }));
vi.mock('./shell.svelte', () => ({ shell: { serverUrl: 'https://synthetic.invalid', view: 'review' } }));
vi.mock('./settings.svelte', () => ({ settings: { loaded: true, reviewScope: '', reviewSplit: false, update: vi.fn() } }));
vi.mock('./platform', () => ({ isDesktop: false, logWarn: vi.fn(), logInfo: vi.fn() }));
vi.mock('./incoming', () => ({ sendCommand: vi.fn(), moduleSurfaces: new Set<string>(), reloadReviewViewer: vi.fn() }));
const { identity } = await import('./identity.svelte');
const { review } = await import('./review.svelte');
const { ReviewRefresh } = await import('./review-refresh.svelte');

it('measures the old result-only refresh against manual revalidation with 15 and 5000 stored spots', async () => {
  const get = vi.mocked(identity.get), measurements: string[] = [];
  for (const count of [15, 5000]) {
    identity.revision++; review.clear();
    const stored = Array.from({ length: count }, (_, i) => ({ ...rows[0], acquisition_id: `synthetic-${i}`, mount_id: `mount-${i % 3}`, atlas_project_id: `project-${i % 3}` }));
    get.mockImplementation(async path => {
      const suffix = path.replace('?limit=500', '');
      if (suffix === '/v1/sessions' || suffix === '/v1/mounts') return { status: 200, body: [] } as never;
      if (path.includes('/results?run=')) return { status: 200, body: { ...table, rows: stored } } as never;
      if (path.endsWith('/reductions')) return { status: 200, body: runs } as never;
      if (path.startsWith('/v1/fractions?')) return { status: 404, body: {} } as never;
      if (path.includes('/depth-profile?')) return { status: 200, body: profile } as never;
      if (path.endsWith('/elements')) return { status: 200, body: inventedElements } as never;
      if (path.startsWith('/v1/atlas/projects/')) return { status: 200, body: { mount_id: path.split('/').at(-1)!.replace('project-', 'mount-'), revision: 42, atlas_version: 4 } } as never;
      if (path.endsWith('/atlas')) return { status: 200, body: { current: { project_id: path.split('/').at(-2)!.replace('mount-', 'project-'), version: 4 } } } as never;
      if (path.startsWith('/v1/mounts/')) return { status: 200, body: { ...mount, id: path.split('/').at(-1)! } } as never;
      return { status: 200, body: session } as never;
    });
    await review.open({ kind: 'session', id: session.id });
    await new Promise(resolve => setTimeout(resolve, 0));
    get.mockClear(); let start = performance.now();
    await review.refresh({ lists: false });
    const before = { reads: get.mock.calls.length, ms: performance.now() - start };
    expect(before.reads).toBe(5); // Results + reductions + three fraction pages.
    get.mockClear(); start = performance.now();
    const manual = new ReviewRefresh(); await manual.refresh();
    const after = { reads: get.mock.calls.length, ms: performance.now() - start };
    expect(manual.state).toBe('success');
    expect(after.reads).toBe(19); // Above + selected depth + session + four reads per distinct mount.
    expect(get.mock.calls.filter(([path]) => path.includes('/elements'))).toHaveLength(3);
    expect(get.mock.calls.filter(([path]) => path.includes('/v1/atlas/projects/'))).toHaveLength(3);
    expect(review.rows).toHaveLength(count);
    measurements.push(`${count} spots: before ${before.reads} reads / ${before.ms.toFixed(2)} ms; after ${after.reads} reads / ${after.ms.toFixed(2)} ms`);
  }
  console.info(`Review revalidation (mock network, 3 mounts, one selected profile): ${measurements.join('; ')}.`);
});
