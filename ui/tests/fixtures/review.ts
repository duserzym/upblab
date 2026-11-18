// Entirely invented zircon measurements. No source data is copied here.
export const session = { id: 'session-demo', session_key: 'Zircon_demo_06Nov26', material: 'zircon', started_at: '2026-11-06T10:00:00Z', acquisition_count: 12, run_count: 2, preferred_run: { id: 'run-preferred' } };
export const mount = { id: 'mount-demo', label: 'Demo zircon mount', grain_count: 3, spot_count: 13 };
export const runs = [
  { id: 'run-preferred', parsing_changed_at: '2026-11-07T10:00:00Z', session_id: session.id, status: 'completed', is_preferred_for_session: true, started_at: '2026-11-06T12:00:00Z', completed_at: '2026-11-06T12:30:00Z', pipeline_name: 'UPbRPy', pipeline_version: '0.1.0', upbrpy_version: '0.1.0', run_by: 'Demo analyst', result_count: 12 },
  { id: 'run-newer', session_id: session.id, status: 'completed', is_preferred_for_session: false, started_at: '2026-11-06T14:00:00Z', completed_at: '2026-11-06T14:30:00Z', pipeline_name: 'UPbRPy', pipeline_version: '0.1.1', upbrpy_version: '0.1.1', run_by: 'Demo analyst', result_count: 12 },
];
export const rows = Array.from({ length: 12 }, (_, i) => ({
  acquisition_id: `acq-${i + 1}`, label: i < 8 ? `Zircon_${i + 1}` : `Reference_${i - 7}`,
  kind: i < 8 ? 'sample' : i < 10 ? 'primary_standard' : 'secondary_standard', sample_id: i < 4 ? 'sample-a' : i < 8 ? 'sample-b' : 'reference',
  sample_name: i < 4 ? 'Sample A' : i < 8 ? 'Sample B' : 'Demo reference', spot_id: `spot-${i + 1}`, atlas_spot_id: `atlas-${i + 1}`, atlas_project_id: 'project-demo',
  grain_id: i < 8 ? `grain-${i < 3 ? 1 : i < 4 ? 2 : 3}` : null, grain_label: i < 8 ? `area/${i < 3 ? 1 : i < 4 ? 2 : 3}` : null, mount_id: mount.id, run_id: 'run-preferred',
  '207Pb/235U': 0.72 + i * 0.006, '207Pb/235U_2e': 0.018, '206Pb/238U': 0.089 + i * 0.0004, '206Pb/238U_2e': 0.0014,
  err_corr: i === 2 ? null : 0.65, err_corr_no_calibration: 0.6, '238U/206Pb': 11.2 - i * 0.04, '238U/206Pb_2e': 0.16,
  '207Pb/206Pb': 0.059 + i * 0.0001, '207Pb/206Pb_2e': 0.0008, tw_rho: -0.3,
  '206Pb/238U_age': 550 + i * 3, '206Pb/238U_age_2e': 9, '207Pb/206Pb_age': 560 + i * 2, '207Pb/206Pb_age_2e': 12,
  preferred_date: 550 + i * 3, preferred_date_2e: 9, preferred_date_method: '206Pb/238U', preferred_date_pass: i !== 3,
  'disc%': i === 3 ? 8 : 1.5, 'Th/U': 0.3 + i * 0.02, U: 180 + i * 12, U_95CI: 6, Th: 60 + i * 8, Pb: 22 + i,
  Ti: 4 + i * 0.4, Y: 800 + i * 25, Nb: 2 + i * 0.15, Hf: 9000 + i * 100, Ta: 0.6 + i * 0.03, Zr: 480000 + i * 100,
  La: 0.3 + i * 0.01, Ce: 8 + i * 0.2, Pr: 0.4 + i * 0.01, Nd: 3 + i * 0.1, Sm: 4 + i * 0.1, Eu: 0.2 + i * 0.01, Gd: 12 + i, Tb: 3 + i * 0.2,
  Dy: 30 + i, Ho: 9 + i * 0.3, Er: 40 + i, Tm: 8 + i * 0.2, Yb: 70 + i, Lu: 14 + i * 0.5,
  automatic_flags: i === 3 ? 'discordant; high ratio scatter' : '',
}));
export const runBrief = { run_id: 'run-preferred', is_preferred: true, started_at: runs[0].started_at, pipeline_version: '0.1.0', run_by: 'Demo analyst' };
export const table = { session_id: session.id, session_key: session.session_key, run: runBrief, columns: Object.keys(rows[0]), rows };
export const unmeasured = { spot_id: 'spot-unmeasured', atlas_spot_id: 'atlas-unmeasured', atlas_project_id: 'project-demo', label: 'Zircon_13', grain_id: 'grain-3', grain_label: 'area/3', mount_id: mount.id, sample_name: 'Sample B', acquisition_id: null, date: null, ratios: {}, concentrations: {}, flags: [] };
export const mountResults = { mount_id: mount.id, spots: [...rows.map(r => ({
      spot_id: r.spot_id, atlas_spot_id: r.atlas_spot_id, atlas_project_id: r.atlas_project_id, label: r.label, grain_label: r.grain_label,
      acquisition_id: r.acquisition_id, session_id: session.id, session_key: session.session_key, run_id: r.run_id, is_preferred: true,
      date: { value: r.preferred_date, two_sigma: r.preferred_date_2e, method: r.preferred_date_method, passes: r.preferred_date_pass },
      ratios: { '206Pb/238U': { value: r['206Pb/238U'], uncertainty: r['206Pb/238U_2e'] } }, concentrations: { U: { value: r.U, uncertainty: r.U_95CI } }, th_u: r['Th/U'], discordance_percent: r['disc%'], flags: r.automatic_flags ? r.automatic_flags.split('; ') : [],
    })), unmeasured] };
const time = Array.from({ length: 24 }, (_, i) => i * 0.2);
const profileData = {
  signal_relative_time: time, Time: time.map(t => t + 20), depth_um: time.map(t => t * 0.5),
  '206Pb/238U_age': time.map((_, i) => 550 + Math.sin(i) * 3), '206Pb/238U_age_2e': time.map(() => 9),
  '207Pb/206Pb_age': time.map((_, i) => 560 + Math.cos(i) * 4), '207Pb/206Pb_age_2e': time.map(() => 12),
  '206Pb/238U_fractionation_corrected': time.map(() => 0.089), '206Pb/238U_fractionation_corrected_2e': time.map(() => 0.0014),
  U: time.map((_, i) => 180 + i), U_2s: time.map(() => 6), sample: time.map(() => 'Sample A'), spot_name: time.map(() => 'Zircon_1'), acquisition_id: time.map(() => 'acq-1'),
};
export const profile = { acquisition_id: 'acq-1', label: 'Zircon_1', run: runBrief, columns: Object.keys(profileData), data: profileData };
export const reviewFixtures: Record<string, unknown> = {
  // Home consumes the API's batched summaries. Detail routes remain available
  // for Review and explicit refreshes, without a Home request for every row.
  '/v1/sessions': [{ ...session, preferred_run: { id: runs[0].id, status: runs[0].status,
    pipeline_name: runs[0].pipeline_name, created_at: runs[0].started_at, finished_at: runs[0].completed_at } }],
  '/v1/mounts': [{ ...mount, atlas: { project_id: 'project-demo', version: 1, uploaded_at: '2026-11-07T10:00:00Z', thumbnail: null } }],
  [`/v1/sessions/${session.id}/reductions`]: runs,
  [`/v1/sessions/${session.id}/results?run=preferred`]: table,
  [`/v1/sessions/${session.id}/results?run=run-preferred`]: table,
  [`/v1/sessions/${session.id}/results?run=run-newer`]: { ...table, run: { ...runBrief, run_id: 'run-newer', is_preferred: false, started_at: runs[1].started_at, pipeline_version: '0.1.1' }, rows: rows.map(r => ({ ...r, run_id: 'run-newer', preferred_date: r.preferred_date + 1 })) },
  [`/v1/mounts/${mount.id}`]: mount, [`/v1/mounts/${mount.id}/results`]: mountResults, [`/v1/mounts/${mount.id}/atlas`]: { current: { project_id: 'project-demo', version: 1 } },
  '/v1/spots/by-atlas/atlas-unmeasured/results': { spot: unmeasured, columns: table.columns, rows: [] },
};
for (const row of rows) {
  reviewFixtures[`/v1/spots/by-atlas/${row.atlas_spot_id}/results`] = { spot: row, columns: ['session_id', 'session_key', 'is_preferred', ...table.columns], rows: [{ session_id: session.id, session_key: session.session_key, is_preferred: true, ...row }] };
  for (const run of runs)
    reviewFixtures[`/v1/acquisitions/${row.acquisition_id}/depth-profile?run=${run.id}`] = row.acquisition_id === 'acq-1' ? { ...profile, run: { ...runBrief, run_id: run.id, is_preferred: run.is_preferred_for_session } } : { acquisition_id: row.acquisition_id, run: runBrief, columns: [], data: {} };
}
