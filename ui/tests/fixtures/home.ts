import { reviewFixtures, session, runs } from './review';

// Invented inventory beyond the former twelve-row subset. Atlas names deliberately
// differ from mount names, including an atlas published for mount 37.
export const homeSessions = Array.from({ length: 15 }, (_, i) => ({
  ...session, id: `board-session-${i}`, session_key: `Board session ${i}`,
  material: i % 2 ? 'apatite' : 'zircon', acquisition_count: 10 + i,
  started_at: `2026-10-${String(20 - i).padStart(2, '0')}T10:00:00Z`,
}));
export const homeMounts = Array.from({ length: 40 }, (_, i) => ({
  id: `board-mount-${i}`, label: `Zircon_mount_${i}`, mount_type: 'epoxy',
  grain_count: 2 + i, spot_count: 10 + i,
}));
export const homeAtlasMounts = homeMounts.filter((_, i) => i % 3 === 1);
export const largeHomeFixtures: Record<string, unknown> = {
  ...reviewFixtures, '/v1/sessions': homeSessions, '/v1/mounts': homeMounts,
};
for (const s of homeSessions) {
  largeHomeFixtures[`/v1/sessions/${s.id}`] = { ...s, kind_counts: { sample: s.acquisition_count } };
  largeHomeFixtures[`/v1/sessions/${s.id}/reductions`] = runs.map(r => ({ ...r, session_id: s.id }));
}
for (const [i, m] of homeMounts.entries()) {
  largeHomeFixtures[`/v1/mounts/${m.id}/atlas`] = {
    current: i % 3 === 1 ? { project_id: `board-project-${i}`, name: `Published images ${i}`, version: 1, uploaded_at: '2026-11-01T12:00:00Z' } : null,
    access: i % 3 === 1 ? `read-only-board-${i}` : null,
  };
}
