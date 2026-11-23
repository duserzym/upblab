import type { ColumnProtocolOut, Mineral } from './tims-api';

export interface ColumnProtocolReference {
  scheme: 'HCl anion' | 'HBr-HCl';
  title: string;
  url: string;
}

export function columnProtocol(scheme: unknown, mineral?: Mineral): ColumnProtocolReference | null {
  let selected: ColumnProtocolReference['scheme'];
  if (scheme === 'HBr-HCl' || !scheme && mineral && ['titanite', 'rutile', 'apatite', 'monazite', 'xenotime'].includes(mineral)) selected = 'HBr-HCl';
  else if (scheme === 'HCl anion' || !scheme && mineral === 'zircon') selected = 'HCl anion';
  else return null;
  return {
    scheme: selected,
    title: `Boise State U-Th-Pb Lab Guidebook, U-Pb separation (${selected})`,
    url: 'https://www.boisestate.edu/earth-isotope/labshare/laboratory-handbooks/',
  };
}

export interface ResolvedColumnProtocol { text: string; source: 'capsule' | 'batch' | 'lab' | null; attribution: string }

/** Empty copies inherit the next layer. No protocol text is bundled in the shell. */
export function resolveColumnProtocol(capsule = '', batch = '', lab?: Pick<ColumnProtocolOut, 'text' | 'attribution'> | null): ResolvedColumnProtocol {
  const source = capsule.trim() ? 'capsule' : batch.trim() ? 'batch' : lab?.text.trim() ? 'lab' : null;
  const text = source === 'capsule' ? capsule : source === 'batch' ? batch : source === 'lab' ? lab!.text : '';
  const attribution = source === 'lab' ? lab!.attribution : source
    ? `${lab?.attribution || 'Boise State Isotope Geology Laboratory · U-Th-Pb Lab Guidebook'} · edited copy` : '';
  return { text, source, attribution };
}

const protocolHeading = 'Column protocol (edited)';
export function readColumnNotes(value: string): { notes: string; protocol: string } {
  const heading = protocolHeading + '\n';
  if (value.startsWith(heading)) return { notes: '', protocol: value.slice(heading.length) };
  const index = value.indexOf('\n\n' + heading);
  return index < 0 ? { notes: value, protocol: '' } : { notes: value.slice(0, index), protocol: value.slice(index + 2 + heading.length) };
}

export function writeColumnNotes(notes: string, protocol: string): string {
  return protocol.trim() ? [notes, `${protocolHeading}\n${protocol.trim()}`].filter(Boolean).join('\n\n') : notes;
}

const sessionBlock = /(?:^|\n\n)Spiking session bottle weights\nBegin \(g\): ([0-9.]*|—)\nEnd \(g\): ([0-9.]*|—)$/;
export function readSessionNotes(value: string) {
  const match = sessionBlock.exec(value);
  const mass = (input: string) => input === '—' ? '' : input;
  return match ? { notes: value.slice(0, match.index), before: mass(match[1]), after: mass(match[2]) } : { notes: value, before: '', after: '' };
}

export function writeSessionNotes(notes: string, before: string, after: string): string {
  return before || after ? [notes, `Spiking session bottle weights\nBegin (g): ${before || '—'}\nEnd (g): ${after || '—'}`].filter(Boolean).join('\n\n') : notes;
}

export const validMass = (value: string) => /^\d{1,8}(\.\d{1,12})?$/.test(value) && /[1-9]/.test(value);

const dateLine = /(?:^|\n\n)Performed on \(capsule\): (\d{4}-\d{2}-\d{2})$/;
export function readCapsuleNotes(value: string) {
  const match = dateLine.exec(value);
  return match ? { notes: value.slice(0, match.index), date: match[1] } : { notes: value, date: '' };
}

export function writeCapsuleNotes(notes: string, date: string): string {
  return date ? [notes, `Performed on (capsule): ${date}`].filter(Boolean).join('\n\n') : notes;
}
