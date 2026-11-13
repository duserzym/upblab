import { test, expect, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';
import { calls } from './review-helpers';
import { problems } from './problems';
import { reviewFixtures, session } from './fixtures/review';
import { atlasStatusFixture as status, atlasDraftsFixture as drafts, atlasSyncedFixture as synced } from './fixtures/atlas-sync';

const missing = 'GrainAtlas is not installed (looked in /Applications and ~/Applications)';
async function openAtlas(page: Page, lastTab = 'images') {
  await page.route('**/modules/manifest.json', route => route.fulfill({ json: { modules: [{ name: 'grainatlas', version: 'fixture', source: 'fixture', sha256: 'fixture', entry: 'modules/grainatlas/index.html' }] } }));
  await page.addInitScript(installFakeTauri, {
    store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab, reviewScope: JSON.stringify({ kind: 'session', id: session.id, run: 'preferred' }) },
    fixtures: reviewFixtures, signedIn: true, grainatlasLaunchErrors: [missing],
  });
  await page.goto('./');
  await page.waitForFunction(() => (window as unknown as { __fake: { listeners: Map<string, unknown> } }).__fake.listeners.has('lab-bridge://notify'));
  await expect(page.getByRole('tab', { name: lastTab === 'review' ? 'Review' : lastTab === 'home' ? 'Home' : 'Images', exact: true })).toHaveAttribute('aria-selected', 'true');
  if (lastTab === 'review') await expect(page.locator('[data-spot-key]').first()).toBeVisible();
}
const emit = (page: Page, event: unknown, source = 'grainatlas') => page.evaluate(({ event, source }) =>
  (window as unknown as { __emit: (e: string, p: unknown) => void }).__emit('lab-bridge://notify', { event, source }), { event, source });
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const commands = async (page: Page) => (await calls(page)).filter(([name]) => name === 'module_command').map(([, args]) => args?.command);

for (const [width, height] of [[1512, 982], [1024, 640]]) {
  test.describe(`Atlas sync ${width} × ${height}`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width, height }); });

    test('today’s module has no strip, draft list, guard, focus polling or v4 commands', async ({ page }) => {
      await openAtlas(page);
      await expect(page.getByTestId('atlas-status-strip')).toHaveCount(0);
      // A different module cannot advertise Images support.
      await emit(page, status, 'sessions');
      await emit(page, { type: 'lab.atlas.status' });
      await expect(page.getByTestId('atlas-status-strip')).toHaveCount(0);
      await tab(page, 'Review').click();
      await expect(page.locator('[data-spot-key]').first()).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await tab(page, 'Home').click();
      await expect(page.getByRole('region', { name: 'Changes not yet in the database' })).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect((await commands(page)).filter(command => ['leave-edit', 'sync-draft', 'discard-draft', 'report-status', 'set-mode', 'open-project', 'atlas-synced'].includes((command as { type: string }).type))).toEqual([]);
      expect((await calls(page)).filter(([name, args]) => name === 'api_get' && String(args?.path).startsWith('/v1/atlas/projects/'))).toEqual([]);
    });

    test('strip takes layout space, launches standalone, and shows a launch error inline', async ({ page }) => {
      await openAtlas(page);
      await emit(page, { ...status, mode: 'view', state: 'in-sync' }, 'images');
      const strip = page.getByTestId('atlas-status-strip');
      await expect(strip).toContainText('In sync · v3 r41');
      await expect(strip.getByText(status.name)).toHaveAttribute('title', status.name);
      expect((await strip.boundingBox())!.height).toBeLessThanOrEqual(36);
      await expect.poll(async () => (await calls(page)).filter(([name]) => name === 'module_bounds').some(([, args]) => args?.module === 'images' && (args.bounds as { y: number }).y >= 84)).toBe(true);
      await strip.getByRole('button', { name: 'Open in GrainAtlas' }).click();
      await expect(strip.getByRole('status')).toContainText(missing);
      expect((await calls(page)).find(([name]) => name === 'grainatlas_launch')?.[1]).toEqual({ project: status.project, server: 'http://localhost:8000', code: 'ONE-TIME-FIXTURE', revision: 41 });
      await strip.getByRole('button', { name: 'Open in GrainAtlas' }).click();
      await expect(strip.getByRole('status')).toHaveCount(0);
      await expect.poll(() => problems(page, 'Images strip')).toEqual([]);
      await emit(page, drafts);
      await tab(page, 'Home').click();
      await expect(page.getByRole('region', { name: 'Changes not yet in the database' })).toBeVisible();
      await expect.poll(() => problems(page, 'Home drafts')).toEqual([]);
    });

    test('leave guard hides the module, Stay and Escape cancel, Keep draft switches', async ({ page }) => {
      await openAtlas(page);
      await emit(page, status);
      await tab(page, 'Review').click();
      const dialog = page.getByRole('dialog', { name: `Leave editing ${status.name}?` });
      await expect(dialog).toContainText('12 spots, 2 grains, 1 label, new images');
      await expect.poll(async () => (await calls(page)).some(([name, args]) => name === 'module_hide' && args?.module === 'images')).toBe(true);
      await expect(page.getByText('Hidden while a dialog is open', { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
      await expect(tab(page, 'Images')).toHaveAttribute('aria-selected', 'true');
      expect(await commands(page)).not.toContainEqual(expect.objectContaining({ type: 'leave-edit' }));
      await tab(page, 'Review').click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(tab(page, 'Images')).toHaveAttribute('aria-selected', 'true');
      await tab(page, 'Review').click();
      await dialog.getByRole('button', { name: 'Keep draft and leave' }).click();
      await expect(tab(page, 'Review')).toHaveAttribute('aria-selected', 'true');
      expect(await commands(page)).toContainEqual({ type: 'leave-edit', project: status.project, decision: 'keep-draft' });
    });

    test('Home draft actions serialize commands and require discard confirmation', async ({ page }) => {
      await openAtlas(page, 'home');
      await emit(page, drafts);
      const section = page.getByRole('region', { name: 'Changes not yet in the database' });
      await expect(section).toContainText('Demo zircon mount');
      await expect(section).toContainText('12 spots, 2 grains');
      await expect(section).toContainText(/changed \d{1,2}:\d{2}/);
      await section.getByRole('button', { name: 'Sync', exact: true }).click();
      await expect.poll(() => commands(page)).toContainEqual({ type: 'sync-draft', project: status.project });
      await expect(section.getByRole('button', { name: 'Sync', exact: true })).toBeDisabled();
      await expect(section.getByRole('button', { name: 'Discard', exact: true })).toBeDisabled();
      await emit(page, drafts);
      await section.getByRole('button', { name: 'Discard', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Discard draft?' });
      await expect(dialog).toContainText(`Discard 12 spot and 2 grain changes to ${status.name}? This cannot be undone.`);
      expect(await commands(page)).not.toContainEqual(expect.objectContaining({ type: 'discard-draft' }));
      await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
      await expect.poll(() => commands(page)).toContainEqual({ type: 'discard-draft', project: status.project });
      await expect(dialog).toHaveCount(0);
    });
  });
}

test('sync reloads Review once per mount revision and preserves run, sample filter and selected spot', async ({ page }) => {
  await openAtlas(page, 'review');
  await page.getByRole('button', { name: 'Sample Sample A', exact: true }).click({ modifiers: ['Alt'] });
  await page.locator('[data-spot-key="acq-2"]').click();
  await page.getByLabel('Filter spots').fill('Zircon');
  const path = `/v1/sessions/${session.id}/results?run=preferred`;
  const reads = async () => (await calls(page)).filter(([name, args]) => name === 'api_get' && args?.path === path).length;
  const before = await reads();
  await emit(page, synced);
  await expect.poll(reads).toBe(before + 1);
  await expect(page.getByRole('treeitem', { name: /Zircon_2/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-spot-key]')).toHaveCount(4);
  await expect(page.getByLabel('Filter spots')).toHaveValue('Zircon');
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
