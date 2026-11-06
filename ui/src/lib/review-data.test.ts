import { describe, expect, it } from 'vitest';
import { normalise, groupSpots, numericColumns, profileColumns, dateLabel, parseScope } from './review-data';
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
    expect(groupSpots(spots).map(g => g.name)).toEqual(['Sample A', 'Sample B']);
    expect(groupSpots(spots)[0].grains.map(g => g.name)).toEqual(['area/1', 'area/2']);
    expect(groupSpots(spots, '', true).at(-1)?.grains[0].spots).toHaveLength(4);
    for (const kind of ['primary_standard', 'secondary_standard', 'reference_material', 'other_standard', 'unknown', 'sample'])
      expect(normalise({ kind }).isReference).toBe(/standard|reference/.test(kind));
    expect(groupSpots([normalise({ label: 'spot10' }), normalise({ label: 'spot2' })])[0].grains[0].spots.map(s => s.label)).toEqual(['spot2', 'spot10']);
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
