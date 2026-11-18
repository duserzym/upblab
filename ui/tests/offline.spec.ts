import { expect, test } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';
import { problems } from './problems';
import { reviewFixtures, session } from './fixtures/review';

const asOf = '2026-11-17T21:49:00Z';
const local = { path: '/Users/lab/UPbRPy/sessions/invented-local', key: 'Invented local zircon', id: session.id,
  format: 'upbdb-session-bundle', openable: true,
  material: 'zircon', kind: 'sample', started_at: asOf, acquisitions: 12, has_project: true, modified: asOf };
const oldLocal = { ...local, path: '/Users/lab/UPbRPy/sessions/invented-old', key: 'Invented pre-rename zircon',
  id: 'invented-old-session', format: 'laicpmsdb-session-bundle', openable: false };
for (const [width, height] of [[1440,900], [1280,800]]) {
  test(`saved data and local sessions fit ${width} x ${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(installFakeTauri, {
      store: { mode: 'server', serverUrl: 'https://invented.invalid', lastTab: 'home', theme: 'light', themeChosen: true },
      signedIn: true, offline: true, peopleAllowed: true, cached: { asOf, reason: 'unreachable' as const, detail: 'server unreachable: connection failed' },
      fixtures: reviewFixtures, localSessions: width === 1440 ? [local, oldLocal] : [local], cacheStatus: { entries: 10, bytes: 12345, newest: asOf, oldest: asOf },
    });
    await page.goto('./');
    const banner = page.getByTestId('offline-banner');
    await expect(banner).toContainText('Offline: showing data saved on this computer');
    await expect(page.getByTestId('session-card')).toHaveCount(1);
    await expect(page.getByTestId('session-card')).toContainText('Local copy');
    const localCard = page.getByTestId('local-session-card').filter({ hasText: local.key });
    await expect(localCard).toContainText('Invented local zircon');
    if (width === 1440) {
      const oldCard = page.getByTestId('local-session-card').filter({ hasText: oldLocal.key });
      const note = oldCard.getByText('Downloaded before the UPbDB rename. This Studio cannot open it yet.', { exact: true });
      await expect(note).toBeVisible();
      await expect(note).toHaveAttribute('title', oldLocal.path);
      await expect(oldCard.getByRole('button', { name: 'Open in UPbRPy Studio' })).toHaveCount(0);
      const localSection = page.getByRole('region', { name: 'On this computer', exact: true });
      await expect(localSection.locator('.count')).toHaveText('2');
    }
    await expect(page.getByTestId('status-pills')).toContainText('Offline · saved data');
    await expect(page.getByRole('button', { name: 'Demo analyst', exact: true })).toBeVisible();
    await banner.getByRole('button', { name: 'Retry now' }).click();
    await expect(banner).toContainText('Retrying in 30 s');
    expect(await problems(page, 'Offline Home')).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`offline-home-${width}x${height}.png`) });
    await localCard.getByRole('button', { name: 'Open in UPbRPy Studio' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __fake: { calls: [string, unknown][] } }).__fake.calls.some(([cmd]) => cmd === 'studio_open_local'))).toBe(true);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const saved = page.getByTestId('saved-data-settings');
    await expect(saved).toContainText('10 entries');
    await saved.getByRole('button', { name: 'Save recent data now' }).click();
    await expect(saved).toContainText('1 unavailable');
    await saved.getByRole('button', { name: 'Forget saved data', exact: true }).click();
    await expect(saved.getByText("Remove this account's saved data from this computer?")).toBeVisible();
    await saved.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await problems(page, 'Offline Settings')).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`offline-settings-${width}x${height}.png`) });
    await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
    await expect(page.locator('.view:not(.hidden)').getByText("This tab is UPbDB's own page and needs the server.", { exact: false })).toBeVisible();
    expect(await problems(page, 'Offline Sessions')).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`offline-sessions-${width}x${height}.png`) });
    await page.getByRole('tab', { name: 'People & access', exact: true }).click();
    await expect(page.locator('.view:not(.hidden)').getByText("This tab is UPbDB's own page and needs the server.", { exact: false })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`offline-people-${width}x${height}.png`) });
  });
}
test('live retry removes the banner and refreshes Home quietly', async ({ page }) => {
  await page.addInitScript(installFakeTauri, {
    store: { mode: 'server', serverUrl: 'https://invented.invalid', lastTab: 'home' }, signedIn: true, offline: true,
    cached: { asOf, reason: 'unreachable' as const }, fixtures: { ...reviewFixtures, '/v1/accounts/me': { username: 'demo', display_name: 'Demo analyst' } },
    apiReplies: { '/v1/accounts/me': { status: 200, body: { username: 'demo', display_name: 'Demo analyst' } } },
  });
  await page.goto('./');
  const banner = page.getByTestId('offline-banner'); await expect(banner).toBeVisible();
  await page.evaluate(() => (window as unknown as { __fake: { goOnline: () => void } }).__fake.goOnline());
  await banner.getByRole('button', { name: 'Retry now' }).click();
  await expect(banner).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fake: { calls: [string, { path?: string }][] } }).__fake.calls.filter(([cmd,args]) => cmd === 'api_get' && args.path === '/v1/sessions?limit=500').length)).toBeGreaterThan(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('no saved server data leaves local sessions available', async ({ page }) => {
  await page.addInitScript(installFakeTauri, {
    store: { mode: 'server', serverUrl: 'https://invented.invalid', lastTab: 'home' },
    signedIn: true, offline: true, localSessions: [local], cacheStatus: { entries: 0, bytes: 0, newest: null, oldest: null },
  });
  await page.goto('./');
  await expect(page.getByText('Nothing is saved on this computer from this server yet. Local sessions are listed below.')).toBeVisible();
  await expect(page.getByTestId('local-session-card')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('saved proxy error names the status without a modal', async ({ page }) => {
  await page.addInitScript(installFakeTauri, {
    store: { mode: 'server', serverUrl: 'https://invented.invalid', lastTab: 'home' }, signedIn: true, offline: true,
    cached: { asOf, reason: 'server_error' as const, detail: 'Server returned 503: temporarily unavailable' }, fixtures: reviewFixtures,
  });
  await page.goto('./');
  await expect(page.getByTestId('offline-banner')).toContainText('The server answered with an error (503).');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

const offlineCopy = 'offline copy as of 2026-11-17 21:49 UTC, read-only';
test('read-only copy banner and pill fit 1440 x 900', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(installFakeTauri, {
    store: { mode: 'server', serverUrl: 'http://127.0.0.1:8765', lastTab: 'home', theme: 'light', themeChosen: true },
    signedIn: true, offlineCopy, fixtures: reviewFixtures,
  });
  await page.goto('./');
  await expect(page.getByTestId('offline-banner')).toHaveText('Read-only copy of UPbDB on this computer (offline copy as of 2026-11-17 21:49 UTC). Changes are not accepted here; make them when the lab server is back.');
  await expect(page.getByTestId('status-pills')).toContainText('Read-only copy');
  await expect(page.locator('.board-section')).toHaveCount(2);
  expect(await problems(page, 'Read-only copy Home')).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('read-only-copy-home-1440x900.png') });
});
test('cached read-only copy uses normal offline wording and names the source', async ({ page }) => {
  await page.addInitScript(installFakeTauri, {
    store: { mode: 'server', serverUrl: 'http://127.0.0.1:8765', lastTab: 'home' },
    signedIn: true, offline: true, offlineCopy, cached: { asOf, reason: 'unreachable' as const }, fixtures: reviewFixtures,
  });
  await page.goto('./');
  await expect(page.getByTestId('offline-banner')).toContainText('Offline: showing data saved on this computer');
  await expect(page.getByTestId('offline-banner')).toContainText('(saved from the read-only copy)');
  await expect(page.getByTestId('status-pills')).toContainText('Offline · saved data');
});

test('read-only copy opens GrainAtlas locally once and still hands off to Studio', async ({ page }) => {
  await page.addInitScript(installFakeTauri, {
    store: { mode: 'server', serverUrl: 'http://127.0.0.1:8765', lastTab: 'home' },
    signedIn: true, offlineCopy, fixtures: reviewFixtures, studioFound: true,
  });
  await page.goto('./');
  await expect(page.getByTestId('offline-banner')).toContainText('Read-only copy of UPbDB');
  const input = page.getByRole('textbox', { name: 'Open a link', exact: true });
  const open = page.getByRole('button', { name: 'Open', exact: true });
  for (let count = 1; count <= 2; count++) {
    await input.fill('grainatlas://project/project-demo'); await open.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __fake: { calls: [string, unknown][] } }).__fake.calls.filter(([cmd]) => cmd === 'grainatlas_launch').length)).toBe(count);
    await expect(page.getByTestId('grainatlas-local-notice')).toHaveCount(1);
  }
  const atlas = await page.evaluate(() => (window as unknown as { __fake: { calls: [string, Record<string, unknown>][] } }).__fake.calls.filter(([cmd]) => cmd === 'grainatlas_launch').map(([, args]) => args));
  expect(atlas).toHaveLength(2);
  for (const args of atlas) { expect(args).not.toHaveProperty('server'); expect(args).not.toHaveProperty('code'); }
  expect(await page.evaluate(() => (window as unknown as { __fake: { calls: [string, unknown][] } }).__fake.calls.some(([cmd]) => cmd === 'auth_handoff'))).toBe(false);
  await input.fill(`upbr://session/${session.id}`); await open.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fake: { calls: [string, unknown][] } }).__fake.calls.some(([cmd]) => cmd === 'auth_handoff'))).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fake: { calls: [string, unknown][] } }).__fake.calls.some(([cmd]) => cmd === 'studio_launch'))).toBe(true);
});
