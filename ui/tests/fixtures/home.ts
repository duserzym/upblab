import { reviewFixtures, session, runs, mount } from './review';

// Small public documentation inventory; all names and records are invented.
export const demoInstrument = { id: 'instrument-demo', name: 'Demo LA-ICP-MS', kind: 'LA-ICP-MS', make: 'Demo', model: 'Demo', per_spot_clock: 'utc' };
export const demoSessions = [6, 5, 3].map((day, i) => ({
  ...session, id: i ? `session-demo-${day}` : session.id,
  session_key: i ? `Zircon_demo_0${day}Nov26` : session.session_key,
  started_at: `2026-11-0${day}T10:00:00Z`, ended_at: `2026-11-0${day}T11:15:00Z`,
  timezone: 'UTC', kind: 'analytical', status: 'completed', source_format: 'demo',
  analyst: 'Demo analyst', operator: 'demo', instrument: demoInstrument, project_code: 'DEMO',
  run_count: i === 2 ? 0 : 2,
  preferred_run: i === 2 ? null : { id: i ? `run-demo-${day}` : 'run-preferred', status: 'completed',
    pipeline_name: 'UPbRPy', finished_at: '2026-11-07T12:00:00Z', created_at: '2026-11-07T11:00:00Z' },
  spot_kinds: { sample: 8, primary_standard: 2, secondary_standard: 2, glass: 0, other: 0 },
}));
export const demoMount = { ...mount, mount_type: 'epoxy', grain_count: 5 };
export const demoHomeFixtures: Record<string, unknown> = {
  ...reviewFixtures, '/v1/sessions': demoSessions, '/v1/mounts': [demoMount],
  '/v1/mounts/mount-demo': demoMount,
  '/v1/mounts/mount-demo/atlas': { mount_id: mount.id, access: 'demo-read-only',
    current: { project_id: 'project-demo', name: 'Demo zircon mount', version: 1, uploaded_at: '2026-11-07T12:00:00Z' } },
};
for (const s of demoSessions) {
  demoHomeFixtures[`/v1/sessions/${s.id}`] = { ...s, kind_counts: s.spot_kinds,
    owner: 'demo', is_owner: true, can_share: true, can_edit: true };
  demoHomeFixtures[`/v1/sessions/${s.id}/reductions`] = s.run_count ? runs.map((r, i) => ({
    ...r, session_id: s.id, id: i === 0 ? s.preferred_run!.id : `${s.id}-newer`,
  })) : [];
}

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
  atlas: i % 3 === 1 ? { project_id: `board-project-${i}`, name: `Published images ${i}`, version: 1,
    uploaded_at: '2026-11-01T12:00:00Z', thumbnail: null } : null,
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
