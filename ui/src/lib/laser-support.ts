// A bounded capability probe, shared by all file entry points. No log list is
// downloaded beyond its first row. Identity's read helper handles auth, ETags,
// stalls and the offline mirror just as it does for Home's other reads.
interface LaserIdentity {
  target: { server: string } | null;
  revision: number;
  signedIn: boolean;
  get<T>(path: string): Promise<{ status: number; body: T }>;
}

let scope = '';
let answer: Promise<boolean> | undefined;
export function laserScope(identity: LaserIdentity): string {
  const server = identity.target?.server;
  return JSON.stringify([server ? new URL(server).origin : '', identity.revision, identity.signedIn]);
}

export function clearLaserSupport(): void { scope = ''; answer = undefined; }

/** Only a definitive 404 blocks a hand-off; an unavailable server may have a local copy. */
export function takesLaserLogs(identity: LaserIdentity): Promise<boolean> {
  const next = laserScope(identity);
  if (scope !== next) { scope = next; answer = undefined; }
  return answer ??= identity.get<unknown>('/v1/laser-logs?limit=1')
    .then(reply => reply.status !== 404)
    .catch(error => error?.status !== 404);
}
