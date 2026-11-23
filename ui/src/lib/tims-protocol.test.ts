import { expect, it } from 'vitest';
import { columnProtocol, readCapsuleNotes, readColumnNotes, readSessionNotes, validMass, writeCapsuleNotes, writeColumnNotes, writeSessionNotes } from './tims-protocol';

const url = 'https://www.boisestate.edu/earth-isotope/labshare/laboratory-handbooks/';
const reference = (scheme: 'HCl anion' | 'HBr-HCl') => ({
  scheme, title: `Boise State U-Th-Pb Lab Guidebook, U-Pb separation (${scheme})`, url,
});

it('returns only the guidebook reference for each explicit scheme, ahead of the mineral fallback', () => {
  expect(columnProtocol('HCl anion')).toEqual(reference('HCl anion'));
  expect(columnProtocol('HBr-HCl')).toEqual(reference('HBr-HCl'));
  expect(columnProtocol('HBr-HCl', 'zircon')).toEqual(reference('HBr-HCl'));
  expect(columnProtocol('HCl anion', 'titanite')).toEqual(reference('HCl anion'));
});

it('preserves mineral fallback mapping and returns null for unsupported schemes and minerals', () => {
  expect(columnProtocol(undefined, 'zircon')).toEqual(reference('HCl anion'));
  for (const mineral of ['titanite', 'rutile', 'apatite', 'monazite', 'xenotime'] as const) {
    expect(columnProtocol(undefined, mineral)).toEqual(reference('HBr-HCl'));
  }
  expect(columnProtocol('', 'zircon')).toEqual(reference('HCl anion'));
  expect(columnProtocol(null, 'apatite')).toEqual(reference('HBr-HCl'));
  expect(columnProtocol(undefined, 'other')).toBeNull();
  expect(columnProtocol(undefined)).toBeNull();
  expect(columnProtocol('unrecognised', 'zircon')).toBeNull();
});

it('round-trips session weights as decimals and preserves existing step notes', () => {
  const notes = 'First bottle\nBalance checked\n';
  expect(readSessionNotes(notes)).toEqual({ notes, before: '', after: '' });
  const saved = writeSessionNotes(notes, '24.012300', '24.000000000123');
  expect(readSessionNotes(saved)).toEqual({ notes, before: '24.012300', after: '24.000000000123' });
  expect(readSessionNotes(writeSessionNotes('', '', '24.0'))).toEqual({ notes: '', before: '', after: '24.0' });
  expect(['0', '-1', '1e-4', '0.0000000000001'].some(validMass)).toBe(false);
  expect(validMass('0.000000000001')).toBe(true);
});

it('round-trips a capsule date and protocol together and leaves old notes readable', () => {
  const notes = 'A different cut was collected.';
  const saved = writeColumnNotes(writeCapsuleNotes(notes, '2026-11-20'), 'Edited instructions\nRinse first');
  const column = readColumnNotes(saved);
  expect(column.protocol).toBe('Edited instructions\nRinse first');
  expect(readCapsuleNotes(column.notes)).toEqual({ notes, date: '2026-11-20' });
  expect(readColumnNotes(notes)).toEqual({ notes, protocol: '' });
  expect(readCapsuleNotes(notes)).toEqual({ notes, date: '' });
});
