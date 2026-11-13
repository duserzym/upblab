import { describe, expect, it } from 'vitest';
import { resolveServerUrl } from './server-url';

const stored = 'http://localhost:8000';
const override = 'https://dev.example.test';
const query = `?server=${encodeURIComponent(override)}`;

describe('server URL resolution', () => {
  it.each([stored, 'https://old.example.test', ''])('ignores stored web server %s on /desk/', value => {
    expect(resolveServerUrl(value, false, 'http://127.0.0.1:8765/desk/')).toBe('http://127.0.0.1:8765');
  });

  it.each([
    'http://localhost:1420/', 'http://127.0.0.1:1420/',
    'http://localhost:1431/', 'http://127.0.0.1:1431/',
    'http://localhost:1420/desk/', 'http://127.0.0.1:1431/desk/open',
    'https://localhost:1420/', 'https://127.0.0.1:1431/desk',
  ])('honours the explicit override on shell dev origin %s', page => {
    expect(resolveServerUrl(stored, false, page + query)).toBe(override);
    for (const value of [stored, 'https://old.example.test', '']) {
      expect(resolveServerUrl(value, false, page)).toBe('');
    }
  });

  it.each([
    'http://127.0.0.1:8765/desk/', 'http://localhost:8000/desk/',
    'https://lab.example.test/desk/', 'http://localhost:5173/',
    'http://lab.example.test:1420/', 'http://localhost.example.test:1431/',
    'http://[::1]:1420/',
  ])('ignores the override outside shell development: %s', page => {
    expect(resolveServerUrl(stored, false, page + query)).toBe(new URL(page).origin);
  });

  it.each(['not a URL', 'javascript:alert(1)', 'file:///tmp/server', ''])('ignores an invalid dev override %s', server => {
    expect(resolveServerUrl(stored, false, `http://localhost:1420/?server=${encodeURIComponent(server)}`))
      .toBe('');
  });

  it('normalises an explicit dev override', () => {
    expect(resolveServerUrl(stored, false, 'http://localhost:1420/?server=https://dev.example.test/base/app/'))
      .toBe('https://dev.example.test/base');
  });

  it.each([stored, 'https://lab.example.test/base/', ''])('keeps the desktop setting %s unchanged', value => {
    expect(resolveServerUrl(value, true, 'http://localhost:1420/' + query)).toBe(value);
  });
});
