import { identity } from './identity.svelte';
import { firstPage, onlineForm, read, type BatchDetail } from './tims-api';
import type { Account } from './platform';
import { grainImages } from './tims-grain-image-cache';
import type { MountGeometry } from './tims-geometry';
/** A reply belongs to the identity, lab and form that started it, even before effects run. */
export class ReplyScope {
  private generation = 0;
  constructor(private context: () => unknown = () => null) {}
  invalidate() { this.generation++; }
  capture(input: () => unknown = () => null) {
    const generation = this.generation;
    const signature = () => JSON.stringify([identity.target?.server, identity.account?.id, identity.revision, this.context(), input()]);
    const owner = signature();
    return () => generation === this.generation && owner === signature();
  }
}
/** One outline read and, when needed, one label read per distinct mount; publish independently. */
export async function batchGeometry(batch: BatchDetail, publish: (mount: string, value: MountGeometry) => void, report: (error: unknown) => void, revalidate = false) {
  const mounts = new Map<string, boolean>();
  for (const fraction of batch.fractions) for (const source of fraction.sources) {
    if (!source.retired_at && source.mount_id) mounts.set(source.mount_id, !!mounts.get(source.mount_id) || !source.mount_label);
  }
  const ids = [...mounts.keys()];
  await Promise.all(ids.map(async id => {
    let value: MountGeometry = { grains: [], spots: [], current_project_uuid: null };
    const update = (part: Partial<MountGeometry>) => { value = { ...value, ...part }; publish(id, value); };
    const needsLabel = mounts.get(id);
    await Promise.allSettled([
      mountElements(id, revalidate).then(update).catch(report),
      ...(needsLabel ? [read<{ label?: string; name?: string }>(`/v1/mounts/${encodeURIComponent(id)}`).then(m => update({ label: m.label || m.name })).catch(report)] : []),
    ]);
  }));
}
let accountScope = '', accounts: Promise<Account[]> | undefined;
export function clearTimsNames() { accountScope = ''; accounts = undefined; }
/** One bounded page shared by every operator label. Identity GET supplies ETag revalidation. */
export function operatorAccounts(): Promise<Account[]> {
  const scope = JSON.stringify([identity.target?.server, identity.account?.id, identity.revision]);
  if (scope !== accountScope) { clearTimsNames(); accountScope = scope; }
  return accounts ??= firstPage<Account>('/v1/accounts').then(p => p.items).catch(() => []);
}
/** Keep exact online forms across retries. A changed payload or identity gets a fresh key. */
export class OnlineAction<T> {
  private signature = '';
  private form: ReturnType<typeof onlineForm<T>> | undefined;
  async send(path: string, method: 'POST' | 'DELETE' | 'PUT', body?: unknown, objectKey?: string) {
    const signature = JSON.stringify([identity.target?.server, identity.account?.id, identity.revision, path, method, body, objectKey]);
    if (signature !== this.signature) { this.signature = signature; this.form = onlineForm<T>(path, method, body, objectKey); }
    const form = this.form!;
    const result = await form.send();
    // An earlier request must not clear a newer form's retry key.
    if (this.form === form) { this.signature = ''; this.form = undefined; }
    return result;
  }
}

export const grainImageScope = () => JSON.stringify([identity.target?.server, identity.account?.id, identity.revision, identity.authentication]);
export function mountElements(id: string, revalidate = false) {
  return grainImages.elements(grainImageScope(), id, () => read<MountGeometry>(`/v1/mounts/${encodeURIComponent(id)}/elements`), revalidate);
}
