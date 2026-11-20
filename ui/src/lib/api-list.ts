/** Bounded pages with an opaque X-Next-Cursor; cursors never become URLs. */
export type ListPath = '/v1/sessions' | '/v1/mounts' | '/v1/samples' | '/v1/projects' | '/v1/accounts' | '/v1/groups' | '/v1/labs' | '/v1/fractions' | '/v1/tims/capsule-sets' | '/v1/tims/recipes' | '/v1/tims/batches' | '/v1/tims/spikes' | `/v1/grains/${string}/fractions` | `/v1/spots/${string}/fractions` | `/v1/history/${string}/${string}`;
export function listPath(path: ListPath, cursor?: string | null, filters: Record<string, string> = {}): string {
  const params = new URLSearchParams({ limit: '500' });
  if (cursor) params.set('after', cursor);
  for (const [key, value] of Object.entries(filters)) if (value && key !== 'after') params.set(key, value);
  return `${path}?${params}`;
}
