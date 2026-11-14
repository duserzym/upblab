import { test, expect, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';
import { calls } from './review-helpers';
import { problems } from './problems';
import { reviewFixtures, session, mount } from './fixtures/review';
import { atlasStatusFixture as status, atlasDraftsFixture as drafts, atlasSyncedFixture as synced } from './fixtures/atlas-sync';

async function openAtlas(page: Page, lastTab = 'home', reviewScope = true) {
  await page.route('**/modules/manifest.json', route => route.fulfill({ json: { modules: [{ name: 'grainatlas', version: 'fixture', source: 'fixture', sha256: 'fixture', entry: 'modules/grainatlas/index.html' }] } }));
  await page.addInitScript(installFakeTauri, {
    store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab, ...(reviewScope ? { reviewScope: JSON.stringify({ kind: 'session', id: session.id, run: 'preferred' }) } : {}) },
    fixtures: reviewFixtures, signedIn: true,
  });
  await page.goto('./');
  await page.waitForFunction(() => (window as unknown as { __fake: { listeners: Map<string, unknown> } }).__fake.listeners.has('lab-bridge://notify'));
  await expect(page.getByRole('tab', { name: lastTab === 'review' ? 'Review' : 'Home', exact: true })).toHaveAttribute('aria-selected', 'true');
  if (lastTab === 'review') await expect(page.locator('[data-spot-key]').first()).toBeVisible();
}
const emit = (page: Page, event: unknown, source = 'grainatlas') => page.evaluate(({ event, source }) =>
  (window as unknown as { __emit: (e: string, p: unknown) => void }).__emit('lab-bridge://notify', { event, source }), { event, source });
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const commands = async (page: Page) => (await calls(page)).filter(([name]) => name === 'module_command').map(([, args]) => args?.command);
const quitRequest = (page: Page) => page.evaluate(() =>
  (window as unknown as { __quitRequest: () => Promise<void> }).__quitRequest());
const quitCalls = async (page: Page, command: 'quit_answer' | 'quit_confirm' | 'quit_cancel') =>
  (await calls(page)).filter(([name]) => name === command).map(([, args]) => args);
const editorCommands = ['leave-edit', 'sync-draft', 'discard-draft', 'set-mode', 'open-files'];

for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test(`a stored Images tab opens Home; unsynced edits and drafts add no strip, draft list or guard at ${width} × ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openAtlas(page, 'images');
    await expect(tab(page, 'Images')).toHaveCount(0);
    await emit(page, status);
    await emit(page, drafts);
    await expect(page.getByTestId('atlas-status-strip')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Changes not yet in the database' })).toHaveCount(0);
    await tab(page, 'Review').click();
    await expect(page.locator('[data-spot-key]').first()).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await tab(page, 'Home').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => problems(page, 'Home after atlas events')).toEqual([]);
    expect((await commands(page)).filter(command => editorCommands.includes((command as { type: string }).type))).toEqual([]);
  });
}

test('Home names drafts stranded by the former Images tab, never syncs them, and clears the line on an empty list', async ({ page }) => {
  await openAtlas(page);
  const line = page.getByTestId('stranded-drafts');
  await expect(line).toHaveCount(0);
  await emit(page, { ...drafts, drafts: [...drafts.drafts, { ...drafts.drafts[0], project: 'other-project', name: 'Other demo mount' }] }, 'images');
  await expect(line).toBeVisible();
  await expect(line).toContainText(`former Images tab for ${status.name}, Other demo mount.`);
  await expect.poll(() => problems(page, 'Home stranded drafts')).toEqual([]);
  expect((await commands(page)).filter(command => editorCommands.includes((command as { type: string }).type))).toEqual([]);
  await emit(page, { type: 'lab.atlas.drafts', drafts: [] }, 'images');
  await expect(line).toHaveCount(0);
  expect((await commands(page)).filter(command => (command as { type: string }).type === 'sync-draft')).toEqual([]);
});

test('quit answers go at once, with unsynced edits and drafts reported', async ({ page }) => {
  await openAtlas(page);
  await emit(page, status);
  await emit(page, drafts);
  await quitRequest(page);
  await expect.poll(() => quitCalls(page, 'quit_answer')).toEqual([{ id: 1, answer: 'go' }]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await quitCalls(page, 'quit_confirm')).toEqual([]);
  expect(await quitCalls(page, 'quit_cancel')).toEqual([]);
  expect((await commands(page)).filter(command => editorCommands.includes((command as { type: string }).type))).toEqual([]);
});

test('sync quietly refreshes Review once per mount revision and preserves run, sample filter and selected spot', async ({ page }) => {
  await openAtlas(page, 'review');
  await page.getByRole('button', { name: 'Sample Sample A', exact: true }).click({ modifiers: ['Alt'] });
  await page.locator('[data-spot-key="acq-2"]').click();
  await page.getByLabel('Filter spots').fill('Zircon');
  const path = `/v1/sessions/${session.id}/results?run=preferred`;
  const reads = async () => (await calls(page)).filter(([name, args]) => name === 'api_get' && args?.path === path).length;
  const before = await reads();
  const inventoryBefore = (await calls(page)).filter(([name, args]) => name === 'api_get' && ['/v1/sessions', '/v1/mounts'].includes(String(args?.path))).length;
  await emit(page, synced);
  await expect.poll(reads).toBe(before + 1);
  await expect(page.getByRole('treeitem', { name: /Zircon_2/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-spot-key]')).toHaveCount(4);
  await expect(page.getByLabel('Filter spots')).toHaveValue('Zircon');
  expect((await calls(page)).filter(([name, args]) => name === 'api_get' && ['/v1/sessions', '/v1/mounts'].includes(String(args?.path)))).toHaveLength(inventoryBefore);
  await emit(page, { ...synced, project: 'another-project-on-same-mount' });
  // A following status event is processed after the duplicate notice.
  await emit(page, { ...status, mode: 'view', state: 'in-sync', revision: 42 });
  expect(await reads()).toBe(before + 1);
  expect(await commands(page)).not.toContainEqual(expect.objectContaining({ type: 'atlas-synced' }));
  await tab(page, 'Sessions').click();
  await expect.poll(async () => (await calls(page)).some(([name, args]) => name === 'module_open' && args?.module === 'sessions')).toBe(true);
  await emit(page, { ...synced, revision: 43 });
  await expect.poll(() => commands(page)).toContainEqual({ type: 'atlas-synced', project: status.project, mount: synced.mount, revision: 43 });
});

test('an inbox notice for the signed-in server reads the project within one 5 s inbox tick; another server is ignored', async ({ page }) => {
  await page.clock.install();
  // No Review scope, so nothing else reads this project.
  await openAtlas(page, 'home', false);
  const project = 'project-inbox';
  const path = `/v1/atlas/projects/${project}`;
  const reads = async () => (await calls(page)).filter(([name, args]) => name === 'api_get' && args?.path === path).length;
  const takes = async () => (await calls(page)).filter(([name]) => name === 'inbox_take').length;
  const push = (notice: Record<string, unknown>) => page.evaluate(n => (window as unknown as { __inbox: unknown[] }).__inbox.push(n), notice);
  await expect.poll(takes).toBeGreaterThan(0);
  expect(await reads()).toBe(0);

  await push({ type: 'lab.atlas.synced', project, mount: mount.id, server: 'http://elsewhere.test:8000' });
  let before = await takes();
  await page.clock.fastForward(6000);
  await expect.poll(takes).toBeGreaterThan(before);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __inbox: unknown[] }).__inbox.length)).toBe(0);
  expect(await reads()).toBe(0);

  await push({ type: 'lab.atlas.synced', project, mount: mount.id, server: 'http://localhost:8000/' });
  before = await takes();
  await page.clock.fastForward(6000);
  await expect.poll(takes).toBeGreaterThan(before);
  await expect.poll(reads).toBe(1);
});
