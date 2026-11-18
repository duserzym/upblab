import { expect, test, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';
import { problems } from './problems';

// All records, people and credentials in this spec are invented.
const cedar = { id: 'cedar-account', username: 'cedar', display_name: 'Cedar Analyst' };
const moss = { id: 'moss-account', username: 'moss', display_name: 'Moss Analyst' };
const session = (id: string, name: string) => ({ id, session_key: name, material: 'zircon', started_at: null, acquisition_count: 1, run_count: 0, preferred_run: null, owner_name: 'Cedar Analyst', spot_kinds: { sample: 1 } });
async function setup(page: Page, desktop: boolean, theme: string) {
  const requests: { path: string; query: string; method: string; header?: string; authorization?: string }[] = [];
  let releaseOld: (() => void) | undefined;
  let hold = false;
  await page.route('**/v1/**', async route => {
    const req = route.request(), url = new URL(req.url());
    requests.push({ path: url.pathname, query: url.search, method: req.method(), header: req.headers()['x-upbdb-oversight'], authorization: req.headers().authorization });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, X-UPbDB-Oversight', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS' } });
    const as = url.searchParams.get('as'), more = url.searchParams.has('after');
    const all = !['owner', 'team', 'project', 'lab'].some(key => url.searchParams.has(key));
    const headers: Record<string, string> = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Next-Cursor, ETag' };
    let body: unknown = [], status = 200;
    if (url.pathname === '/v1/accounts/me') body = { username: 'demo', display_name: 'Demo analyst', can_view_as: true };
    else if (url.pathname === '/v1/accounts') body = [cedar, moss];
    else if (url.pathname === '/v1/groups') body = [{ id: 'team', name: 'Demo team' }];
    else if (url.pathname === '/v1/labs') body = [{ id: 'lab', handle: 'demo-lab', name: 'Demo lab' }];
    else if (url.pathname === '/v1/sessions') {
      if (as === 'cedar') body = [session('cedar-session', 'Cedar scope session')];
      else if (as === 'moss') body = [session('moss-session', 'Moss scope session')];
      else body = all ? [session('one', 'Own scope session'), session('two', 'Other owner session')] : [session('one', 'Own scope session')];
      if (hold && as === 'cedar') await new Promise<void>(resolve => releaseOld = resolve);
    } else if (url.pathname === '/v1/mounts') body = [{ id: 'mount', label: as ? `${as} mount` : 'Own mount', owner_name: 'Moss Analyst', grain_count: 1, spot_count: 1, atlas: null }];
    else if (url.pathname === '/v1/samples') {
      body = [{ id: more ? 'sample-two' : 'sample-one', name: as ? `${as} sample` : more ? 'Second sample' : 'First sample', owner_name: 'Cedar Analyst', material: 'zircon' }];
      if (!more) headers['X-Next-Cursor'] = 'sample/next';
    } else if (url.pathname === '/v1/projects') {
      body = [{ id: more ? 'project-two' : 'project-one', code: more ? 'DEMO-TWO' : 'DEMO', title: 'Invented project', owner_name: 'Moss Analyst' }];
      if (!more) headers['X-Next-Cursor'] = 'project/next';
    } else if (url.pathname === '/v1/auth/handoff') {
      status = req.headers()['x-upbdb-oversight'] === 'on-behalf' ? 200 : 403;
      body = status === 200 ? { code: 'invented-one-use-code' } : { code: 'oversight_confirm', owner: 'Cedar Analyst', detail: 'This operation belongs to Cedar Analyst.' };
    }
    await route.fulfill({ status, headers, json: body });
  });
  // A bridge-aware module stand-in records reads and scope change events.
  await page.route('**/app/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><p>UPbDB fixture</p><script>
    window.scopes = [];
    addEventListener('message', e => { if(e.data.push === 'oversight') window.scopes.push(e.data.oversight); });
    parent.postMessage({tag:'lab-bridge',v:5,id:'scope-read',op:'oversight'}, '*');
    addEventListener('message', e => { if(e.data.id === 'scope-read' && e.data.ok) window.scopes.push(e.data.result); });
  </script></body></html>` }));
  if (desktop) await page.addInitScript(installFakeTauri, { store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'home', theme, themeChosen: true }, signedIn: true, canViewAs: true, apiPassthrough: true, renderModules: true, studioFound: true });
  else await page.addInitScript(({ theme }) => {
    localStorage.setItem('upbstudio.settings', JSON.stringify({ mode: 'server', lastTab: 'home', theme, themeChosen: true }));
    sessionStorage.setItem('upbstudio.token:http://localhost:8000', 'invented-viewer-token');
  }, { theme });
  await page.goto(desktop ? './' : './?server=http://localhost:8000');
  await expect(page.getByTestId('session-card')).toHaveCount(2);
  return { requests, holdOld: () => { hold = true; }, release: () => { hold = false; releaseOld?.(); } };
}
for (const desktop of [true, false]) for (const [width, height] of [[1280, 800], [1440, 900]]) for (const theme of ['light', 'dark']) {
  test(`${desktop ? 'desktop' : 'web'} oversight ${width}x${height} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); const { requests } = await setup(page, desktop, theme);
    await expect(page.getByTestId('session-card').first()).toContainText('Owner: Cedar Analyst');
    await expect(page.getByTestId('mount-card')).toContainText('Owner: Moss Analyst');
    await page.getByLabel('Person', { exact: true }).selectOption('cedar');
    await page.getByLabel('Group/team', { exact: true }).selectOption('Demo team');
    await page.getByLabel('Project', { exact: true }).selectOption('DEMO');
    await page.getByLabel('Lab', { exact: true }).selectOption('demo-lab');
    await expect(page.getByTestId('session-card')).toHaveCount(1);
    await expect.poll(() => requests.some(r => r.path === '/v1/sessions' && ['owner=cedar', 'team=Demo+team', 'project=DEMO', 'lab=demo-lab'].every(q => r.query.includes(q)))).toBe(true);
    await expect(page.getByTestId('samples-row')).toContainText('Owner: Cedar Analyst');
    await expect(page.getByTestId('projects-row')).toContainText('Owner: Moss Analyst');
    await page.getByRole('button', { name: 'Show more samples', exact: true }).click();
    await page.getByRole('button', { name: 'Show more projects', exact: true }).click();
    await expect(page.getByTestId('samples-row')).toHaveCount(2); await expect(page.getByTestId('projects-row')).toHaveCount(2);
    expect(requests.some(r => r.path === '/v1/samples' && r.query.includes('after=sample%2Fnext'))).toBe(true);
    await page.getByTestId('samples-row').first().getByRole('button').click();
    await expect(page.getByRole('tab', { name: 'Sessions', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Person', { exact: true }).filter({ visible: true })).toHaveValue('cedar');
    await page.getByRole('tab', { name: 'Home', exact: true }).click();
    await page.getByLabel('View as', { exact: true }).selectOption('cedar');
    await expect(page.getByTestId('view-as-banner')).toContainText('Viewing as Cedar Analyst (read-only)');
    await expect(page.getByTestId('session-card')).toHaveCount(1); await expect(page.getByTestId('session-card')).toContainText('Cedar scope session');
    await expect(page.getByTestId('samples-list')).toContainText('cedar sample');
    await expect(page.getByRole('button', { name: 'Upload LA-ICP-MS session…', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Upload image set…', exact: true })).toHaveAttribute('title', /read-only/);
    await expect(page.getByTestId('session-card').getByRole('button', { name: 'Reduce', exact: true })).toBeDisabled();
    const index = requests.length;
    await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
    await expect.poll(async () => {
      const frame = page.frames().find(f => f.url().includes('/app/'));
      try { return await frame?.evaluate(() => (window as unknown as { scopes: unknown[] }).scopes); } catch { return []; }
    }).toContainEqual({ viewAs: { username: 'cedar', name: 'Cedar Analyst' }, onBehalf: false });
    await page.getByRole('button', { name: 'Exit', exact: true }).click();
    await expect(page.getByTestId('view-as-banner')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Home', exact: true }).click();
    await expect(page.getByTestId('session-card')).toContainText('Own scope session');
    await expect(page.getByText('Cedar scope session', { exact: true })).toHaveCount(0);
    expect(requests.slice(index).filter(r => r.method !== 'GET' && r.method !== 'OPTIONS' && new URLSearchParams(r.query).has('as'))).toEqual([]);
    expect(await problems(page, 'Oversight Home')).toEqual([]);
    expect(requests.filter(r => r.query.includes('as=cedar') && r.authorization).every(r => r.authorization === (desktop ? 'Bearer DEMO-SCREENSHOTS-TOKEN' : 'Bearer invented-viewer-token'))).toBe(true);
  });
}
test('view-as late replies cannot restore old rows after Exit or another scope', async ({ page }) => {
  const mock = await setup(page, true, 'light'); mock.holdOld();
  await page.getByLabel('View as', { exact: true }).selectOption('cedar');
  await expect(page.getByText('Own scope session', { exact: true })).toHaveCount(0);
  await expect.poll(() => mock.requests.some(r => r.path === '/v1/sessions' && r.query.includes('as=cedar'))).toBe(true);
  await page.getByRole('button', { name: 'Exit', exact: true }).click();
  await page.getByLabel('View as', { exact: true }).selectOption('moss');
  await expect(page.getByTestId('session-card')).toContainText('Moss scope session'); mock.release();
  await expect(page.getByTestId('session-card')).toContainText('Moss scope session'); await expect(page.getByText('Cedar scope session', { exact: true })).toHaveCount(0);
});
for (const desktop of [true, false]) test(`${desktop ? 'desktop' : 'web'} on-behalf retries once with the header after per-operation consent`, async ({ page }) => {
  const { requests } = await setup(page, desktop, 'light');
  // Handoff is the shell's server write; use it to exercise the shared rejection guard.
  await page.getByTestId('session-card').first().getByRole('button', { name: 'Reduce', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm on-behalf change' })).toContainText('Cedar Analyst');
  expect(requests.filter(r => r.path === '/v1/auth/handoff')).toHaveLength(1);
  await page.getByRole('button', { name: 'Confirm on behalf', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.path === '/v1/auth/handoff').length).toBe(2);
  expect(requests.filter(r => r.path === '/v1/auth/handoff').map(r => r.header)).toEqual([undefined, 'on-behalf']);
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await page.getByTestId('session-card').first().getByRole('button', { name: 'Reduce', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm on-behalf change' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(requests.filter(r => r.path === '/v1/auth/handoff').map(r => r.header)).toEqual([undefined, 'on-behalf', undefined]);
});
for (const desktop of [true, false]) test(`${desktop ? 'desktop' : 'web'} module receives oversight changes for one confirmed operation`, async ({ page }) => {
  await setup(page, desktop, 'light');
  await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
  const scopes = async () => {
    const frame = page.frames().find(f => f.url().includes('/app/'));
    try { return await frame?.evaluate(() => (window as unknown as { scopes: { viewAs: unknown; onBehalf: boolean }[] }).scopes) ?? []; } catch { return []; }
  };
  await expect.poll(scopes).toContainEqual({ viewAs: null, onBehalf: false });
  // Invoke the same API used by editor handoff controls while keeping this module mounted.
  await page.evaluate(() => {
    const path = '/src/lib/identity.svelte.ts';
    void import(path).then(({ identity }) => identity.handoff()).catch(() => {});
  });
  await expect(page.getByRole('dialog', { name: 'Confirm on-behalf change' })).toContainText('Cedar Analyst');
  await page.getByRole('button', { name: 'Confirm on behalf', exact: true }).click();
  await expect.poll(scopes).toContainEqual({ viewAs: null, onBehalf: true });
  await expect.poll(async () => (await scopes()).at(-1)).toEqual({ viewAs: null, onBehalf: false });
});
