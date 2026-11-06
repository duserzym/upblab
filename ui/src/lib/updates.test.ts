import { describe, expect, it } from 'vitest';
import { compareVersions, pickEndpoint, STABLE_ENDPOINT, transition, type UpdateEvent, type UpdateInfo, type UpdateStatus } from './updates';

const info: UpdateInfo = { version: '0.2.0', currentVersion: '0.1.0', notes: 'Invented notes', date: null, ready: false };
describe('semver precedence', () => {
  it.each([
    ['0.1.0', '0.1.0', 0], ['0.2.0', '0.1.0', 1], ['1.0.0', '2.0.0', -1],
    ['v1.2.3', '1.2.3', 0], ['1.10.0', '1.9.0', 1], ['1.0.0+build.2', '1.0.0+build.1', 0],
    ['1.0.0-beta.2', '1.0.0-beta.10', -1], ['1.0.0', '1.0.0-rc.1', 1],
    ['1.0.0-alpha', '1.0.0-beta', -1], ['1.0.0-beta', '1.0.0-beta.1', -1],
    ['1.0.0-1', '1.0.0-alpha', -1], ['1.0.0-beta-one', '1.0.0-beta-two', -1],
    ['1.0.0-beta.9007199254740993', '1.0.0-beta.9007199254740992', 1],
  ])('%s against %s', (a, b, order) => { expect(compareVersions(a, b)).toBe(order); expect(compareVersions(b, a)).toBe(-order || 0); });
});

describe('channel endpoints', () => {
  const release = (date: string, url: string, draft = false, prerelease = false) => ({ published_at: date, draft, prerelease, assets: [{ name: 'latest.json', browser_download_url: url }] });
  const stable = release('2026-01-01', 'https://example.com/stable');
  const beta = release('2026-02-01', 'https://example.com/beta', false, true);
  it('always uses latest for Stable', () => expect(pickEndpoint('stable', [beta, stable])).toBe(STABLE_ENDPOINT));
  it('Beta includes pre-releases and chooses the newest published release', () => expect(pickEndpoint('beta', [stable, beta])).toBe('https://example.com/beta'));
  it('ignores drafts', () => expect(pickEndpoint('beta', [release('2026-03-01', 'https://example.com/draft', true), beta])).toBe('https://example.com/beta'));
  it.each([null, {}, [], [{ draft: true }], [{ assets: [] }], [release('2026-02-01', 'http://example.com/file')]])('falls back for %j', (releases) => expect(pickEndpoint('beta', releases)).toBe(STABLE_ENDPOINT));
  it('falls back when the newest release has no manifest', () => expect(pickEndpoint('beta', [{ published_at: '2026-03-01', assets: [] }, beta])).toBe(STABLE_ENDPOINT));
});

const states: UpdateStatus[] = [
  { kind: 'idle' }, { kind: 'checking' }, { kind: 'none', checkedAt: 1 }, { kind: 'available', info },
  { kind: 'downloading', info, pct: 43 }, { kind: 'ready', info: { ...info, ready: true } },
  { kind: 'installing', info }, { kind: 'error', message: 'failed' }, { kind: 'unsupported', reason: 'web' },
];
describe('transition table', () => {
  it.each(states)('checks from $kind only when allowed', (status) => {
    for (const manual of [false, true]) {
      const allowed = !['checking', 'downloading', 'installing', 'unsupported'].includes(status.kind) && (status.kind !== 'ready' || manual);
      expect(transition(status, { type: 'check', manual })).toEqual(allowed ? { kind: 'checking' } : status);
    }
  });
  const events: [UpdateEvent, string, string][] = [
    [{ type: 'checked', info, checkedAt: 1 }, 'checking', 'available'],
    [{ type: 'checked', info: { ...info, ready: true }, checkedAt: 1 }, 'checking', 'ready'],
    [{ type: 'checked', info: null, checkedAt: 1 }, 'checking', 'none'],
    [{ type: 'download' }, 'available', 'downloading'],
    [{ type: 'progress', pct: 50 }, 'downloading', 'downloading'],
    [{ type: 'downloaded', info: { ...info, ready: true } }, 'downloading', 'ready'],
    [{ type: 'install' }, 'ready', 'installing'],
  ];
  it.each(events)('%j is accepted only in %s', (event, from, to) => {
    for (const status of states) {
      const next = transition(status, event);
      if (status.kind === from) expect(next.kind).toBe(to);
      else expect(next).toBe(status);
    }
  });
  it.each(states)('handles failures from $kind', (status) => {
    expect(transition(status, { type: 'failed', message: 'network' })).toEqual(
      ['checking', 'downloading', 'installing'].includes(status.kind) ? { kind: 'error', message: 'network' } : status,
    );
  });
  it('clamps progress and permits unknown content length', () => {
    const downloading: UpdateStatus = { kind: 'downloading', info, pct: 0 };
    for (const [pct, expected] of [[-3, 0], [130, 100], [null, null]]) {
      expect(transition(downloading, { type: 'progress', pct })).toMatchObject({ pct: expected });
    }
  });
});
