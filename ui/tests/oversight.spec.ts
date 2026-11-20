import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';
import { problems } from './problems';

// All records, people and credentials in this spec are invented.
const cedar = { id: 'cedar-account', username: 'cedar', display_name: 'Cedar Analyst' };
const moss = { id: 'moss-account', username: 'moss', display_name: 'Moss Analyst' };
const fern = { id: 'fern-account', username: 'fern', display_name: 'Fern Analyst with an intentionally very long invented display name' };
const accountName = 'Invented analyst with a very long account name for header layout';
const appVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
const session = (id: string, name: string) => ({ id, session_key: name, material: 'zircon', started_at: null, acquisition_count: 1, run_count: 0, preferred_run: null, owner_name: 'Cedar Analyst', spot_kinds: { sample: 1 } });
async function setup(page: Page, desktop: boolean, theme: string, options: { canViewAs?: boolean; accountPages?: boolean; accountsError?: boolean } = {}) {
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
    if (url.pathname === '/v1/accounts/me') body = { username: 'demo', display_name: accountName, can_view_as: options.canViewAs ?? true, can_manage_people: true };
    else if (url.pathname === '/v1/accounts') {
      if (url.searchParams.get('view_as') === 'true' && options.accountsError) {
        status = 403; body = { detail: 'Invented account directory unavailable.' };
      } else if (url.searchParams.get('view_as') === 'true' && options.accountPages) {
        body = more ? [moss, fern] : [cedar];
        if (!more) headers['X-Next-Cursor'] = 'account/next';
      } else body = [cedar, moss, fern];
    } else if (url.pathname === '/v1/groups') body = [{ id: 'team', name: 'Demo team' }];
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
  // The fake host must report a real version: returning null for the native
  // version command used to leave a narrower "v" chip and mask the web failure.
  if (desktop) await page.addInitScript(installFakeTauri, { store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'home', theme, themeChosen: true }, signedIn: true, accountName, appVersion, peopleAllowed: true, canViewAs: options.canViewAs ?? true, apiPassthrough: true, renderModules: true, studioFound: true });
  else await page.addInitScript(({ theme }) => {
    localStorage.setItem('upbstudio.settings', JSON.stringify({ mode: 'server', lastTab: 'home', theme, themeChosen: true }));
    sessionStorage.setItem('upbstudio.token:http://localhost:8000', 'invented-viewer-token');
  }, { theme });
  await page.goto(desktop ? './' : './?server=http://localhost:8000');
  await expect(page.getByTestId('session-card')).toHaveCount(2);
  await expect(page.locator('header.bar').getByTestId('app-version')).toHaveText(`v${appVersion}`);
  return { requests, holdOld: () => { hold = true; }, release: () => { hold = false; releaseOld?.(); } };
}

/** Every header control stays in the 48 px row; scope controls consume no content height. */
async function expectHeaderLayout(page: Page, viewing = false) {
  const header = page.locator('header.bar');
  await expect(header.getByRole('tab')).toHaveCount(6);
  await expect(header.getByTestId('check-updates')).toBeVisible();
  if (page.viewportSize()!.width > 1100) await expect(header.getByTestId('app-version')).toBeVisible();
  await expect(header.locator('.account-name')).toHaveText(accountName);
  await expect(viewing ? header.getByTestId('view-as-banner') : header.getByLabel('View as', { exact: true })).toBeVisible();
  await expect(page.locator('.oversight-bar')).toHaveCount(0);
  const layout = await header.evaluate(bar => {
    const box = bar.getBoundingClientRect();
    const name = (el: Element) => el.getAttribute('aria-label') || el.getAttribute('data-testid') || el.textContent?.trim().slice(0, 60) || el.tagName;
    const inside = (r: DOMRect, parent: DOMRect) => r.left >= parent.left - 0.5 && r.right <= parent.right + 0.5 && r.top >= parent.top - 0.5 && r.bottom <= parent.bottom + 0.5;
    // Include nested buttons/selects/chips and all of the scope control's fixed
    // parts. A fitting outer box does not prove that its children fit or work.
    const controls = Array.from(bar.querySelectorAll('.brand, .tabs, .view-as-control, .view-as-control > *, button, select, .chip, input, a[href]'))
      .map(el => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0);
    const overflow: string[] = [], overlaps: string[] = [];
    for (const { el, rect } of controls) {
      if (!inside(rect, box)) overflow.push(`${name(el)} outside header`);
      for (let parent = el.parentElement; parent && parent !== bar; parent = parent.parentElement) {
        if (!inside(rect, parent.getBoundingClientRect())) overflow.push(`${name(el)} outside ${name(parent)}`);
      }
    }
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i], b = controls[j];
      // Containment (the warning chip contains Exit) is intentional; overlap
      // between separate controls, including their children, is not.
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 0.5 &&
          Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top) > 0.5)
        overlaps.push(`${name(a.el)} overlaps ${name(b.el)}`);
    }
    const banner = bar.querySelector('[data-testid="view-as-banner"]');
    const exit = banner?.querySelector('button');
    const exitRect = exit?.getBoundingClientRect();
    const hit = exitRect ? document.elementFromPoint(exitRect.left + exitRect.width / 2, exitRect.top + exitRect.height / 2) : null;
    const viewedName = banner?.querySelector('.viewed-name');
    return {
      height: box.height, bottom: box.bottom,
      contentTop: document.querySelector('main.content')!.getBoundingClientRect().top,
      overflow, overlaps,
      exitReceivesPointer: !!exit && (hit === exit || (hit !== null && exit.contains(hit))),
      exitHit: hit ? name(hit) : null,
      nameFitsMinimum: !!viewedName && viewedName.getBoundingClientRect().width >= parseFloat(getComputedStyle(viewedName).minWidth) - 0.5,
      sideways: document.documentElement.scrollWidth > innerWidth || bar.scrollWidth > bar.clientWidth,
    };
  });
  expect(layout.height).toBe(48);
  expect(layout.contentTop).toBeCloseTo(layout.bottom, 0);
  expect(layout.overflow).toEqual([]);
  expect(layout.overlaps).toEqual([]);
  if (viewing) {
    expect(layout.nameFitsMinimum).toBe(true);
    expect(layout.exitReceivesPointer, `Exit centre hit ${layout.exitHit}`).toBe(true);
  }
  expect(layout.sideways).toBe(false);
}

for (const desktop of [true, false]) for (const [width, height] of [[1280, 800], [1440, 900]]) for (const theme of ['light', 'dark']) {
  test(`${desktop ? 'desktop' : 'web'} oversight ${width}x${height} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); const { requests } = await setup(page, desktop, theme);
    await expectHeaderLayout(page);
    const selector = page.locator('header.bar').getByLabel('View as', { exact: true });
    await expect(selector.locator('option').first()).toHaveText('Your own view');
    await page.locator('header.bar').getByRole('tab').last().focus();
    await page.keyboard.press('Tab');
    await expect(selector).toBeFocused();
    await expect(page.getByTestId('session-card').first()).toContainText('Owner: Cedar Analyst');
    await expect(page.getByTestId('mount-card')).toContainText('Owner: Moss Analyst');
    await page.getByLabel('Person', { exact: true }).selectOption('cedar');
    await page.getByLabel('Group/team', { exact: true }).selectOption('Demo team');
    await page.getByLabel('Project', { exact: true }).selectOption('DEMO');
    await page.getByLabel('Lab', { exact: true }).selectOption('demo-lab');
    await expect(page.getByTestId('session-card')).toHaveCount(1);
    await expect.poll(() => requests.some(r => r.path === '/v1/sessions' && ['owner=cedar', 'team=Demo+team', 'project=DEMO', 'lab=demo-lab'].every(q => r.query.includes(q)))).toBe(true);
    await page.getByRole('button', { name: 'Records · Samples and Projects', exact: true }).click();
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
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await expect(page.getByTestId('home-pins')).toBeVisible();
    await page.getByLabel('View as', { exact: true }).selectOption('cedar');
    await expect(page.getByTestId('home-pins')).toHaveCount(0);
    await expect(page.getByTestId('session-card').getByRole('button', { name: /^Pin / })).toHaveCount(0);
    await expect(page.getByTestId('view-as-banner')).toContainText('Viewing as Cedar Analyst (read-only)');
    await expect(page.getByTestId('view-as-banner')).toHaveAttribute('role', 'status');
    await expect(page.getByLabel('View as', { exact: true })).toHaveCount(0);
    await expectHeaderLayout(page, true);
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
    for (const name of ['People & access', 'Review', 'TIMS', 'Reduce', 'Home', 'Sessions']) {
      await page.getByRole('tab', { name, exact: true }).click();
      await expectHeaderLayout(page, true);
    }
    await page.getByRole('button', { name: 'Exit', exact: true }).click();
    await expect(page.getByTestId('view-as-banner')).toHaveCount(0);
    await expect(selector).toHaveValue('');
    await expectHeaderLayout(page);
    await page.getByRole('tab', { name: 'Home', exact: true }).click();
    await expect(page.getByTestId('session-card')).toContainText('Own scope session');
    await expect(page.getByText('Cedar scope session', { exact: true })).toHaveCount(0);
    expect(requests.slice(index).filter(r => r.method !== 'GET' && r.method !== 'OPTIONS' && new URLSearchParams(r.query).has('as'))).toEqual([]);
    expect(await problems(page, 'Oversight Home')).toEqual([]);
    expect(requests.filter(r => r.query.includes('as=cedar') && r.authorization).every(r => r.authorization === (desktop ? 'Bearer DEMO-SCREENSHOTS-TOKEN' : 'Bearer invented-viewer-token'))).toBe(true);
    // Repeat with a long target name as well as the long caller name. Both
    // delivery modes retain the same full version chip at these viewport sizes.
    await selector.selectOption('fern');
    await expectHeaderLayout(page, true);
    await expect(page.getByTestId('view-as-banner')).toHaveAttribute('title', `Viewing as ${fern.display_name} (read-only)`);
    await page.locator('header.bar').getByRole('button', { name: 'Exit', exact: true }).click();
    await expectHeaderLayout(page);
  });
}
for (const desktop of [true, false]) for (const theme of ['light', 'dark']) {
  test(`${desktop ? 'desktop' : 'web'} compact oversight header 1024x640 ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 640 });
    await setup(page, desktop, theme);
    await expectHeaderLayout(page);
    await expect(page.locator('header.bar').getByTestId('app-version')).toBeHidden();
    await page.getByLabel('View as', { exact: true }).selectOption('fern');
    await expectHeaderLayout(page, true);
    await page.locator('header.bar').getByRole('button', { name: 'Exit', exact: true }).click();
    await expectHeaderLayout(page);
  });
}
for (const desktop of [true, false]) {
  test(`${desktop ? 'desktop' : 'web'} header pages accounts on demand`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { requests } = await setup(page, desktop, 'light', { accountPages: true });
    const header = page.locator('header.bar'), selector = header.getByLabel('View as', { exact: true });
    await expect(selector.locator('option[value="cedar"]')).toHaveCount(1);
    await expect(selector.locator('option[value="moss"]')).toHaveCount(0);
    await expectHeaderLayout(page);
    expect(requests.filter(r => r.path === '/v1/accounts' && r.query.includes('view_as=true'))).toHaveLength(1);
    await header.getByRole('button', { name: 'More accounts', exact: true }).click();
    await expect(selector.locator('option[value="moss"]')).toHaveCount(1);
    await expect(header.getByRole('button', { name: 'More accounts', exact: true })).toHaveCount(0);
    const directoryReads = requests.filter(r => r.path === '/v1/accounts' && r.query.includes('view_as=true'));
    expect(directoryReads).toHaveLength(2);
    expect(directoryReads[1].query).toContain('after=account%2Fnext');
    expect(directoryReads.every(r => new URLSearchParams(r.query).has('limit'))).toBe(true);
    await selector.selectOption('fern');
    await expectHeaderLayout(page, true);
    await expect(header.getByTestId('view-as-banner')).toContainText(`Viewing as ${fern.display_name} (read-only)`);
    await expect(header.locator('.viewed-name')).toHaveAttribute('title', fern.display_name);
    await expect(header.getByRole('button', { name: 'Exit', exact: true })).toBeVisible();
    await header.getByRole('button', { name: 'Exit', exact: true }).click();
    await expectHeaderLayout(page);
  });

  test(`${desktop ? 'desktop' : 'web'} header shows compact account load errors`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setup(page, desktop, 'dark', { accountsError: true });
    const error = page.locator('header.bar .load-error');
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute('role', 'status');
    await expect(error).toHaveAttribute('title', /403.*Invented account directory unavailable/);
    await expect(error).toContainText('Invented account directory unavailable.');
    await expectHeaderLayout(page);
  });

  test(`${desktop ? 'desktop' : 'web'} header hides View as without permission`, async ({ page }) => {
    const { requests } = await setup(page, desktop, 'light', { canViewAs: false });
    await expect(page.getByLabel('View as', { exact: true })).toHaveCount(0);
    expect(requests.filter(r => r.path === '/v1/accounts' && r.query.includes('view_as=true'))).toHaveLength(0);
  });

  test(`${desktop ? 'desktop' : 'web'} header hides View as after sign-out`, async ({ page }) => {
    await setup(page, desktop, 'light');
    await expect(page.locator('header.bar').getByLabel('View as', { exact: true })).toBeVisible();
    await page.locator('header.bar button.account').click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByLabel('View as', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('view-as-banner')).toHaveCount(0);
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
