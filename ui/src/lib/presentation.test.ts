import { expect, it } from 'vitest';
import { presentationFor } from './presentation';

it('always uses a viewer for the images module and nothing for other modules', () => {
  for (const split of [true, false]) {
    for (const view of ['home', 'review', 'sessions', 'settings', 'reduce', 'account', 'people'] as const) {
      expect(presentationFor(view, split, 'images')).toBe('viewer');
      expect(presentationFor(view, split, 'sessions')).toBeNull();
      expect(presentationFor(view, split, 'people')).toBeNull();
    }
  }
});
