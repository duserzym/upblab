import { describe, expect, it } from 'vitest';
import { moduleHome, moduleUrl, normaliseServerUrl, resolve } from './links';

const A = '2f1c9a4e-6b1d-4c3e-9f7a-0d8e5b6c7a91';
const B = '7c0e2b9d-1a3f-4e8b-8c6d-5f4a3b2c1d0e';

describe('resolve: plan section 4.4 table', () => {
  it('laicpmsdb acquisition -> Sessions tab', () => {
    expect(resolve(`laicpmsdb://acquisition/${A}`)).toEqual({
      kind: 'tab',
      tab: 'sessions',
      route: `/app/acquisitions/${A}`,
      url: `laicpmsdb://acquisition/${A}`,
    });
  });

  it('laicpmsdb session -> Sessions tab', () => {
    expect(resolve(`laicpmsdb://session/${A}`)).toMatchObject({ tab: 'sessions', route: `/app/sessions/${A}` });
  });

  it('laicpmsdb sample -> Sessions tab', () => {
    expect(resolve(`laicpmsdb://sample/${A}`)).toMatchObject({ tab: 'sessions', route: `/app/samples/${A}` });
  });

  it('grainatlas spot -> Images tab', () => {
    expect(resolve(`grainatlas://project/${A}/spot/${B}`)).toMatchObject({
      kind: 'tab',
      tab: 'images',
      route: `/atlas/?project=${A}&spot=${B}`,
    });
  });

  it('grainatlas project -> Images tab', () => {
    expect(resolve(`grainatlas://project/${A}`)).toMatchObject({ tab: 'images', route: `/atlas/?project=${A}` });
  });

  it('upbr session -> launch Studio', () => {
    expect(resolve(`upbr://session/${A}`)).toEqual({
      kind: 'studio',
      tab: 'reduce',
      object: 'session',
      id: A,
      url: `upbr://session/${A}`,
    });
  });

  it('upbr run -> launch Studio, query kept', () => {
    expect(resolve(`upbr://run/${A}?server=http://h:8000`)).toMatchObject({ kind: 'studio', object: 'run', id: A, url: `upbr://run/${A}?server=http://h:8000` });
  });

  it('laicpmsdb mount -> Sessions tab', () => {
    expect(resolve(`laicpmsdb://mount/${A}`)).toMatchObject({ tab: 'sessions', route: `/app/mounts/${A}` });
    expect(moduleUrl('sessions', `/app/mounts/${A}`, { server: 'http://h', atlas: '' })).toBe(`http://h/app/#/mounts/${A}`);
  });

  it('laicpmsdb ingest -> Sessions ingest dialog with the folder, re-encoded', () => {
    const r = resolve('laicpmsdb://ingest?path=%2FVolumes%2Flab%2Fraw%2FApatite%2020Mar25&evil=1');
    expect(r).toMatchObject({ tab: 'sessions', route: '/app/ingest?path=%2FVolumes%2Flab%2Fraw%2FApatite%2020Mar25' });
    expect(moduleUrl('sessions', (r as { route: string }).route, { server: 'http://h', atlas: '' })).toBe(
      'http://h/app/#/ingest?path=%2FVolumes%2Flab%2Fraw%2FApatite%2020Mar25',
    );
    expect(resolve('laicpmsdb://ingest?path=L:%5Craw%5Cx')).toMatchObject({ route: '/app/ingest?path=L%3A%5Craw%5Cx' });
    expect(resolve('laicpmsdb://ingest')).toMatchObject({ kind: 'refused', reason: /without a valid path/ });
  });

  it('laicpmsdb search -> Sessions search by label', () => {
    expect(resolve('laicpmsdb://search?label=KD27_41')).toMatchObject({ tab: 'sessions', route: '/app/search?label=KD27_41' });
  });

  it('laicpmsdb auth callback -> sign-in code, from the query or the hash laicpmsdb appends', () => {
    expect(resolve('laicpmsdb://auth/callback?code=Ab-1_x')).toEqual({ kind: 'auth', code: 'Ab-1_x', url: 'laicpmsdb://auth/callback?code=Ab-1_x' });
    expect(resolve('laicpmsdb://auth/callback#/auth/callback?code=Zz9')).toMatchObject({ kind: 'auth', code: 'Zz9' });
    expect(resolve('laicpmsdb://auth/callback')).toMatchObject({ kind: 'refused', reason: /without a valid code/ });
    expect(resolve('laicpmsdb://auth/callback?code=a%20b')).toMatchObject({ kind: 'refused' });
  });

  it('https -> system browser', () => {
    expect(resolve('https://github.com/duserzym/laicpmsdb')).toEqual({
      kind: 'external',
      url: 'https://github.com/duserzym/laicpmsdb',
    });
  });
});

describe('resolve: tolerance', () => {
  it('accepts the trailing slash Windows appends to deep links', () => {
    expect(resolve(`laicpmsdb://acquisition/${A}/`)).toMatchObject({ route: `/app/acquisitions/${A}` });
  });

  it('accepts surrounding whitespace and upper-case scheme', () => {
    expect(resolve(`  LAICPMSDB://session/${A}\n`)).toMatchObject({ kind: 'tab', tab: 'sessions' });
  });
});

describe('resolve: refusals', () => {
  it.each([
    ['javascript:alert(1)', /unknown scheme "javascript:"/],
    ['file:///etc/passwd', /unknown scheme "file:"/],
    ['mailto:someone@example.com', /unknown scheme "mailto:"/],
    ['ftp://example.com/x', /unknown scheme "ftp:"/],
    ['not a url', /not a URL/],
    ['', /not a URL/],
    [`laicpmsdb://drop/${A}`, /unknown laicpmsdb link/],
    ['laicpmsdb://acquisition', /unknown laicpmsdb link/],
    [`laicpmsdb://acquisition/${A}/extra`, /unknown laicpmsdb link/],
    [`grainatlas://project/${A}/grain/${B}`, /unknown grainatlas link/],
    [`upbr://project/${A}`, /unknown upbr link/],
    ['laicpmsdb://acquisition/..%2F..%2Fadmin', /invalid id/],
    ['laicpmsdb://acquisition/a%3Fb', /invalid id/],
    ['laicpmsdb://acquisition/%E0%A4%A', /malformed escape|invalid id/],
    [`laicpmsdb://user:pw@acquisition/${A}`, /credentials or port/],
  ])('%s', (url, reason) => {
    const r = resolve(url);
    expect(r.kind).toBe('refused');
    if (r.kind === 'refused') expect(r.reason).toMatch(reason);
  });
});

describe('moduleUrl', () => {
  const bases = { server: 'http://localhost:8000', atlas: 'tauri://localhost/modules/grainatlas/' };

  it('maps laicpmsdb routes onto its hash router', () => {
    expect(moduleUrl('sessions', `/app/acquisitions/${A}`, bases)).toBe(
      `http://localhost:8000/app/#/acquisitions/${A}`,
    );
  });

  it('keeps a server path prefix', () => {
    expect(moduleUrl('sessions', `/app/sessions/${A}`, { ...bases, server: 'https://lab.example/db/' })).toBe(
      `https://lab.example/db/app/#/sessions/${A}`,
    );
  });

  it('maps grainatlas routes onto the bundled build', () => {
    expect(moduleUrl('images', `/atlas/?project=${A}&spot=${B}`, bases)).toBe(
      `tauri://localhost/modules/grainatlas/index.html?project=${A}&spot=${B}`,
    );
  });

  it('maps grainatlas routes onto /atlas/ on the web', () => {
    expect(moduleUrl('images', `/atlas/?project=${A}`, { ...bases, atlas: '/atlas/' })).toBe(
      `/atlas/index.html?project=${A}`,
    );
  });

  it('round-trips resolve -> moduleUrl', () => {
    const r = resolve(`laicpmsdb://session/${A}`);
    expect(r.kind).toBe('tab');
    if (r.kind === 'tab') expect(moduleUrl(r.tab, r.route, bases)).toBe(`http://localhost:8000/app/#/sessions/${A}`);
  });

  it('gives module home URLs', () => {
    expect(moduleHome('sessions', bases)).toBe('http://localhost:8000/app/');
    expect(moduleHome('images', bases)).toBe('tauri://localhost/modules/grainatlas/index.html');
  });
});

describe('normaliseServerUrl', () => {
  it.each([
    ['http://localhost:8000', 'http://localhost:8000'],
    ['http://localhost:8000/', 'http://localhost:8000'],
    ['http://localhost:8000/app/', 'http://localhost:8000'],
    [' https://lab.example/db/app ', 'https://lab.example/db'],
  ])('%s -> %s', (input, out) => {
    expect(normaliseServerUrl(input)).toBe(out);
  });

  it.each(['localhost:8000', 'ftp://x', 'garbage'])('rejects %s', (input) => {
    expect(normaliseServerUrl(input)).toBeNull();
  });
});
