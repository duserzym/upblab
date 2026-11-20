import { expect, test, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';

// The former Images tab is gone: grainatlas lives in Review's SEM tile and as a standalone app.
const tabNames = (page: Page) => page.getByRole('tablist', { name: 'Modules' }).getByRole('tab').allTextContents();
const selected = (page: Page, name: string) => expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');

async function web(page: Page) {
  await page.route('http://localhost:8000/**', r => r.fulfill({ json: {} }));
  await page.route('**/modules/manifest.json', r => r.fulfill({ json: { modules: [] } }));
  await page.route('**/app/**', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>UPbDB</title>' }));
  await page.addInitScript(() => localStorage.setItem('upbstudio.settings', JSON.stringify({ mode: 'server', lastTab: 'images' })));
  await page.goto('./?server=http://localhost:8000');
}

test('web: no Images tab; a stored Images tab opens Home and Sessions is shortcut 2', async ({ page }) => {
  await web(page);
  await selected(page, 'Home');
  expect(await tabNames(page)).toEqual(['Home', 'Sessions', 'Review', 'Reduce', 'TIMS']);
  await expect(page.getByRole('tab', { name: 'Images' })).toHaveCount(0);
  for (const [i, name] of ['Home', 'Sessions', 'Review', 'Reduce', 'TIMS'].entries())
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('title', new RegExp(`\\(Ctrl/⌘ ${i + 1}\\)$`));
});

// App.svelte defines onKey (and the web drop handlers) but no <svelte:window>
// attaches them since e31c936, so web page shortcuts do nothing. Un-fixme once wired.
test.fixme('web: Ctrl/⌘ 1 to 5 open Home, Sessions, Review, Reduce and TIMS', async ({ page }) => {
  await web(page);
  await selected(page, 'Home');
  for (const [key, name] of [['2', 'Sessions'], ['3', 'Review'], ['4', 'Reduce'], ['5', 'TIMS'], ['1', 'Home']]) {
    await page.keyboard.press(`ControlOrMeta+${key}`);
    await selected(page, name);
  }
});

async function desktop(page: Page) {
  await page.route('**/modules/manifest.json', r => r.fulfill({ json: { modules: [] } }));
  await page.addInitScript(installFakeTauri, { store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'home' } });
  await page.goto('./');
  await page.waitForFunction(() => (window as unknown as { __fake: { listeners: Map<string, unknown> } }).__fake.listeners.has('shell://menu'));
}
const menu = (page: Page, id: string) => page.evaluate(id =>
  (window as unknown as { __emit(e: string, p: unknown): Promise<void> }).__emit('shell://menu', id), id);

test('desktop: the Tabs menu opens Sessions second and TIMS fifth; there is no Images tab', async ({ page }) => {
  await desktop(page);
  expect(await tabNames(page)).toEqual(['Home', 'Sessions', 'Review', 'Reduce', 'TIMS']);
  await menu(page, 'tab:sessions');
  await selected(page, 'Sessions');
  await menu(page, 'tab:tims');
  await selected(page, 'TIMS');
  await menu(page, 'tab:home');
  await selected(page, 'Home');
});

test('desktop: Close (⌘W) leaves Settings for the previous tab and changes nothing on Home', async ({ page }) => {
  await desktop(page);
  await page.getByRole('tab', { name: 'Reduce', exact: true }).click();
  await selected(page, 'Reduce');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await menu(page, 'shell:close');
  await selected(page, 'Reduce');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await selected(page, 'Home');
  const before = await page.locator('main').innerText();
  await menu(page, 'shell:close');
  await selected(page, 'Home');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.locator('main').innerText()).toBe(before);
  // The fake host's window close is a quit request; Close must not reach it.
  expect(await page.evaluate(() => (window as unknown as { __fake: { calls: [string, unknown][] } }).__fake.calls
    .filter(([c]) => c === 'plugin:window|close' || c === 'quit_answer'))).toEqual([]);
});

test('desktop: Close (⌘W) dismisses the sign-in dialog first', async ({ page }) => {
  await desktop(page);
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await menu(page, 'shell:close');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await selected(page, 'Home');
});
