import type { SpikeAddition, StepOut, VersionOut } from './tims-api';
import { readSessionNotes, validMass, writeSessionNotes } from './tims-protocol';

export interface SessionBottle {
  bottleId: string;
  versionId: string;
  label: string;
  before: string;
}

const heading = 'Spiking session bottles (UPb Lab v1)\n';
const linkHeading = 'Spiking session step (UPb Lab v1)\n';

export function spikingSessionId(step: StepOut) {
  const link = step.notes.startsWith(linkHeading) ? step.notes.slice(linkHeading.length) : '';
  return step.method_code === 'SP-TIMS-SPIKE' && /^[\w-]+$/.test(link) ? link : step.id;
}

export function spikingSessionLink(stepId: string) {
  return linkHeading + stepId;
}

export function readSpikingSession(notes: string) {
  const block = /(?:^|\n\n)Spiking session bottles \(UPb Lab v1\)\n([^\n]+)$/.exec(notes);
  if (block) {
    try {
      const bottles: unknown = JSON.parse(block[1]);
      if (Array.isArray(bottles) && bottles.every(isSessionBottle)) {
        return { ...readSessionNotes(notes.slice(0, block.index)), bottles: bottles as SessionBottle[] };
      }
    } catch { /* Keep unknown or malformed data in the original note. */ }
  }
  return { ...readSessionNotes(notes), bottles: [] as SessionBottle[] };
}

function isSessionBottle(value: unknown): value is SessionBottle {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SessionBottle>;
  return typeof item.bottleId === 'string' && !!item.bottleId &&
    typeof item.versionId === 'string' && !!item.versionId &&
    typeof item.label === 'string' && typeof item.before === 'string' && validMass(item.before);
}

export function writeSpikingSession(notes: string, previous: { before: string; after: string }, bottles: SessionBottle[]) {
  return [
    writeSessionNotes(notes, previous.before, previous.after),
    bottles.length ? heading + JSON.stringify(bottles) : '',
  ].filter(Boolean).join('\n\n');
}

// Both UPbDB and the outbox return UTC timestamps. Keep sub-millisecond precision.
function timestamp(time: string) {
  return time.replace(/(?:\.(\d+))?(?:Z|\+00:00)$/, (_, fraction = '') => '.' + fraction.padEnd(6, '0') + 'Z');
}

export function laterWeighing(row: SpikeAddition, earlier: SpikeAddition) {
  return row.id !== earlier.id && timestamp(row.created_at) >= timestamp(earlier.created_at);
}

export function usesBottle(row: SpikeAddition, bottle: SessionBottle, versions: Record<string, VersionOut>) {
  return row.spike_version_id === bottle.versionId || versions[row.spike_version_id]?.subfraction_id === bottle.bottleId;
}

export function latestBottleReading(
  spikes: SpikeAddition[], stepIds: ReadonlySet<string>, bottle: SessionBottle,
  versions: Record<string, VersionOut>,
) {
  let latest: SpikeAddition | undefined;
  for (const row of spikes) {
    if (!stepIds.has(row.step_id) || !row.bottle_after_g || !validMass(row.bottle_after_g)) continue;
    if (!usesBottle(row, bottle, versions)) continue;
    if (!latest || laterWeighing(row, latest)) latest = row;
  }
  return latest;
}

export function spikeMassUsed(before: string, after: string): string {
  if (!validMass(before) || !validMass(after)) return '';
  const places = decimalPlaces([before, after]);
  const difference = integerMass(before, places) - integerMass(after, places);
  return difference > 0n ? grams(difference, places) : '';
}

export function repeatedBottleLoss(rows: SpikeAddition[]) {
  const losses = rows.map(row => spikeMassUsed(row.bottle_before_g ?? '', row.bottle_after_g ?? '')).filter(Boolean);
  if (losses.length < 2) return '';
  const places = decimalPlaces(losses);
  const total = losses.reduce((sum, mass) => sum + integerMass(mass, places), 0n);
  return grams(total, places);
}

function decimalPlaces(masses: string[]) {
  return Math.max(...masses.map(mass => mass.split('.')[1]?.length ?? 0));
}

function integerMass(mass: string, places: number) {
  const [whole, decimal = ''] = mass.split('.');
  return BigInt(whole + decimal.padEnd(places, '0'));
}

function grams(value: bigint, places: number) {
  const digits = value.toString().padStart(places + 1, '0');
  return places ? digits.slice(0, -places) + '.' + digits.slice(-places) : digits;
}
