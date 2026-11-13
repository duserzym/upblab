import { expect, it } from 'vitest';
import { reduceStatus } from './reduce-status';
import type { RunOut, SessionRow } from './overview.svelte';
const run = (status = 'completed', started_at = '2026-11-13T12:00:00Z') => ({ status, started_at, completed_at: started_at } as RunOut);
const row = (latest: RunOut | null = null, preferred: RunOut | null = null, completed?: RunOut | null) => ({ latest, preferred, completed, runs: latest ? 1 : 0 } as SessionRow);
it('distinguishes untouched, opened and submitted sessions', () => {
  expect(reduceStatus(row()).label).toBe('not started');
  expect(reduceStatus(row(), '2026-11-13T10:00:00Z').label).toBe('in progress');
  expect(reduceStatus(row(run()), '2026-11-13T10:00:00Z')).toEqual({ label: 'submitted', date: '2026-11-13T12:00:00Z' });
  expect(reduceStatus(row(run()), '2026-11-13T13:00:00Z').label).toBe('in progress');
});
it('pending, queued and running override older submissions', () => {
  for (const state of ['pending', 'queued', 'running']) expect(reduceStatus(row(run(state), run())).label).toBe('in progress');
});
it('uses preferred completion or latest completed even after a failed run', () => {
  expect(reduceStatus(row(run(), run('completed', '2026-11-12'))).date).toBe('2026-11-12');
  expect(reduceStatus(row(run('failed'), null, run())).label).toBe('submitted');
});

it('keeps failed attempts in progress until there is a completed submission', () => {
  expect(reduceStatus(row(run('failed'))).label).toBe('in progress');
});
