import { test, expect, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';
import { calls } from './review-helpers';
import { problems } from './problems';
import { reviewFixtures, session } from './fixtures/review';
import { atlasStatusFixture as status, atlasDraftsFixture as drafts, atlasSyncedFixture as synced } from './fixtures/atlas-sync';

const missing = 'GrainAtlas is not installed (looked in /Applications and ~/Applications)';
async function openAtlas(page: Page, lastTab = 'images', timeoutMs?: number) {
  await page.route('**/modules/manifest.json', route => route.fulfill({ json: { modules: [{ name: 'grainatlas', version: 'fixture', source: 'fixture', sha256: 'fixture', entry: 'modules/grainatlas/index.html' }] } }));
  await page.addInitScript(installFakeTauri, {
    store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab, reviewScope: JSON.stringify({ kind: 'session', id: session.id, run: 'preferred' }) },
    fixtures: reviewFixtures, signedIn: true, grainatlasLaunchErrors: [missing],
  });
  await page.goto(timeoutMs ? `./?atlas-command-timeout=${timeoutMs}` : './');
  await page.waitForFunction(() => (window as unknown as { __fake: { listeners: Map<string, unknown> } }).__fake.listeners.has('lab-bridge://notify'));
  await expect(page.getByRole('tab', { name: lastTab === 'review' ? 'Review' : lastTab === 'home' ? 'Home' : 'Images', exact: true })).toHaveAttribute('aria-selected', 'true');
  if (lastTab === 'review') await expect(page.locator('[data-spot-key]').first()).toBeVisible();
}
const emit = (page: Page, event: unknown, source = 'grainatlas') => page.evaluate(({ event, source }) =>
  (window as unknown as { __emit: (e: string, p: unknown) => void }).__emit('lab-bridge://notify', { event, source }), { event, source });
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const commands = async (page: Page) => (await calls(page)).filter(([name]) => name === 'module_command').map(([, args]) => args?.command);

const completed = new WeakMap<Page, Set<string>>();
async function complete(page: Page, type: string, result: Record<string, unknown> = { ok: true }) {
  const seen = completed.get(page) ?? new Set<string>();
  completed.set(page, seen);
  await expect.poll(async () => (await commands(page)).some(command => (command as { type: string; id?: string }).type === type && !!(command as { id?: string }).id && !seen.has((command as { id: string }).id))).toBe(true);
  const command = (await commands(page)).filter(command => (command as { type: string }).type === type && !seen.has((command as { id: string }).id)).at(-1) as { id: string };
  seen.add(command.id);
  await page.evaluate(({ id, type, result }) =>
    (window as unknown as { __commandResult: (id: string, type: string, result: Record<string, unknown>) => Promise<void> }).__commandResult(id, type, result), { id: command.id, type, result });
}
const quitRequest = (page: Page) => page.evaluate(() =>
  (window as unknown as { __quitRequest: () => Promise<void> }).__quitRequest());
const quitCalls = async (page: Page, command: 'quit_answer' | 'quit_confirm' | 'quit_cancel') =>
  (await calls(page)).filter(([name]) => name === command).map(([, args]) => args);

for (const [width, height] of [[1440, 900], [1280, 800]]) {
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
      await quitRequest(page);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await quitCalls(page, 'quit_answer')).toEqual([{ id: 1, answer: 'go' }]);
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
      await expect(tab(page, 'Images')).toHaveAttribute('aria-selected', 'true');
      await expect(dialog.getByRole('button', { name: 'Stay', exact: true })).toBeDisabled();
      await complete(page, 'leave-edit');
      await expect(tab(page, 'Review')).toHaveAttribute('aria-selected', 'true');
      expect(await commands(page)).toContainEqual(expect.objectContaining({ type: 'leave-edit', id: expect.any(String), project: status.project, decision: 'keep-draft' }));
    });

    test('Home draft actions serialize commands and require discard confirmation', async ({ page }) => {
      await openAtlas(page, 'home');
      await emit(page, drafts);
      const section = page.getByRole('region', { name: 'Changes not yet in the database' });
      await expect(section).toContainText('Demo zircon mount');
      await expect(section).toContainText('12 spots, 2 grains');
      await expect(section).toContainText(/changed \d{1,2}:\d{2}/);
      await section.getByRole('button', { name: 'Sync', exact: true }).click();
      await expect.poll(() => commands(page)).toContainEqual(expect.objectContaining({ type: 'sync-draft', id: expect.any(String), project: status.project }));
      await expect(section.getByRole('button', { name: 'Sync', exact: true })).toBeDisabled();
      await expect(section.getByRole('button', { name: 'Discard', exact: true })).toBeDisabled();
      await emit(page, drafts);
      await expect(section.getByRole('button', { name: 'Sync', exact: true })).toBeDisabled();
      await complete(page, 'sync-draft', { ok: true, revision: 43 });
      await expect(section.getByRole('status')).toHaveText('Synced r43');
      await expect(section.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled();
      await section.getByRole('button', { name: 'Discard', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Discard draft?' });
      await expect(dialog).toContainText(`Discard 12 spot and 2 grain changes to ${status.name}? This cannot be undone.`);
      expect(await commands(page)).not.toContainEqual(expect.objectContaining({ type: 'discard-draft' }));
      await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
      await expect.poll(() => commands(page)).toContainEqual(expect.objectContaining({ type: 'discard-draft', id: expect.any(String), project: status.project }));
      await expect(dialog).toHaveCount(0);
      await complete(page, 'discard-draft');
      await expect(section.getByRole('status')).toHaveText('Draft discarded');
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


test('Sync and leave waits for completion from Images, ignoring other sources and ids', async ({ page }) => {
  await openAtlas(page);
  await emit(page, status);
  await tab(page, 'Home').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Sync and leave' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Syncing…');
  await expect(dialog.getByRole('button', { name: 'Stay', exact: true })).toBeDisabled();
  await expect.poll(() => commands(page)).toContainEqual(expect.objectContaining({ type: 'leave-edit', decision: 'sync', id: expect.any(String) }));
  const command = (await commands(page)).find(command => (command as { type: string }).type === 'leave-edit') as { id: string };
  const result = { type: 'lab.command.result', command: 'leave-edit', id: command.id, ok: true };
  await emit(page, result, 'sessions');
  await emit(page, { ...result, id: 'other-id' }, 'images');
  await emit(page, { ...status, mode: 'view', state: 'in-sync' });
  await expect(dialog).toBeVisible();
  await expect(tab(page, 'Images')).toHaveAttribute('aria-selected', 'true');
  await complete(page, 'leave-edit');
  await expect(dialog).toHaveCount(0);
  await expect(tab(page, 'Home')).toHaveAttribute('aria-selected', 'true');
});

test('Sync and leave conflict stays in Images with a review note and no leave-anyway action', async ({ page }) => {
  await openAtlas(page);
  await emit(page, status);
  await tab(page, 'Home').click();
  await page.getByRole('button', { name: 'Sync and leave' }).click();
  await complete(page, 'leave-edit', { ok: false, code: 'conflict' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(tab(page, 'Images')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('atlas-status-strip').getByRole('status')).toHaveText('Both changed: review the differences in GrainAtlas');
  await expect(page.getByRole('button', { name: /Leave anyway/ })).toHaveCount(0);
});

test('Sync and leave timeout keeps the dialog and leaves only when explicitly requested', async ({ page }) => {
  await openAtlas(page, 'images', 80);
  await emit(page, status);
  await tab(page, 'Home').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Sync and leave' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Sync did not finish: no reply in 60 s. Your draft is kept.');
  await expect(dialog.getByRole('button', { name: 'Stay', exact: true })).toHaveClass(/primary/);
  const before = await commands(page);
  await dialog.getByRole('button', { name: 'Leave anyway (draft kept)' }).click();
  await expect(tab(page, 'Home')).toHaveAttribute('aria-selected', 'true');
  expect(await commands(page)).toEqual(before);
});

for (const [label, decision] of [['Keep draft and leave', 'keep-draft'], ['Discard changes', 'discard']] as const) {
  test(`${label} waits and shows a failure with Stay / Leave anyway`, async ({ page }) => {
    await openAtlas(page);
    await emit(page, status);
    await tab(page, 'Home').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: label }).click();
    await expect.poll(() => commands(page)).toContainEqual(expect.objectContaining({ type: 'leave-edit', decision }));
    await expect(tab(page, 'Images')).toHaveAttribute('aria-selected', 'true');
    await complete(page, 'leave-edit', { ok: false, code: 'failed', error: 'Storage unavailable' });
    await expect(dialog.getByRole('status')).toContainText('Storage unavailable. Your draft is kept.');
    await expect(dialog.getByRole('button', { name: 'Leave anyway (draft kept)' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
    await expect(tab(page, 'Images')).toHaveAttribute('aria-selected', 'true');
  });
}

test('Home shows sync failure, conflict, timeout and completion even after the draft is cleared', async ({ page }) => {
  await openAtlas(page, 'home');
  await emit(page, drafts);
  const section = page.getByRole('region', { name: 'Changes not yet in the database' });
  const sync = section.getByRole('button', { name: 'Sync', exact: true });
  await sync.click();
  await complete(page, 'sync-draft', { ok: false, code: 'offline', error: 'Server unreachable' });
  await expect(section.getByRole('status')).toHaveText('Sync did not finish: Server unreachable. Draft kept.');
  await expect(sync).toBeEnabled();
  await sync.click();
  await complete(page, 'sync-draft', { ok: false, code: 'conflict' });
  await expect(section.getByRole('status')).toHaveText('Both changed: open it in Images to review the differences');
  await sync.click();
  await emit(page, { type: 'lab.atlas.drafts', drafts: [] });
  await complete(page, 'sync-draft', { ok: true, revision: 43 });
  await expect(section.getByRole('status')).toContainText('Synced r43');
  await page.goto('./?atlas-command-timeout=80');
  await page.waitForFunction(() => (window as unknown as { __fake: { listeners: Map<string, unknown> } }).__fake.listeners.has('lab-bridge://notify'));
  await emit(page, drafts);
  await sync.click();
  await expect(section.getByRole('status')).toHaveText('Sync did not finish: no reply in 60 s. Draft kept.');
  await expect(sync).toBeEnabled();
});

test('quit Cancel preserves the window and keep-drafts confirms only after completion', async ({ page }) => {
  await openAtlas(page);
  await emit(page, status);
  await emit(page, { ...drafts, drafts: [...drafts.drafts, { ...drafts.drafts[0], project: 'other-project', name: 'Other draft' }] });
  await quitRequest(page);
  const dialog = page.getByRole('dialog', { name: 'Quit with unsynced changes?' });
  await expect(dialog).toContainText('12 spots, 2 grains, 1 label, new images');
  await expect(dialog).toContainText('1 other draft');
  expect(await quitCalls(page, 'quit_answer')).toEqual([{ id: 1, answer: 'prompting' }]);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await quitCalls(page, 'quit_cancel')).toEqual([{ id: 1 }]);
  expect(await quitCalls(page, 'quit_confirm')).toEqual([]);
  await quitRequest(page);
  expect(await quitCalls(page, 'quit_answer')).toEqual([
    { id: 1, answer: 'prompting' }, { id: 2, answer: 'prompting' },
  ]);
  await dialog.getByRole('button', { name: 'Quit, keep drafts' }).click();
  await expect.poll(() => commands(page)).toContainEqual(expect.objectContaining({ type: 'leave-edit', decision: 'keep-draft', id: expect.any(String) }));
  expect(await quitCalls(page, 'quit_confirm')).toEqual([]);
  await complete(page, 'leave-edit');
  await expect.poll(() => quitCalls(page, 'quit_confirm')).toEqual([{ id: 2 }]);
});

test('v4 without unsynced changes or drafts answers go immediately', async ({ page }) => {
  await openAtlas(page);
  await emit(page, { ...status, mode: 'view', state: 'in-sync', changes: null });
  await emit(page, { type: 'lab.atlas.drafts', drafts: [] });
  await quitRequest(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await quitCalls(page, 'quit_answer')).toEqual([{ id: 1, answer: 'go' }]);
  expect(await quitCalls(page, 'quit_confirm')).toEqual([]);
  expect(await quitCalls(page, 'quit_cancel')).toEqual([]);
});

test('Sync and quit failure keeps the draft and Quit anyway confirms without another module command', async ({ page }) => {
  await openAtlas(page);
  await emit(page, status);
  await quitRequest(page);
  const dialog = page.getByRole('dialog', { name: 'Quit with unsynced changes?' });
  await dialog.getByRole('button', { name: 'Sync and quit' }).click();
  await complete(page, 'leave-edit', { ok: false, code: 'offline', error: 'Server unreachable' });
  await expect(dialog.getByRole('status')).toHaveText('Sync did not finish: Server unreachable. Your draft is kept.');
  expect(await quitCalls(page, 'quit_confirm')).toEqual([]);
  const before = await commands(page);
  await dialog.getByRole('button', { name: 'Quit anyway (draft kept)' }).click();
  await expect.poll(() => quitCalls(page, 'quit_confirm')).toHaveLength(1);
  expect(await commands(page)).toEqual(before);
});

test('Sync and quit conflict shows GrainAtlas differences, and drafts-only quit offers no sync', async ({ page }) => {
  await openAtlas(page);
  await emit(page, status);
  await quitRequest(page);
  const dialog = page.getByRole('dialog', { name: 'Quit with unsynced changes?' });
  await dialog.getByRole('button', { name: 'Sync and quit' }).click();
  await complete(page, 'leave-edit', { ok: false, code: 'conflict' });
  await expect(dialog).toHaveCount(0);
  expect(await quitCalls(page, 'quit_cancel')).toEqual([{ id: 1 }]);
  expect(await quitCalls(page, 'quit_confirm')).toEqual([]);
  await expect(page.getByTestId('atlas-status-strip')).toContainText('Both changed: review the differences in GrainAtlas');
  await emit(page, { ...status, mode: 'view', changes: null });
  await emit(page, drafts);
  await quitRequest(page);
  await expect(dialog.getByRole('button', { name: 'Sync and quit' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Quit, keep drafts' }).click();
  await expect.poll(() => quitCalls(page, 'quit_confirm')).toHaveLength(1);
});

test('Sync and quit timeout reports the draft kept; keep-drafts timeout still quits', async ({ page }) => {
  await openAtlas(page, 'images', 80);
  await emit(page, status);
  await quitRequest(page);
  const dialog = page.getByRole('dialog', { name: 'Quit with unsynced changes?' });
  await dialog.getByRole('button', { name: 'Sync and quit' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Sync did not finish: no reply in 60 s. Your draft is kept.');
  await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
  await expect.poll(() => quitCalls(page, 'quit_cancel')).toEqual([{ id: 1 }]);
  expect(await quitCalls(page, 'quit_confirm')).toEqual([]);
  await quitRequest(page);
  await dialog.getByRole('button', { name: 'Quit, keep drafts' }).click();
  await expect(dialog.getByRole('status')).toHaveText('No reply in 10 s. Quitting; drafts already stored by the module stay.');
  await expect.poll(() => quitCalls(page, 'quit_confirm')).toHaveLength(1);
});

test('Sync and quit waits for its result even when snapshots clear', async ({ page }) => {
  await openAtlas(page);
  await emit(page, status);
  await quitRequest(page);
  const dialog = page.getByRole('dialog', { name: 'Quit with unsynced changes?' });
  await dialog.getByRole('button', { name: 'Sync and quit' }).click();
  await emit(page, { ...status, mode: 'view', state: 'in-sync', changes: null });
  await emit(page, { type: 'lab.atlas.drafts', drafts: [] });
  await expect(dialog).toBeVisible();
  expect(await quitCalls(page, 'quit_confirm')).toEqual([]);
  await complete(page, 'leave-edit');
  await expect.poll(() => quitCalls(page, 'quit_confirm')).toHaveLength(1);
});

test('quit cancels an outstanding navigation; a late leave result cannot switch tabs after Cancel', async ({ page }) => {
  await openAtlas(page);
  await emit(page, status);
  await tab(page, 'Home').click();
  await page.getByRole('button', { name: 'Sync and leave' }).click();
  await expect.poll(() => commands(page)).toContainEqual(expect.objectContaining({ type: 'leave-edit', id: expect.any(String) }));
  await quitRequest(page);
  const dialog = page.getByRole('dialog', { name: 'Quit with unsynced changes?' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await complete(page, 'leave-edit');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(tab(page, 'Images')).toHaveAttribute('aria-selected', 'true');
  expect(await quitCalls(page, 'quit_confirm')).toEqual([]);
});
