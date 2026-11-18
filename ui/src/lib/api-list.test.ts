import { expect, it } from 'vitest';
import { listPath } from './api-list';
it('bounds list pages and encodes opaque cursors', () => {
  expect(listPath('/v1/sessions')).toBe('/v1/sessions?limit=500');
  expect(listPath('/v1/mounts', 'next/+?x=1')).toBe('/v1/mounts?limit=500&after=next%2F%2B%3Fx%3D1');
});

it('pages samples, projects and directories with combined narrowing filters', () => {
  expect(listPath('/v1/samples', 'opaque/a', { owner: 'cedar', team: 'Demo team', project: 'DEMO', lab: '' })).toBe('/v1/samples?limit=500&after=opaque%2Fa&owner=cedar&team=Demo+team&project=DEMO');
  expect(listPath('/v1/projects')).toBe('/v1/projects?limit=500');
  expect(listPath('/v1/accounts', null, { view_as: 'true' })).toBe('/v1/accounts?limit=500&view_as=true');
});
