import { expect, it } from 'vitest';
import { batch, version } from '../../tests/fixtures/tims';
import { laterWeighing, latestBottleReading, readSpikingSession, repeatedBottleLoss, spikeMassUsed, spikingSessionId, spikingSessionLink, writeSpikingSession } from './tims-spiking';
import type { SessionBottle } from './tims-spiking';
import { writeSessionNotes } from './tims-protocol';

const one: SessionBottle = { bottleId: version.subfraction_id, label: 'Invented bottle 1', versionId: version.id, before: '28.41352' };
const two: SessionBottle = { bottleId: 'bottle-two', label: 'Invented bottle 2', versionId: 'version-two', before: '41.5000' };

it('keeps existing step notes and legacy session readings alongside named bottle starts', () => {
  const previous = { before: '28.41352', after: '28.36855' };
  const notes = 'Balance checked\nSecond operator present';
  const legacy = writeSessionNotes(notes, previous.before, previous.after);
  expect(readSpikingSession(legacy)).toEqual({ notes, ...previous, bottles: [] });
  expect(readSpikingSession(writeSpikingSession(notes, previous, [one, two]))).toEqual({ notes, ...previous, bottles: [one, two] });
  const malformed = notes + '\n\nSpiking session bottles (UPb Lab v1)\n{}';
  expect(readSpikingSession(malformed).notes).toBe(malformed);
});

it('computes the bottle loss exactly at the precision of the two readings', () => {
  expect(spikeMassUsed('28.41352', '28.40409')).toBe('0.00943');
  expect(spikeMassUsed('28.41352', '28.4')).toBe('0.01352');
  expect(spikeMassUsed('99999999.000000000002', '99999999.000000000001')).toBe('0.000000000001');
  for (const after of ['', '28.41352', '28.51352', '.41200', '0', '28.4135200000001']) {
    expect(spikeMassUsed('28.41352', after)).toBe('');
  }
});

it('advances each bottle independently across capsule order, versions and repeat entries in a session', () => {
  const [saved] = batch.spikes;
  const root = batch.steps.find(step => step.id === saved.step_id)!;
  const repeat = { ...root, id: 'extra-spiking-step', notes: spikingSessionLink(root.id) };
  const session = new Set([root.id, repeat.id]);
  const otherVersion = { ...version, id: 'another-version' };
  const rows = [
    { ...saved, id: 'first', bottle_after_g: '28.40409', created_at: '2026-11-06T10:00:00.001Z', updated_at: '2026-11-06T10:03:00Z' },
    { ...saved, id: 'repeat', step_id: repeat.id, spike_version_id: otherVersion.id, bottle_after_g: '28.40001', created_at: '2026-11-06T10:00:00.001534+00:00' },
    { ...saved, id: 'other-bottle', spike_version_id: two.versionId, bottle_after_g: '41.4900', created_at: '2026-11-06T10:01:00Z' },
    { ...saved, id: 'other-session', step_id: 'next-session', bottle_after_g: '28.40000', created_at: '2026-11-06T10:02:00Z' },
    { ...saved, id: 'earlier-unweighed', bottle_after_g: null, created_at: '2026-11-06T10:03:00Z' },
  ];
  expect(spikingSessionId(repeat)).toBe(root.id);
  expect(spikingSessionId(root)).toBe(root.id);
  expect(latestBottleReading(rows, session, one, { [otherVersion.id]: otherVersion })?.id).toBe('repeat');
  expect(latestBottleReading(rows, session, two, {})?.bottle_after_g).toBe('41.4900');
  expect(laterWeighing(rows[1], rows[0])).toBe(true);
  expect(laterWeighing(rows[0], rows[1])).toBe(false);
});

it('totals the measured loss from repeated additions without counting earlier records without both readings', () => {
  const [saved] = batch.spikes;
  const first = { ...saved, bottle_before_g: '28.41352', bottle_after_g: '28.40409' };
  const second = { ...saved, bottle_before_g: '28.4000', bottle_after_g: '28.39693' };
  expect(repeatedBottleLoss([first, saved])).toBe('');
  expect(repeatedBottleLoss([first, second, saved])).toBe('0.01250');
});
