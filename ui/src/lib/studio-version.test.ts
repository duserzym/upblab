import { expect, it } from 'vitest';
import { compareStudioVersions } from './studio-version';

it.each([
  ['0.1.9', '0.1.10', -1], ['0.1.10', '0.1.9', 1],
  ['v0.1.2', '0.1.3', -1], ['0.1.2', 'v0.1.2', 0],
  ['0.1.2', '0.1.2.0', 0], ['0.2', '0.1.99', 1],
  ['1.0', '0.99.99', 1], ['0.01.002', '0.1.2', 0],
  ['0.9007199254740992', '0.9007199254740993', -1],
] as const)('compares %s with %s numerically', (installed, saved, expected) => {
  expect(compareStudioVersions(installed, saved)).toBe(expected);
});

it.each([undefined, null, '', 'unknown', '0.1.2rc1', '0.1.2+build', '0.1.2-beta.1', 'v', '1..2', '.1.2', '1.2.', '-1.2', '1e2.0'])('skips unknown version %s on either side', version => {
  expect(compareStudioVersions(version, '0.1.3')).toBeNull();
  expect(compareStudioVersions('0.1.2', version)).toBeNull();
});
