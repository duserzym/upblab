import { expect, it } from 'vitest';
import { revisionChanged } from './tims-refine';
it('only refreshes on a known changed content revision', () => {
  expect(revisionChanged({ content_revision: 0 }, { content_revision: 1 })).toBe(true);
  expect(revisionChanged({ content_revision: 4 }, { content_revision: '4' })).toBe(false);
  expect(revisionChanged({ content_revision: 'rev-a' }, { content_revision: 'rev-b' })).toBe(true);
  expect(revisionChanged({}, { content_revision: 1 })).toBe(false);
  expect(revisionChanged({ content_revision: 1 }, { content_revision: null })).toBe(false);
});
