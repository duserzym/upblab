import type { FractionInput, Mineral } from './tims-api';

export const capsulePreparations = {
  'tims-only': 'TIMS only',
  'lab-blank': 'Lab blank',
} as const;
export type CapsulePreparation = keyof typeof capsulePreparations;
export const fractionNamePattern = '[a-z]{1,3}[0-9]{1,3}[a-z]?';

export interface CapsuleSample {
  id: string;
  name: string;
  igsn: string | null;
  material: string;
  project: { code: string } | null;
}

export function preparationSamples(samples: CapsuleSample[], preparation: CapsulePreparation) {
  return samples.filter(sample => (sample.material.trim().toLowerCase() === 'lab blank') === (preparation === 'lab-blank'));
}

export function capsuleSampleLabel(sample: CapsuleSample) {
  return [sample.name, sample.project?.code, sample.igsn].filter(Boolean).join(' · ');
}

const preparationLine = /^\[UPb Lab capsule: (tims-only|lab-blank)\](?:\n\n|$)/;

export function readCapsulePreparation(value: string): { preparation: CapsulePreparation | null; notes: string } {
  const match = preparationLine.exec(value);
  if (!match) return { preparation: null, notes: value };
  return { preparation: match[1] === 'lab-blank' ? 'lab-blank' : 'tims-only', notes: value.slice(match[0].length) };
}

export function writeCapsulePreparation(preparation: CapsulePreparation | null, notes: string) {
  return preparation ? [`[UPb Lab capsule: ${preparation}]`, notes].filter(Boolean).join('\n\n') : notes;
}

export function sampleCapsuleInput(
  preparation: CapsulePreparation, sample: CapsuleSample,
  target: { batch: string; lab: string; position: number },
  draft: { mineral: Mineral; name: string; notes: string },
): FractionInput {
  if (!preparationSamples([sample], preparation).length) throw new Error('Choose a sample from this list.');
  return {
    sample_id: sample.id, lab_id: target.lab, batch_id: target.batch, capsule_number: target.position,
    mineral: preparation === 'lab-blank' ? 'other' : draft.mineral, status: 'transferred',
    ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
    notes: writeCapsulePreparation(preparation, draft.notes), sources: [],
  };
}
