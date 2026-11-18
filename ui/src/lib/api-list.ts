/** List pages are bounded; cursors are opaque and never interpolated as URLs. */
export function listPath(path: '/v1/sessions' | '/v1/mounts', cursor?: string | null): string {
  return `${path}?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
}
