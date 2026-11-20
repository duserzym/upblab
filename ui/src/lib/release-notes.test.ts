import { expect, it } from 'vitest';
import { bundledNotes, isNewerVersion, releaseNotesUrl, whatsNewNotes } from './release-notes';

it('bundles the running release notes', () => {
  const notes = bundledNotes(__APP_VERSION__);
  expect(notes).not.toBe('');
  expect(notes.length).toBeLessThanOrEqual(600);
  expect(notes.split('\n').length).toBeLessThanOrEqual(5);
  expect(notes.split('\n').every(line => line.startsWith('- '))).toBe(true);
  expect(bundledNotes('999.0.0')).toBe('');
});
it('prefers bundled notes, then matching manifest notes, then a simple fallback', () => {
  expect(whatsNewNotes('1.0.0', ' bundled ', '1.0.0', 'saved')).toBe('bundled');
  expect(whatsNewNotes('1.0.0', '', '1.0.0', ' saved ')).toBe('saved');
  expect(whatsNewNotes('1.0.0', '', '0.9.0', 'old')).toBe('Updated to v1.0.0.');
  expect(whatsNewNotes('1.0.0', ' ', '1.0.0', '')).toBe('Updated to v1.0.0.');
});
it.each([['', false], ['0.9.0', true], ['1.0.0', false], ['1.1.0', false], ['broken', false], ['1.0.0-beta.1', true]])(
  'only shows automatically for an older recorded version: %s', (last, show) => expect(isNewerVersion('1.0.0', last)).toBe(show),
);
it('links to the exact release tag', () => {
  expect(releaseNotesUrl('1.2.3')).toBe('https://github.com/duserzym/upblab/releases/tag/v1.2.3');
});
