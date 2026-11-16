import { demoHomeFixtures, demoInstrument, demoSessions } from './home';
import { rows, session } from './review';
import { demoAtlasStatus, demoElements } from './demo-atlas';

// These are the /v1 reads made by UPbDB's timeline and the hosted atlas viewer.
// Empty email is deliberate: documentation must contain no email addresses.
const account = { id: 'account-demo', username: 'demo', display_name: 'Demo analyst', email: '',
  email_verified: false, sign_in_methods: [], orcid: '', affiliation: '', is_lab_staff: true,
  can_manage_people: false, is_admin: false, groups: [] };
const acquisitions = rows.map((r, i) => ({
  id: r.acquisition_id, session_id: session.id, session_key: session.session_key, sequence_index: i + 1,
  instrument_label: r.label, sample_label: r.sample_name, sample_id: r.sample_id,
  sample_override: false, sample_override_reason: '', label_sample_name: r.sample_name,
  spot_sample_name: r.sample_name, sample_disagreement: false,
  acquisition_kind: r.kind, sample_name: r.sample_name, qc_state: 'accepted', reference_material_name: i < 8 ? '' : 'Demo reference',
  started_at: `2026-11-06T10:${String(i * 3).padStart(2, '0')}:00Z`,
  started_at_local_text: `2026-11-06 10:${String(i * 3).padStart(2, '0')}:00`,
  duration_s: 45, sweep_count: 225, analytes: ['29Si', '206Pb', '207Pb', '238U'],
  physical_spot: { id: r.spot_id, label: r.label, atlas_project_id: 'project-demo', atlas_spot_id: r.atlas_spot_id },
}));
const timeline = [
  ...demoSessions.map(s => ({ kind: 'session', object_id: s.id, session_id: s.id, at: s.started_at,
    until: s.ended_at, project_id: 'project-demo-lab', sample_id: null, material: 'zircon',
    instrument_id: demoInstrument.id, title: s.session_key, detail: 'Demo analyst · 12 spots' })),
  ...acquisitions.map(a => ({ kind: 'acquisition', object_id: a.id, session_id: a.session_id,
    at: a.started_at, until: new Date(Date.parse(a.started_at) + 45000).toISOString(),
    project_id: 'project-demo-lab', sample_id: a.sample_id, material: 'zircon',
    instrument_id: demoInstrument.id, title: a.instrument_label, detail: a.sample_label })),
];
export const demoApi: Record<string, unknown> = {
  ...demoHomeFixtures,
  '/v1/accounts/me': account,
  '/v1/auth/providers': { password_registration: false, orcid: false, google: false, github: false, google_domains: [] },
  '/v1/instruments': [demoInstrument],
  '/v1/projects': [{ id: 'project-demo-lab', code: 'DEMO', title: 'Demo zircon workflow' }],
  '/v1/samples': ['Sample A', 'Sample B', 'Demo reference'].map((name, i) => ({
    id: ['sample-a', 'sample-b', 'reference'][i], name, material: 'zircon', description: '', acquisition_count: 4 })),
  '/v1/activity': demoSessions.map(s => ({ date: s.started_at.slice(0, 10), acquisitions: 12,
    kinds: s.spot_kinds, sessions: [s.id], other: { session: 1 } })),
  '/v1/timeline': timeline,
  '/v1/acquisitions': acquisitions,
  '/v1/sessions/session-demo/acquisitions': acquisitions,
  '/v1/atlas/projects/project-demo': demoAtlasStatus,
  '/v1/atlas/projects/project-demo/elements': demoElements,
};
