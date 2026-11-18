import { expect, it } from 'vitest';
import { listPath } from './api-list';
it('bounds list pages and encodes opaque cursors', () => {
  expect(listPath('/v1/sessions')).toBe('/v1/sessions?limit=500');
  expect(listPath('/v1/mounts', 'next/+?x=1')).toBe('/v1/mounts?limit=500&cursor=next%2F%2B%3Fx%3D1');
});
