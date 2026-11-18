/** Bounded pages with an opaque X-Next-Cursor; cursors never become URLs. */
export type ListPath = '/v1/sessions' | '/v1/mounts' | '/v1/samples' | '/v1/projects' | '/v1/accounts' | '/v1/groups' | '/v1/labs';
export function listPath(path: ListPath, cursor?: string | null, filters: Record<string, string> = {}): string {
  const params = new URLSearchParams({ limit: '500' });
  if (cursor) params.set('after', cursor);
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  return `${path}?${params}`;
}
