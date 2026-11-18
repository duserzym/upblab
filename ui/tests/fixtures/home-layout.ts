import { expect, type Page } from '@playwright/test';
import { installFakeTauri, type FakeOptions } from '../fake-tauri';
import { largeHomeFixtures, homeSessions } from './home';
import { runs } from './review';

// Batched list summaries, including sessions without a preferred completed run.
export const layoutFixtures: Record<string, unknown> = {
  ...largeHomeFixtures,
  '/v1/sessions': homeSessions.map((session, i) => ({ ...session,
    preferred_run: i % 5 === 0 ? null : { ...runs[0], session_id: session.id },
    run_count: i % 5 === 0 ? 0 : 2, spot_kinds: { sample: session.acquisition_count },
  })),
  '/v1/accounts': [], '/v1/groups': [], '/v1/labs': [],
  '/v1/samples': Array.from({ length: 40 }, (_, i) => ({ id: `sample-${i}`, name: `Sample ${i}`, material: 'zircon', owner_name: 'Demo analyst' })),
  '/v1/projects': Array.from({ length: 40 }, (_, i) => ({ id: `project-${i}`, code: `DEMO-${i}`, title: `Invented project ${i}`, owner_name: 'Demo analyst' })),
};

export async function layoutHome(page: Page, desktop: boolean, store: Record<string, unknown> = {}, fixtures = layoutFixtures, fakeOptions: Partial<FakeOptions> = {}) {
  await page.route('http://localhost:8000/**', route => route.fulfill({ json: {} }));
  await page.route('**/modules/manifest.json', route => route.fulfill({ json: { modules: [] } }));
  await page.route('**/atlas/projects/**', route => route.fulfill({ status: 404 }));
  await page.route('**/v1/**', route => {
    const url = new URL(route.request().url());
    const body = url.pathname === '/v1/accounts/me' ? { username: 'demo', display_name: 'Demo analyst' }
      : fixtures[url.pathname + url.search] ?? (url.searchParams.has('limit') && !url.searchParams.has('after') ? fixtures[url.pathname] : undefined);
    return route.fulfill({ status: body === undefined ? 404 : 200, json: body ?? {},
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Accept' } });
  });
  const saved = { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'home', theme: 'light', themeChosen: true, ...store };
  if (desktop) {
    // The real Tauri store survives reloads. Retain the fake's store on pagehide too.
    const options = { ...fakeOptions, store: saved, fixtures, signedIn: true,
      localSessions: Array.from({ length: 30 }, (_, i) => ({ path: `/invented/session-${i}`, key: `Local session ${i}`, id: null,
        material: 'zircon', kind: 'analytical', started_at: '2026-11-18', modified: '2026-11-18', acquisitions: 10, has_project: true })) };
    await page.addInitScript({ content: `{
      const options = ${JSON.stringify(options)};
      options.store = JSON.parse(localStorage.getItem('home-layout-fake-store') || 'null') || options.store;
      (${installFakeTauri.toString()})(options);
      addEventListener('pagehide', () => localStorage.setItem('home-layout-fake-store', JSON.stringify(window.__fake.store)));
    }` });
  } else {
    await page.addInitScript(saved => {
      if (!localStorage.getItem('upbstudio.settings')) localStorage.setItem('upbstudio.settings', JSON.stringify(saved));
      sessionStorage.setItem('upbstudio.token:http://localhost:8000', 'invented-token');
    }, saved);
  }
  await page.goto(desktop ? './' : './?server=http://localhost:8000');
  await expect(page.getByTestId('session-card')).toHaveCount(Math.min(500, (fixtures['/v1/sessions'] as unknown[]).length));
  await expect(page.getByTestId('mount-card')).toHaveCount(40);
}

export const storedLayout = (page: Page, desktop: boolean) => page.evaluate(desktop => desktop
  ? (window as unknown as { __fake: { store: Record<string, unknown> } }).__fake.store
  : JSON.parse(localStorage.getItem('upbstudio.settings') ?? '{}') as Record<string, unknown>, desktop);
