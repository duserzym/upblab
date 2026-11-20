import { describe, expect, it } from 'vitest';
import { checkButtonView, compareVersions, friendlyUpdateError, transition, UPDATE_INSTALL_REASON, updateErrorDetail, type UpdateEvent, type UpdateInfo, type UpdateStatus } from './updates';

const info: UpdateInfo = { version: '0.2.0', currentVersion: '0.1.0', notes: 'Invented notes', date: null, ready: false };
describe('friendly updater errors', () => {
  it.each(['pubkey', 'PUBLIC KEY', 'invalid pubkey: invalid base64', 'public key decode failed', 'not configured'])(
    'explains configuration errors: %s', (raw) => expect(friendlyUpdateError(raw)).toBe('Updates are not configured for this build yet.'),
  );
  it.each(['404', 'release JSON', 'Could not fetch a valid release', 'NOT FOUND', 'no assets'])(
    'explains missing releases: %s', (raw) => expect(friendlyUpdateError(raw)).toBe('No public release of UPb Lab has been published.'),
  );
  it.each(['certificate verify failed', 'CERTIFICATE_VERIFY_FAILED', 'certificate', 'UnknownIssuer', 'invalid peer certificate: UnknownIssuer', 'error sending request: invalid peer certificate: UnknownIssuer'])(
    'explains certificate errors: %s', (raw) => expect(friendlyUpdateError(raw)).toBe('Could not verify the secure connection to github.com.'),
  );
  it.each(['Signature verification failed', 'the signature of the downloaded update could not be verified', 'minisign decode error', 'Verify error'])(
    'explains signature errors: %s', (raw) => expect(friendlyUpdateError(raw)).toBe("The update's signature did not match. Nothing was installed."),
  );
  it.each(['error sending request', 'DNS', 'connect failed', 'timed out', 'timeout', 'offline', 'network', 'Failed to fetch', 'ENOTFOUND', 'URLError'])(
    'explains connection errors: %s', (raw) => expect(friendlyUpdateError(raw)).toBe('No internet connection, or github.com did not answer.'),
  );
  it.each(['install folder not writable', 'Permission denied (os error 13)', 'Access is denied (os error 5)', 'Read-only file system'])(
    'explains unwritable installs: %s', (raw) => expect(friendlyUpdateError(raw)).toBe('UPb Lab cannot replace itself in this folder. Download the new version from GitHub.'),
  );
  it('uses the canonical error precedence', () => {
    expect(friendlyUpdateError('public key not configured: certificate signature 404 network not writable')).toBe('Updates are not configured for this build yet.');
    expect(friendlyUpdateError('certificate verify failed: signature 404 network not writable')).toBe('Could not verify the secure connection to github.com.');
    expect(friendlyUpdateError('signature verify failed: 404 network not writable')).toBe("The update's signature did not match. Nothing was installed.");
    expect(friendlyUpdateError('HTTP 404: network not writable')).toBe('No public release of UPb Lab has been published.');
    expect(friendlyUpdateError('network not writable')).toBe('No internet connection, or github.com did not answer.');
  });
  it('trims and bounds unknown diagnostics', () => {
    expect(friendlyUpdateError('  Unexpected updater response  ')).toBe('The update check failed: Unexpected updater response');
    expect(friendlyUpdateError(`  ${'x'.repeat(150)}  `)).toBe(`The update check failed: ${'x'.repeat(119)}…`);
  });
  it('keeps raw error details, trimmed and limited to 120 characters', () => {
    for (const raw of ['  invalid peer certificate: UnknownIssuer  ', 'x'.repeat(120), 'x'.repeat(121)]) {
      const detail = updateErrorDetail(raw);
      expect(detail.length).toBeLessThanOrEqual(120);
      expect(detail).toBe(raw.trim().length > 120 ? `${raw.trim().slice(0, 119)}…` : raw.trim());
      expect(checkButtonView({ kind: 'error', message: raw }, '0.1.0').details).toBe(detail);
    }
  });
});

describe('check button presentation', () => {
  const cases: [UpdateStatus, string, string | null, boolean, boolean][] = [
    [{ kind: 'idle' }, 'Current version: v0.1.0', null, false, false],
    [{ kind: 'checking' }, 'Checking for updates…', null, false, true],
    [{ kind: 'none', checkedAt: 1 }, 'Up to date (v0.1.0)', null, false, false],
    [{ kind: 'available', info }, 'Update available: v0.2.0', 'download', true, false],
    [{ kind: 'downloading', info, pct: 43 }, 'Downloading v0.2.0… 43%', null, false, true],
    [{ kind: 'downloading', info, pct: null }, 'Downloading v0.2.0…', null, false, true],
    [{ kind: 'ready', info }, 'v0.2.0 is ready', 'install', true, false],
    [{ kind: 'installing', info }, 'Installing v0.2.0 and restarting…', null, false, true],
    [{ kind: 'error', message: 'invalid pubkey' }, 'Updates are not configured for this build yet.', null, false, false],
    [{ kind: 'unsupported', reason: 'Install the desktop app.' }, 'Install the desktop app.', null, false, false],
    [{ kind: 'unsupported', reason: UPDATE_INSTALL_REASON, info }, 'UPb Lab cannot replace itself in this folder. Download the new version from GitHub.', 'releases', true, false],
  ];
  it.each(cases)('describes %j', (status, text, action, badge, busy) => {
    expect(checkButtonView(status, '0.1.0')).toEqual({
      text, action, badge, busy,
      secondaryText: status.kind === 'available' ? 'Current version: v0.1.0' : null,
      details: status.kind === 'error' ? status.message : null,
    });
  });
  it('leaves automatic downloading to the updater', () => {
    expect(checkButtonView({ kind: 'available', info }, '0.1.0', { autoDownload: true })).toMatchObject({ action: null, badge: true });
  });
  it('keeps standards warnings visible regardless of update status', () => {
    for (const [status] of cases) expect(checkButtonView(status, '0.1.0', { standardsWarning: true }).badge).toBe(true);
  });
});

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
