import { expect, it } from 'vitest';
import { shortCitation, spikeDois } from './spike-reference';

it('shortens recognizable multi-author citations while preserving the full source elsewhere', () => {
  expect(shortCitation('Fable, A., Story, B., 2022. An invented calibration. Journal of Synthetic References 12, 1–9.')).toBe('Fable et al. 2022');
  expect(shortCitation('Fable et al. (2022), An invented calibration')).toBe('Fable et al. 2022');
  expect(shortCitation('O’Fable et al. 2023, An invented reference')).toBe('O’Fable et al. 2023');
  expect(shortCitation('Fable A.B., Story C.D. (2022). An invented reference')).toBe('Fable et al. 2022');
});
it('leaves ambiguous prose, single authors, dates and paths unchanged for CSS ellipsis', () => {
  for (const text of ['', 'Cached tracer blocks in invented 2024 workbooks', '/invented/2023/file.xml', 'Fable, A. 2022. A single author.', 'An invented label']) expect(shortCitation(text)).toBe(text);
  expect(spikeDois.get('invented-test-source')).toBeUndefined();
  expect(spikeDois.get('constructor')).toBeUndefined();
  expect(spikeDois.get('condon2015')).toMatch(/^https:\/\/doi.org\//);
});
