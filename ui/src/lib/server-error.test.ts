import { describe, expect, it } from 'vitest';
import { apiReplyMessage, serverCode, serverMessage, statusSentence } from './server-error';

describe('apiReplyMessage', () => {
  it('keeps status and detail for API failures', () => {
    expect(apiReplyMessage({ status: 503, body: { detail: 'Maintenance in progress.' } }))
      .toBe('Server returned 503: Maintenance in progress.');
  });
  it('uses the safe non-JSON diagnostic from the host', () => {
    expect(apiReplyMessage({ status: 502, body: null, error: 'Server returned 502: Bad gateway' }))
      .toBe('Server returned 502: Bad gateway');
  });
});

describe('serverMessage', () => {
  it('prefers detail, then message when detail is a list', () => {
    expect(serverMessage({ detail: 'This mount changed in another window.', code: 'revision_conflict' }, 409)).toBe('This mount changed in another window.');
    expect(serverMessage({ detail: ['a', 'b'], message: '2 items need fixing.' }, 422)).toBe('2 items need fixing.');
  });
  it('falls back to a sentence, never a bare status', () => {
    expect(serverMessage(null, 500)).toBe('The server had a problem. Try again in a moment.');
    expect(serverMessage({ detail: '  ' }, 401)).toBe('Sign in again to continue.');
    for (const s of [0, 400, 403, 404, 409, 418, 503]) expect(statusSentence(s)).not.toMatch(/^HTTP/);
  });
  it('reads only well-formed codes', () => {
    expect(serverCode({ code: 'use_sync' })).toBe('use_sync');
    expect(serverCode({ code: 'Bad Code' })).toBe('');
    expect(serverCode(null)).toBe('');
  });
});
