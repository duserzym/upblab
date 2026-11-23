import { expect, it } from 'vitest';
import { capsuleSampleLabel, preparationSamples, readCapsulePreparation, sampleCapsuleInput, writeCapsulePreparation } from './tims-capsule-intake';

const sample = { id: 'sample-invented', name: 'Invented specimen', igsn: 'INVENTED01', material: 'Rock', project: { code: 'DEMO' } };
const blank = { id: 'blank-invented', name: 'Invented lab blank', igsn: null, material: ' Lab Blank ', project: { code: 'DEMO' } };
const target = { batch: 'batch-invented', lab: 'lab-invented', position: 14 };

it('keeps control samples out of the TIMS-only picker and distinguishes duplicate names by project and IGSN', () => {
  expect(preparationSamples([sample, blank], 'lab-blank')).toEqual([blank]);
  expect(preparationSamples([sample, blank], 'tims-only')).toEqual([sample]);
  expect(capsuleSampleLabel(sample)).toBe('Invented specimen · DEMO · INVENTED01');
  expect(capsuleSampleLabel(blank)).toBe('Invented lab blank · DEMO');
  expect(() => sampleCapsuleInput('lab-blank', sample, target, { name: '', mineral: 'zircon', notes: '' })).toThrow();
});

it('creates two kinds of source-free fractions and preserves the preparation when notes are edited', () => {
  const draft = { mineral: 'baddeleyite' as const, notes: 'Bench note\nSecond line', name: ' b19 ' };
  const direct = sampleCapsuleInput('tims-only', sample, target, draft);
  expect(direct).toMatchObject({ sample_id: sample.id, lab_id: target.lab, batch_id: target.batch, capsule_number: 14, mineral: 'baddeleyite', name: 'b19', sources: [] });
  const control = sampleCapsuleInput('lab-blank', blank, target, { ...draft, name: '' });
  expect(control).toMatchObject({ sample_id: blank.id, lab_id: target.lab, batch_id: target.batch, capsule_number: 14, mineral: 'other', sources: [] });
  expect(control.name).toBeUndefined();
  for (const [kind, input] of [['tims-only', direct], ['lab-blank', control]] as const) {
    expect(readCapsulePreparation(input.notes!)).toEqual({ preparation: kind, notes: draft.notes });
    expect(readCapsulePreparation(writeCapsulePreparation(kind, 'Edited bench note'))).toEqual({ preparation: kind, notes: 'Edited bench note' });
  }
  expect(readCapsulePreparation('Handwritten note mentions Lab blank')).toEqual({ preparation: null, notes: 'Handwritten note mentions Lab blank' });
});
