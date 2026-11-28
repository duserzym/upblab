import { test, expect } from '@playwright/test';
import { openReview, calls, inside } from './review-helpers';
import { problems } from './problems';
import { session, mount, table, rows, reviewFixtures } from './fixtures/review';
import { inventedElements } from './fixtures/tims-atlas';
import { demoAtlas, demoAtlasStatus, demoElements, demoProject } from './fixtures/demo-atlas';

const resultPath = `/v1/sessions/${session.id}/results?run=preferred`;
const fixtures = {
  [`/v1/sessions/${session.id}`]: session,
  [`/v1/mounts/${mount.id}/elements`]: inventedElements,
  '/v1/atlas/projects/project-demo': { mount_id: mount.id, revision: 42, atlas_version: 1 },
  [`/v1/fractions?limit=500&mount=${mount.id}`]: [],
};
type Fake = { fixtures: Record<string, unknown>; apiReplies: Record<string, unknown>; holdApi(key: string): void; releaseApi(key: string): void };
for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test(`Refresh database keeps the Review scope, selection and filter with progress and retry at ${width} × ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openReview(page, { fixtures });
    await page.getByRole('button', { name: 'Sample Sample A', exact: true }).click({ modifiers: ['Alt'] });
    await page.locator('[data-spot-key="acq-2"]').click();
    await page.getByLabel('Filter spots').fill('Zircon');
    const pane = page.getByTestId('review-view');
    const button = page.getByRole('button', { name: 'Refresh database', exact: true });
    const scopeName = await page.getByRole('button', { name: 'Choose review scope' }).textContent();
    const runName = await page.getByRole('button', { name: 'Review run' }).textContent();
    const count = async () => (await calls(page)).filter(([cmd, args]) => cmd === 'api_get' && args?.path === resultPath).length;
    const before = await count();
    await page.evaluate(path => (window as unknown as { __fake: Fake }).__fake.holdApi(`GET ${path}`), resultPath);
    await button.click();
    await expect(page.getByRole('button', { name: 'Refreshing…', exact: true })).toBeDisabled();
    await expect(page.locator('#review-refresh-status')).toHaveText('Refreshing database…');
    await inside(page.getByRole('button', { name: 'Refreshing…', exact: true }), pane);
    await expect(page.locator('[data-spot-key="acq-2"]')).toBeVisible();
    await page.evaluate(({ path, next }) => {
      const fake = (window as unknown as { __fake: Fake }).__fake;
      fake.fixtures[path] = next; fake.releaseApi(`GET ${path}`);
    }, { path: resultPath, next: { ...table, rows: rows.map((row, i) => i === 1 ? { ...row, label: 'Zircon_2 refreshed' } : row) } });
    await expect(page.locator('#review-refresh-status')).toHaveText('Database refreshed.');
    expect(await count()).toBe(before + 1);
    await expect(page.getByLabel('Filter spots')).toHaveValue('Zircon');
    await expect(page.getByRole('button', { name: 'Choose review scope' })).toHaveText(scopeName!);
    await expect(page.getByRole('button', { name: 'Review run' })).toHaveText(runName!);
    await expect(page.getByRole('treeitem', { name: /Zircon_2 refreshed/ })).toHaveAttribute('aria-selected', 'true');
    await inside(button, pane);
    await page.evaluate(path => { (window as unknown as { __fake: Fake }).__fake.apiReplies[path] = { status: 503, body: { detail: 'Synthetic results unavailable' } }; }, resultPath);
    await button.click();
    await expect(page.locator('#review-refresh-status')).toContainText('503: Synthetic results unavailable');
    await expect(page.getByRole('treeitem', { name: /Zircon_2 refreshed/ })).toHaveAttribute('aria-selected', 'true');
    await page.evaluate(path => { delete (window as unknown as { __fake: Fake }).__fake.apiReplies[path]; }, resultPath);
    await page.getByRole('button', { name: 'Refresh database', exact: true }).click();
    await expect(page.locator('#review-refresh-status')).toHaveText('Database refreshed.');
    expect(await problems(page, 'Review database refresh')).toEqual([]);
  });
}

for (const delivery of ['desktop', 'web'] as const) test(`${delivery} mount refresh reopens the pinned SEM viewer on the selected spot with an unchanged image version`, async ({ page }) => {
  let revision = 1;
  const elementRevisions: number[] = [];
  const server = 'http://localhost:8000';
  const store = { mode: 'server', serverUrl: server, lastTab: 'review', reviewScope: JSON.stringify({ kind: 'mount', id: mount.id }), reviewSplit: true };
  const webFixtures: Record<string, unknown> = { ...reviewFixtures, ...fixtures, '/v1/accounts/me': { id: 'synthetic-account', username: 'demo' } };
  await page.route('http://localhost:8000/**', route => {
    const { pathname: path, search } = new URL(route.request().url());
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'X-Atlas-Version', 'X-Atlas-Version': '1' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path.endsWith('/atlas.json')) return route.fulfill({ json: demoAtlas, headers });
    if (path.endsWith('/project.json')) return route.fulfill({ json: demoProject, headers });
    if (path === '/v1/atlas/projects/project-demo') return route.fulfill({ json: { ...demoAtlasStatus, revision }, headers });
    if (path === '/v1/atlas/projects/project-demo/elements') {
      const spots = demoElements.spots.map(spot => revision > 1 && spot.id === 'atlas-2' ? { ...spot, grain_id: 'grain-2' } : spot);
      elementRevisions.push(revision);
      return route.fulfill({ json: { ...demoElements, revision, spots }, headers });
    }
    const body = webFixtures[path + search] ?? webFixtures[path];
    if (delivery === 'web' && body !== undefined) return route.fulfill({ json: body, headers });
    return route.fulfill({ status: 404, json: {}, headers });
  });
  const reported: number[] = [];
  page.on('console', message => {
    const raw = message.text();
    if (!raw.startsWith('[bridge] grainatlas: ')) return;
    const event = JSON.parse(raw.slice('[bridge] grainatlas: '.length));
    if (event.type === 'lab.atlas.status' && event.atlasVersion === 1 && event.revision !== null) reported.push(event.revision);
  });
  if (delivery === 'desktop') await openReview(page, { store, fixtures, renderModules: true });
  else {
    await page.addInitScript(settings => {
      if (window !== window.top) return;
      localStorage.setItem('upbstudio.settings', JSON.stringify(settings));
      sessionStorage.setItem(`upbstudio.token:${settings.serverUrl}`, 'INVENTED-REVIEW-TOKEN');
    }, store);
    await page.route('**/modules/manifest.json', route => route.fulfill({ json: { modules: [
      { name: 'grainatlas', version: 'demo', source: 'fixture', sha256: 'demo', entry: 'modules/grainatlas/index.html' },
    ] } }));
    await page.goto(`./?server=${encodeURIComponent(server)}`);
  }
  await page.getByRole('button', { name: 'Sample Sample A', exact: true }).click({ modifiers: ['Alt'] });
  await page.getByRole('treeitem', { name: /Zircon_2/ }).click();
  await expect.poll(() => reported).toContain(1);
  expect(elementRevisions).toContain(1);
  const before = delivery === 'web' ? await page.locator('iframe[title="grainatlas"]').elementHandle() : null;
  revision = 2;
  await page.getByRole('button', { name: 'Refresh database', exact: true }).click();
  await expect(page.locator('#review-refresh-status')).toHaveText('Database refreshed.');
  await expect.poll(() => reported).toContain(2);
  expect(elementRevisions).toContain(2);
  if (delivery === 'desktop') {
    const recorded = await calls(page);
    expect(recorded.filter(([cmd, args]) => cmd === 'api_get' && args?.path === `/v1/mounts/${mount.id}/elements`)).toHaveLength(1);
    const reloads = recorded.filter(([cmd, args]) => cmd === 'module_reload' && args?.module === 'images');
    expect(reloads).toHaveLength(1);
    expect(recorded.slice(recorded.indexOf(reloads[0]) + 1)).toEqual(expect.arrayContaining([
      ['module_command', expect.objectContaining({ module: 'images', command: expect.objectContaining({ type: 'review-spots', focus: expect.objectContaining({ spot: 'atlas-2' }) }) })],
    ]));
  } else {
    expect(await before?.evaluate(frame => frame.isConnected)).toBe(false);
  }
  await expect(page.getByRole('treeitem', { name: /Zircon_2/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Review run' })).toHaveCount(0);
});
