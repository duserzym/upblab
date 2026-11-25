import { expect, test, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';

// Uses the shared Playwright baseURL, including UPBLAB_E2E_PORT.
const server = 'http://localhost:8000';
const rows = [
  { id: 'laser-session', session_key: 'Synthetic tied session', material: 'zircon', acquisition_count: 2, started_at: null, run_count: 0, spot_kinds: { sample: 2 }, laser_log_count: 1, laser_has_times: true },
  { id: 'placed-session', session_key: 'Synthetic placed-only session', material: 'zircon', acquisition_count: 1, started_at: null, run_count: 0, spot_kinds: { sample: 1 }, laser_log_count: 2, laser_has_times: false },
  { id: 'old-session', session_key: 'Synthetic older session', material: 'apatite', acquisition_count: 1, started_at: null, run_count: 0, spot_kinds: { sample: 1 } },
];
const fixtures = { '/v1/sessions': rows, '/v1/mounts': [], '/v1/accounts': [], '/v1/groups': [], '/v1/labs': [], '/v1/projects': [], '/v1/samples': [], '/v1/laser-logs?limit=1': [] };
// A tiny Sessions module: requests the same bridge transfer as UPbDB and
// displays what actually arrived, including the cloned File bytes.
const moduleHtml = `<!doctype html><meta charset="utf-8"><p data-testid="delivered"></p><script>
let seq = 0;
function take() { parent.postMessage({ tag: 'lab-bridge', v: 2, op: 'open-files', id: 'laser-' + ++seq }, '*'); }
addEventListener('message', async e => {
  const d = e.data;
  if (d?.tag !== 'lab-bridge') return;
  if (d.push === 'open-files') { take(); return; }
  if (!d.ok || !d.result?.files) return;
  const t = d.result;
  document.querySelector('p').textContent = JSON.stringify({ kind: t.kind, name: t.files[0].file.name, bytes: await t.files[0].file.text(), count: t.files.length });
});
addEventListener('hashchange', take); setTimeout(take, 0);
</script>`;
async function home(page: Page, desktop: boolean, theme: 'light' | 'dark', support = 200) {
  await page.route('**/modules/manifest.json', r => r.fulfill({ json: { modules: [] } }));
  await page.route('**/app/**', r => r.fulfill({ contentType: 'text/html', body: moduleHtml }));
  await page.route('**/v1/**', r => {
    const url = new URL(r.request().url());
    const key = url.pathname + (url.pathname === '/v1/laser-logs' ? url.search : '');
    const body = key === '/v1/accounts/me' ? { username: 'demo', display_name: 'Demo analyst' } : fixtures[key as keyof typeof fixtures] ?? [];
    return r.fulfill({ status: key.startsWith('/v1/laser-logs') ? support : 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Accept, If-None-Match' }, json: body });
  });
  if (desktop) await page.addInitScript(installFakeTauri, {
    store: { mode: 'server', serverUrl: server, lastTab: 'home', theme, themeChosen: true }, signedIn: true, fixtures,
    folderPaths: ['/invented/day.lase'],
    apiReplies: { '/v1/laser-logs?limit=1': { status: support, body: [] } },
    scans: { '/invented/day.lase': { scan: 'laser-scan', roots: [{ name: 'day.lase', dir: false, path: '/invented/day.lase' }], entries: [{ root: 0, rel: 'day.lase', size: 8 }], missing: [], truncated: false } },
  });
  else await page.addInitScript(({ server, theme }) => {
    localStorage.setItem('upbstudio.settings', JSON.stringify({ mode: 'server', lastTab: 'home', theme, themeChosen: true }));
    sessionStorage.setItem(`upbstudio.token:${server}`, 'invented-token');
  }, { server, theme });
  await page.goto(desktop ? './' : `./?server=${encodeURIComponent(server)}`);
  await expect(page.getByTestId('session-card')).toHaveCount(3);
}
for (const desktop of [true, false]) for (const [width, height] of [[1440, 900], [1280, 800]]) for (const theme of ['light', 'dark'] as const) {
  test(`${desktop ? 'desktop' : 'web'} laser tile and session chips fit ${width} x ${height} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await home(page, desktop, theme);
    const tile = page.getByRole('button', { name: 'Laser log', exact: true });
    await expect(tile).toBeVisible(); await expect(tile).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const tied = page.getByTestId('session-card').filter({ hasText: 'Synthetic tied session' });
    const chip = tied.getByRole('button', { name: '1 laser log tied, with laser times', exact: true });
    await expect(page.getByRole('button', { name: '2 laser logs tied, no laser times', exact: true })).toHaveText('Laser log');
    await expect(chip).toHaveText('Laser log'); await expect(chip).toHaveAttribute('title', '1 laser log tied, with laser times');
    await expect(page.getByTestId('session-card').filter({ hasText: 'Synthetic older session' }).getByText('Laser log', { exact: true })).toHaveCount(0);
    await chip.focus(); await expect(chip).toBeFocused(); await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: 'Sessions', exact: true })).toHaveAttribute('aria-selected', 'true');
  });
}
test('web input delivers one .lase and its bytes through open-files on the laser route', async ({ page }) => {
  await home(page, false, 'light');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Laser log', exact: true }).click();
  await (await chooser).setFiles({ name: 'day.lase', mimeType: 'application/octet-stream', buffer: Buffer.from('[Scans]\r\n') });
  const frame = page.frameLocator('iframe[name="lab-shell:sessions"]');
  await expect(frame.getByTestId('delivered')).toHaveText(JSON.stringify({ kind: 'lase', name: 'day.lase', bytes: '[Scans]\r\n', count: 1 }));
  await expect(page.locator('iframe[name="lab-shell:sessions"]')).toHaveAttribute('src', /#\/laser-logs$/);
});
test('desktop picker uses the lase filter and offers the file to Sessions', async ({ page }) => {
  await home(page, true, 'dark'); await page.getByRole('button', { name: 'Laser log', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fake: { calls: [string, Record<string, unknown>][] } }).__fake.calls.find(([c]) => c === 'files_offer')?.[1])).toMatchObject({ kind: 'lase', module: 'sessions', path: '/invented/day.lase' });
  const options = await page.evaluate(() => (window as unknown as { __fake: { calls: [string, Record<string, unknown>][] } }).__fake.calls.find(([c]) => c === 'plugin:dialog|open')?.[1]);
  expect(options).toMatchObject({ options: { multiple: false, filters: [{ name: 'Laser log', extensions: ['lase'] }] } });
});
test('older web server refuses the laser file with no module delivery', async ({ page }) => {
  await home(page, false, 'light', 404);
  await page.getByLabel('Laser log file', { exact: true }).setInputFiles({ name: 'day.lase', mimeType: 'application/octet-stream', buffer: Buffer.from('[Scans]') });
  await expect(page.getByRole('status').filter({ hasText: 'This UPbDB server does not take laser logs yet.' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute('aria-selected', 'true');
});
