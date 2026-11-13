// Invented sync snapshots, shared by unit tests and browser specs.
import type { AtlasStatusEvent, AtlasDraftsEvent, AtlasSyncedEvent } from '@lab/bridge';
import { mount } from './review';
export const atlasStatusFixture: AtlasStatusEvent = {
  type: 'lab.atlas.status', project: 'project-demo', mount: mount.id,
  name: 'Demo_XS_150X', mode: 'edit', state: 'local-changes', revision: 41, atlasVersion: 3,
  changes: { spots: 12, grains: 2, labels: 1, pixels: true }, syncedAt: null,
};
export const atlasDraftsFixture: AtlasDraftsEvent = {
  type: 'lab.atlas.drafts', drafts: [{
    project: atlasStatusFixture.project, mount: mount.id, name: atlasStatusFixture.name,
    baseRevision: 41, changes: { spots: 12, grains: 2, labels: 0, pixels: false }, updatedAt: '2026-11-12T14:02:00Z',
  }],
};
export const atlasSyncedFixture: AtlasSyncedEvent = {
  type: 'lab.atlas.synced', project: atlasStatusFixture.project, mount: mount.id, revision: 42, atlasVersion: 4,
  changed: { spots: 12, grains: 2, labels: 1, pixels: true }, at: '2026-11-12T14:03:00Z',
};
