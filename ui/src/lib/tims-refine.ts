export interface MountRevision { content_revision?: string | number | null }
/** Missing revisions on older servers cannot prove a change. Zero is a real revision. */
export function revisionChanged(before: MountRevision, after: MountRevision): boolean {
  return before.content_revision != null && after.content_revision != null && String(before.content_revision) !== String(after.content_revision);
}
