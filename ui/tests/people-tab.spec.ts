import { expect, test, type Page } from '@playwright/test';
import { MESSAGE_TAG, PROTOCOL_VERSION, SHELL_EVENTS } from '@lab/bridge';
import { problems } from './problems';

async function people(page: Page, canManage: boolean, displayName = 'Demo staff') {
  await page.route('http://localhost:8000/**', r => r.fulfill({ json: {} }));
  await page.route('**/modules/manifest.json', r => r.fulfill({ json: { modules: [] } }));
  await page.route('**/v1/**', r => {
    const path = new URL(r.request().url()).pathname;
    const body = path === '/v1/accounts/me'
      ? { username: 'demo', display_name: displayName, can_manage_people: canManage, is_lab_staff: true }
      : path === '/v1/auth/logout' ? {} : [];
    return r.fulfill({ headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Accept' }, json: body });
  });
  await page.route('**/app/**', r => r.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>People fixture</title><h1>People fixture</h1>',
  }));
  await page.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem('upbstudio.settings', JSON.stringify({
      mode: 'server', lastTab: 'home', theme: 'light', themeChosen: true,
    }));
    sessionStorage.setItem('upbstudio.token:http://localhost:8000', 'invented-token');
  });
  await page.goto('./?server=http://localhost:8000');
  await expect(page.getByRole('button', { name: displayName, exact: true })).toBeVisible();
}

test('an explicit denial hides People even for a lab staff account', async ({ page }) => {
  await people(page, false);
  await expect(page.getByRole('tab', { name: 'People & access', exact: true })).toHaveCount(0);
  await expect(page.locator('iframe[title="People & access"]')).toHaveCount(0);
});

test('People hosts the management page and has no number shortcut', async ({ page }) => {
  await people(page, true);
  const tab = page.getByRole('tab', { name: 'People & access', exact: true });
  await expect(tab).toHaveAttribute('title', 'Accounts, groups and access (lab staff)');
  await tab.click();
  const frame = page.locator('iframe[title="People & access"]');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('src', /\/app\/(?:\?theme=(?:light|dark))?#\/people$/);
  await expect(frame).toHaveAttribute('name', 'lab-shell:upbdb');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('upbstudio.settings')!).lastTab)).toBe('home');
  // People has no number shortcut; its title shows none.
  await expect(tab).not.toHaveAttribute('title', /Ctrl/);
});

test('signing out from the hosted page removes People and returns Home', async ({ page }) => {
  await people(page, true);
  await page.getByRole('tab', { name: 'People & access', exact: true }).click();
  const frame = page.frameLocator('iframe[title="People & access"]');
  await expect(frame.getByRole('heading', { name: 'People fixture' })).toBeVisible();
  // The hosted module signs the shell out through the normal bridge notification.
  await frame.locator('body').evaluate((_, { message, origin }) => parent.postMessage(message, origin), {
    origin: new URL(page.url()).origin,
    message: {
      tag: MESSAGE_TAG, v: PROTOCOL_VERSION, id: 'people-sign-out', op: 'notify',
      event: { type: SHELL_EVENTS.signedOut },
    },
  });
  await expect(page.getByRole('tab', { name: 'People & access', exact: true })).toHaveCount(0);
  await expect(page.locator('iframe[title="People & access"]')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true }).first()).toBeVisible();
});

for (const [width, height] of [[1440, 900], [1280, 800], [1024, 640]]) {
  test(`People and the six-tab header fit ${width} x ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await people(page, true, 'Demo staff with a deliberately long display name');
    await page.getByRole('tab', { name: 'People & access', exact: true }).click();
    await expect(page.locator('iframe[title="People & access"]')).toBeVisible();
    expect(await problems(page, 'People & access')).toEqual([]);
    const tabs = await page.getByRole('tab').allTextContents();
    expect(tabs).toEqual(['Home', 'Sessions', 'Review', 'Reduce', 'TIMS', 'People & access']);
  });
}
