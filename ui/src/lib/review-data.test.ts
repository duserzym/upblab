import { describe, expect, it } from 'vitest';
import { normalise, groupSpots, numericColumns, profileColumns, groupDepthColumns, depthColumnLabel, dateLabel, parseScope } from './review-data';
import { table, rows, mountResults, profile } from '../../tests/fixtures/review';
describe('stored result tables', () => {
  it('normalises the session endpoint and splits flags without losing values', () => {
    const spot = normalise(rows[3], table);
    expect(spot).toMatchObject({ key: 'acq-4', acquisitionId: 'acq-4', spotId: 'spot-4', atlasProjectId: 'project-demo', atlasSpotId: 'atlas-4', sessionId: 'session-demo', sessionKey: table.session_key, runId: 'run-preferred', isReference: false, flags: ['discordant', 'high ratio scatter'], date: { value: 559, two_sigma: 9, method: '206Pb/238U', passes: false } });
    expect(spot.values['206Pb/238U']).toBe(rows[3]['206Pb/238U']);
    expect(dateLabel(spot)).toBe('559 ± 9');
  });
  it('normalises mount summaries, nulls and never-measured spots', () => {
    const measured = normalise(mountResults.spots[0]);
    expect(measured.date?.value).toBe(550);
    expect(measured.values.U).toBe(180);
    const empty = normalise(mountResults.spots.at(-1)!);
    expect(empty.acquisitionId).toBeNull();
    expect(empty.date).toBeNull();
    expect(normalise({ spot_id: 's', preferred_date: NaN }).values.preferred_date).toBeNull();
  });
  it('groups unknowns by sample and grain and keeps every reference kind apart', () => {
    const spots = rows.map(r => normalise(r, table));
    expect(groupSpots(spots).map(g => g.name)).toEqual(['Sample A', 'Sample B', 'Demo reference']);
    expect(groupSpots(spots)[0].grains.map(g => g.name)).toEqual(['area/1', 'area/2']);
    expect(groupSpots(spots).at(-1)?.grains[0].spots).toHaveLength(4);
    for (const kind of ['primary_standard', 'secondary_standard', 'reference_material', 'other_standard', 'unknown', 'sample'])
      expect(normalise({ kind }).isReference).toBe(/standard|reference/.test(kind));
    expect(groupSpots([normalise({ label: 'spot10' }), normalise({ label: 'spot2' })])[0].grains[0].spots.map(s => s.label)).toEqual(['spot2', 'spot10']);
    expect(normalise({ kind: 'secondary_standard', label: 'Alias_12' }).sampleName).toBe('Alias');
    expect(normalise({ kind: 'secondary_standard', label: 'Alias_12', reference_material_name: 'Canonical' }).sampleName).toBe('Canonical');
    expect(groupSpots(spots, 'high ratio')[0].grains[0].spots[0].label).toBe('Zircon_4');
    expect(groupSpots(spots, 'area/3')[0].name).toBe('Sample B');
  });
  it('offers numeric columns while excluding profile uncertainties and text', () => {
    expect(numericColumns(rows.map(r => normalise(r)))).toContain('La');
    expect(numericColumns(rows.map(r => normalise(r)))).not.toContain('label');
    expect(profileColumns(profile)).toEqual(['206Pb/238U_age', '207Pb/206Pb_age', '206Pb/238U_fractionation_corrected', 'U']);
    expect(parseScope('{"kind":"session","id":"s"}')).toEqual({ kind: 'session', id: 's', run: 'preferred' });
    expect(parseScope('invalid')).toBeNull();
  });
});

describe('depth profile channel picker', () => {
  it('groups stored channels and finds both readable and original names', () => {
    const keys = ['206Pb/238U_date', '207Pb/206Pb', '206Pb/238U_DH_corrected',
      '204Pb', 'Ti', '206Pb/238U_session_correction_factor'];
    expect(groupDepthColumns(keys).map(g => g.group)).toEqual(['Dates', 'Isotope ratios',
      'Corrected ratios', 'Concentrations', 'Isotope signals', 'Correction diagnostics']);
    expect(groupDepthColumns(keys, 'downhole 206pb')).toEqual([
      { group: 'Corrected ratios', keys: ['206Pb/238U_DH_corrected'] },
    ]);
    expect(depthColumnLabel('206Pb/238U_date')).toBe('206Pb/238U (Ma)');
    const percent = '206Pb/238U_age_2e_with_calibration%';
    expect(profileColumns({ ...profile, columns: [...profile.columns, percent],
      data: { ...profile.data, [percent]: [5] } })).not.toContain(percent);
  });
});
