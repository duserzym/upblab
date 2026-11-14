import { describe, expect, it, vi } from 'vitest';
import { atlasEditorUrl, moduleHome, moduleUrl, normaliseServerUrl, resolve, withTheme, withoutTheme } from './links';

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

  it('opens the sharing panel only for the supported session query', () => {
    const sharing = resolve(`laicpmsdb://session/${A}?panel=sharing&extra=ignored`);
    expect(sharing).toMatchObject({ tab: 'sessions', route: `/app/sessions/${A}?panel=sharing` });
    expect(moduleUrl('sessions', `/app/sessions/${A}?panel=sharing`, { server: 'http://h', atlas: '' })).toBe(
      `http://h/app/#/sessions/${A}?panel=sharing`,
    );
    expect(resolve(`laicpmsdb://session/${A}?panel=other`)).toMatchObject({ route: `/app/sessions/${A}` });
  });

  it('laicpmsdb sample -> Sessions tab', () => {
    expect(resolve(`laicpmsdb://sample/${A}`)).toMatchObject({ tab: 'sessions', route: `/app/samples/${A}` });
  });

  it('grainatlas spot -> standalone grainatlas', () => {
    expect(resolve(`grainatlas://project/${A}/spot/${B}`)).toEqual({
      kind: 'atlas',
      project: A,
      spot: B,
      url: `grainatlas://project/${A}/spot/${B}`,
    });
  });

  it('grainatlas project -> standalone grainatlas', () => {
    expect(resolve(`grainatlas://project/${A}`)).toEqual({ kind: 'atlas', project: A, url: `grainatlas://project/${A}` });
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
    expect(resolve(`upbr://run/${A}?server=http://h:8000`)).toMatchObject({ kind: 'studio', object: 'run', id: A, url: `upbr://run/${A}?server=http%3A%2F%2Fh%3A8000` });
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
    expect(resolve('laicpmsdb://auth/callback?error=orcid_access_denied')).toMatchObject({ kind: 'auth-error', error: 'orcid_access_denied' });
    expect(resolve('laicpmsdb://auth/callback?error=%3Cscript%3E')).toMatchObject({ kind: 'refused' });
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

  it('maps People routes through the same server hash router', () => {
    expect(moduleUrl('people', '/app/people?group=demo', {
      ...bases, server: 'https://lab.example/db/', theme: 'dark',
    })).toBe('https://lab.example/db/app/?theme=dark#/people?group=demo');
  });

  it('keeps incoming laicpmsdb links in Sessions and adds no people deep link', () => {
    expect(resolve(`laicpmsdb://session/${A}`)).toMatchObject({ tab: 'sessions' });
    expect(resolve('laicpmsdb://people')).toMatchObject({ kind: 'refused' });
  });

  it('maps grainatlas routes onto the bundled build', () => {
    expect(moduleUrl('images', `/atlas/?project=${A}&spot=${B}`, bases)).toBe(
      `tauri://localhost/modules/grainatlas/index.html?server=http%3A%2F%2Flocalhost%3A8000&project=${A}&spot=${B}`,
    );
  });

  it('maps grainatlas routes onto /atlas/ on the web', () => {
    expect(moduleUrl('images', `/atlas/?project=${A}`, { ...bases, atlas: '/atlas/' })).toBe(
      `/atlas/index.html?server=http%3A%2F%2Flocalhost%3A8000&project=${A}`,
    );
  });

  it('round-trips resolve -> moduleUrl', () => {
    const r = resolve(`laicpmsdb://session/${A}`);
    expect(r.kind).toBe('tab');
    if (r.kind === 'tab') expect(moduleUrl(r.tab, r.route, bases)).toBe(`http://localhost:8000/app/#/sessions/${A}`);
  });

  it('gives module home URLs', () => {
    expect(moduleHome('sessions', bases)).toBe('http://localhost:8000/app/');
    expect(moduleHome('people', bases)).toBe('http://localhost:8000/app/#/people');
    expect(moduleHome('images', bases)).toBe('tauri://localhost/modules/grainatlas/index.html');
  });

  it.each(['light', 'dark'] as const)('gives People a themed home with a server prefix (%s)', (theme) => {
    expect(moduleHome('people', { ...bases, server: 'https://lab.example/db/', theme }))
      .toBe(`https://lab.example/db/app/?theme=${theme}#/people`);
  });
});

describe('atlasEditorUrl', () => {
  it('adds project and spot to the hosted home, keeping its parameters', () => {
    vi.stubGlobal('location', { href: 'https://lab.example/desk/' });
    expect(atlasEditorUrl('https://lab.example/atlas/?server=https%3A%2F%2Flab.example&theme=dark', A, B))
      .toBe(`https://lab.example/atlas/?server=https%3A%2F%2Flab.example&theme=dark&project=${A}&spot=${B}`);
    expect(atlasEditorUrl('/atlas/', A, null)).toBe(`https://lab.example/atlas/?project=${A}`);
    vi.unstubAllGlobals();
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

describe('withTheme', () => {
  it('adds ?theme= before the hash route, or &theme= after a query', () => {
    expect(withTheme('http://h/app/#/sessions/x', 'dark')).toBe('http://h/app/?theme=dark#/sessions/x');
    expect(withTheme('/atlas/index.html?project=p', 'light')).toBe('/atlas/index.html?project=p&theme=light');
    expect(withTheme('http://h/app/', undefined)).toBe('http://h/app/');
    expect(moduleHome('images', { server: 'http://h', atlas: '/atlas/', theme: 'light' })).toBe('/atlas/index.html?theme=light');
  });
});


describe('live theme URL handling', () => {
  it('replaces old themes without changing a hash route or duplicating the parameter', () => {
    expect(withTheme('http://h/app/?theme=light&theme=dark#/sessions/x', 'dark'))
      .toBe('http://h/app/?theme=dark#/sessions/x');
    expect(withTheme('/atlas/?project=p&theme=dark', 'light')).toBe('/atlas/?project=p&theme=light');
  });
  it('ignores only theme when deciding whether a module needs navigation', () => {
    expect(withoutTheme('/atlas/?project=p&theme=dark')).toBe('/atlas/?project=p');
    expect(withoutTheme('http://h/app/?theme=light#/sessions/x')).toBe('http://h/app/#/sessions/x');
    expect(withoutTheme('/atlas/')).toBe('/atlas/');
  });
});

describe('resolve: laicpmsdb data model and method codes', () => {
  it('data model overview, table and column -> Sessions tab', () => {
    expect(resolve('laicpmsdb://data-model')).toMatchObject({ kind: 'tab', tab: 'sessions', route: '/app/data-model' });
    expect(resolve('laicpmsdb://data-model/acquisition')).toMatchObject({ route: '/app/data-model/acquisition' });
    expect(resolve('laicpmsdb://data-model/acquisition/started_at')).toMatchObject({
      route: '/app/data-model/acquisition/started_at',
    });
    expect(moduleUrl('sessions', '/app/data-model/acquisition/started_at', { server: 'http://h', atlas: '' })).toBe(
      'http://h/app/#/data-model/acquisition/started_at',
    );
  });

  it('method code -> Sessions tab, upper-cased', () => {
    expect(resolve('laicpmsdb://method-code/rd-dh-poly')).toMatchObject({ tab: 'sessions', route: '/app/method-codes/RD-DH-POLY' });
  });

  it('refuses malformed names and codes', () => {
    expect(resolve('laicpmsdb://data-model/Acquisition')).toMatchObject({ kind: 'refused' });
    expect(resolve('laicpmsdb://data-model/a/b/c')).toMatchObject({ kind: 'refused' });
    expect(resolve('laicpmsdb://data-model/acquisition/started_at%3Fx')).toMatchObject({ kind: 'refused' });
    expect(resolve('laicpmsdb://method-code/R')).toMatchObject({ kind: 'refused' });
    expect(resolve('laicpmsdb://method-code/RD-DH-POLY-X-Y')).toMatchObject({ kind: 'refused' });
  });
});


describe('opener links', () => {
  it('keeps only the four known Studio parameters and strips fragments', () => {
    const r = resolve(`upbr://run/${A}?acquisition=${B}&via=upblab&extra=ignored&code=C&server=https://lab#ignored`);
    expect(r.kind).toBe('studio');
    const url = new URL(r.url);
    expect([...url.searchParams.keys()]).toEqual(['server', 'code', 'acquisition', 'via']);
    expect(url.searchParams.get('acquisition')).toBe(B);
    expect(url.hash).toBe('');
  });
  it('refuses invalid acquisition and via parameters', () => {
    for (const query of ['acquisition=', 'acquisition=../bad', 'acquisition=' + 'x'.repeat(129), 'via=other', 'via='])
      expect(resolve(`upbr://session/${A}?${query}`).kind).toBe('refused');
  });
  it('resolves a submitted run to Review', () => {
    expect(resolve(`laicpmsdb://run/${A}`)).toEqual({ kind: 'review-run', id: A, url: `laicpmsdb://run/${A}` });
    expect(resolve('laicpmsdb://run/..%2Fbad').kind).toBe('refused');
  });
});
