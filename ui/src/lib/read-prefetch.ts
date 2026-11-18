import { newestMounts } from './home';
import { parseScope } from './review-data';
import type { SessionOut, MountOut } from './overview.svelte';

/** Default Home/Review reads only: never raw files or per-acquisition depth profiles. */
export function prefetchPaths(sessions: Pick<SessionOut, 'id' | 'started_at'>[], mounts: MountOut[], savedScope: string): string[] {
  const paths = new Set<string>(['/v1/sessions?limit=500', '/v1/mounts?limit=500']);
  const session = (id: string, run = 'preferred') => {
    const base = `/v1/sessions/${encodeURIComponent(id)}`;
    for (const path of [base, `${base}/reductions`, `${base}/results?run=${encodeURIComponent(run)}`, `${base}/acquisitions`]) paths.add(path);
  };
  const mount = (id: string) => {
    const base = `/v1/mounts/${encodeURIComponent(id)}`;
    for (const path of [base, `${base}/atlas`, `${base}/results`]) paths.add(path);
  };
  for (const s of [...sessions].sort((a,b) => (b.started_at ?? '').localeCompare(a.started_at ?? '')).slice(0,20)) session(s.id);
  for (const m of newestMounts(mounts).slice(0,20)) mount(m.id);
  const scope = parseScope(savedScope);
  if (scope?.kind === 'session') session(scope.id, scope.run);
  else if (scope?.kind === 'mount') mount(scope.id);
  return [...paths];
}
