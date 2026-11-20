import { L235, L238, U238_U235 } from '../../src/lib/concordia';

// Entirely invented measurements. Reset the seed on every call so a given n
// always has the same rows, and larger fixtures retain the smaller one's prefix.
export function largeReviewFixtures(n: number) {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('Spot count must be a positive integer');
  let seed = 0x5eed238;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const session = {
    id: 'session-perf', session_key: 'Invented_zircon_benchmark', material: 'zircon',
    started_at: '2026-11-06T10:00:00Z', acquisition_count: n, run_count: 1,
    preferred_run: { id: 'run-perf', status: 'completed', pipeline_name: 'Invented fixture',
      created_at: '2026-11-06T12:00:00Z', finished_at: '2026-11-06T12:30:00Z' },
  };
  const mount = { id: 'mount-perf', label: 'Invented benchmark mount', grain_count: Math.ceil(n / 3), spot_count: n };
  const run = {
    id: 'run-perf', session_id: session.id, status: 'completed', is_preferred_for_session: true,
    started_at: '2026-11-06T12:00:00Z', completed_at: '2026-11-06T12:30:00Z',
    pipeline_name: 'Invented fixture', pipeline_version: 'fixture-1', run_by: 'Invented analyst', result_count: n,
  };
  const runBrief = { run_id: run.id, is_preferred: true, started_at: run.started_at, pipeline_version: run.pipeline_version, run_by: run.run_by };
  const rows = Array.from({ length: n }, (_, i) => {
    const sample = i % 5;
    // A dense 650 Ma population plus smaller 320, 950 and 1180 Ma clusters.
    const center = [650, 650, 650, 650, 650, 650, 650, 320, 950, 1180][Math.floor(random() * 10)];
    const age = Math.max(300, Math.min(1200, center + normal() * 12)) * 1e6;
    // One per ten rows, rotating its sample rather than always flagging sample 5.
    const discordant = i % 10 === (Math.floor(i / 10) + 9) % 10;
    const loss = discordant ? 0.15 + random() * 0.55 : 0;
    // Pb loss mixes the crystallisation point towards an invented 80 Ma lower
    // intercept in Wetherill space. The inverse ratios use that same point.
    let a = (1 - loss) * Math.expm1(L235 * age) + loss * Math.expm1(L235 * 80e6);
    let b = (1 - loss) * Math.expm1(L238 * age) + loss * Math.expm1(L238 * 80e6);
    const rho = -0.2 + random() * 1.1;
    const relativeB = i % 67 === 0 ? 0.18 + random() * 0.12 : 0.012 + random() * 0.018;
    const relativeA = relativeB * 1.1;
    const shared = normal(), independent = normal();
    // Modest correlated scatter around the invented point; uncertainties are 2σ.
    a *= 1 + relativeA * shared * 0.12;
    b *= 1 + relativeB * (rho * shared + Math.sqrt(1 - rho * rho) * independent) * 0.12;
    const inverse = 1 / b, pbPb = a / (U238_U235 * b);
    // First-order covariance propagation through X=1/b, Y=a/(137.818 b).
    const relativePbPb = Math.sqrt(relativeA ** 2 + relativeB ** 2 - 2 * rho * relativeA * relativeB);
    const twRho = (relativeB - rho * relativeA) / relativePbPb;
    const date = Math.log1p(b) / L238 / 1e6;
    const date2e = b * relativeB / ((1 + b) * L238) / 1e6;
    return {
      acquisition_id: `perf-acq-${i + 1}`, label: `Zircon_${String(i + 1).padStart(5, '0')}`, kind: 'sample',
      sample_id: `perf-sample-${sample + 1}`, sample_name: `Invented sample ${sample + 1}`,
      spot_id: `perf-spot-${i + 1}`, atlas_spot_id: `perf-atlas-${i + 1}`, atlas_project_id: 'project-perf',
      grain_id: `perf-grain-${sample}-${Math.floor(i / 15)}`, grain_label: `area/${sample + 1}/${Math.floor(i / 15) + 1}`,
      mount_id: mount.id, run_id: run.id,
      '207Pb/235U': a, '207Pb/235U_2e': a * relativeA,
      '206Pb/238U': b, '206Pb/238U_2e': b * relativeB, err_corr: rho,
      '238U/206Pb': inverse, '238U/206Pb_2e': inverse * relativeB,
      '207Pb/206Pb': pbPb, '207Pb/206Pb_2e': pbPb * relativePbPb, tw_rho: twRho,
      '206Pb/238U_age': date, '206Pb/238U_age_2e': date2e,
      preferred_date: date, preferred_date_2e: date2e, preferred_date_method: '206Pb/238U', preferred_date_pass: !discordant,
      'disc%': (1 - date / (age / 1e6)) * 100,
      U: 100 + random() * 700, Th: 50 + random() * 200, Pb: 15 + random() * 60,
      automatic_flags: discordant ? 'invented Pb loss' : '',
    };
  });
  mount.grain_count = new Set(rows.map(row => row.grain_id)).size;
  const table = { session_id: session.id, session_key: session.session_key, run: runBrief, columns: Object.keys(rows[0]), rows };
  const spots = rows.map(row => ({
    ...row, session_id: session.id, session_key: session.session_key, is_preferred: true,
    date: { value: row.preferred_date, two_sigma: row.preferred_date_2e, method: row.preferred_date_method, passes: row.preferred_date_pass },
    ratios: {}, concentrations: {}, flags: row.automatic_flags ? [row.automatic_flags] : [],
  }));
  const fixtures: Record<string, unknown> = {
    '/v1/sessions': [session],
    '/v1/mounts': [{ ...mount, atlas: { project_id: 'project-perf', version: 1, uploaded_at: '2026-11-06T13:00:00Z', thumbnail: null } }],
    [`/v1/sessions/${session.id}/reductions`]: [run],
    [`/v1/sessions/${session.id}/results?run=preferred`]: table,
    [`/v1/sessions/${session.id}/results?run=${run.id}`]: table,
    [`/v1/mounts/${mount.id}`]: mount,
    [`/v1/mounts/${mount.id}/results`]: { mount_id: mount.id, spots },
    [`/v1/mounts/${mount.id}/atlas`]: { current: { project_id: 'project-perf', version: 1 } },
    [`/v1/fractions?limit=500&mount=${mount.id}`]: [],
  };
  for (const spot of spots) {
    fixtures[`/v1/spots/by-atlas/${spot.atlas_spot_id}/results`] = { spot, columns: Object.keys(spot), rows: [spot] };
    for (const selector of ['preferred', run.id]) {
      fixtures[`/v1/acquisitions/${spot.acquisition_id}/depth-profile?run=${selector}`] = {
        acquisition_id: spot.acquisition_id, label: spot.label, run: runBrief, columns: [], data: {},
      };
    }
  }
  return { session, fixtures };
}
