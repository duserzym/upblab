import { expect, it } from 'vitest';
import { presentationFor } from './presentation';

it('uses a viewer in split Review and an editor in the Images tab', () => {
  for (const split of [true, false]) {
    expect(presentationFor('images', split, 'images')).toBe('editor');
    expect(presentationFor('review', split, 'images')).toBe(split ? 'viewer' : null);
    for (const view of ['home', 'sessions', 'settings', 'reduce', 'account', 'people'] as const)
      expect(presentationFor(view, split, 'images')).toBeNull();
    expect(presentationFor('review', split, 'sessions')).toBeNull();
    expect(presentationFor('images', split, 'people')).toBeNull();
  }
});
