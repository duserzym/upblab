/** List pages are bounded (UPbDB ADR-0009: limit and an opaque `after` cursor from X-Next-Cursor); cursors are never interpolated as URLs. */
export function listPath(path: '/v1/sessions' | '/v1/mounts', cursor?: string | null): string {
  return `${path}?limit=500${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`;
}
