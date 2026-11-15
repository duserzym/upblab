import { expect, test, type Page } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';
import { problems } from './problems';

const FOLDER = '/invented/Qtegra_demo';
const session = { id: 'session-upload', session_key: 'Qtegra_demo', material: 'zircon', started_at: null, acquisition_count: 2 };
type FakeWindow = Window & {
  __fake: { fixtures: Record<string, unknown>; calls: [string, Record<string, unknown>][]; listeners: Map<string, unknown> };
  __emit(event: string, payload: unknown): void;
};
async function home(page: Page) {
  await page.route('**/modules/manifest.json', r => r.fulfill({ json: { modules: [] } }));
  await page.addInitScript(installFakeTauri, {
    store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'home' },
    signedIn: true,
    sessionPaths: [FOLDER],
    fixtures: { '/v1/sessions': [], '/v1/mounts': [], '/v1/sessions/session-upload/reductions': [] },
    scans: { [FOLDER]: { scan: 'scan-upload', roots: [{ name: 'Qtegra_demo', dir: true, path: FOLDER }], entries: [
      { root: 0, rel: 'demo_1.csv', size: 1024 * 1024 }, { root: 0, rel: 'demo_2.csv', size: 1024 * 1024 },
    ], truncated: false, missing: [] } },
  });
  await page.goto('./');
  await page.waitForFunction(() => (window as unknown as FakeWindow).__fake.listeners.has('lab-bridge://files-taken'));
  await expect(page.getByTestId('open-panel')).toBeVisible();
}

for (const [width, height] of [[1440, 900], [1280, 800], [1024, 640]]) {
  test(`Home uploads fit ${width} x ${height} and watch a Qtegra ingest`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await home(page);
    await expect(page.getByRole('button', { name: 'Upload LA-ICP-MS session…', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload image set…', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open folder…', exact: true })).toBeVisible();
    expect(await problems(page, 'Home uploads')).toEqual([]);
    await page.clock.install();
    await page.getByRole('button', { name: 'Upload LA-ICP-MS session…', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Sessions', exact: true })).toHaveAttribute('aria-selected', 'true');
    const offer = await page.evaluate(() => (window as unknown as FakeWindow).__fake.calls.find(([cmd]) => cmd === 'files_offer')?.[1]);
    expect(offer).toMatchObject({ module: 'sessions', kind: 'export', name: 'Qtegra_demo', path: FOLDER });
    await page.getByRole('tab', { name: 'Home', exact: true }).click();
    const card = page.getByTestId('upload-sessions');
    await expect(card).toContainText('Files listed (2 files, 2.00 MB)');
    await expect(card).toContainText('Sent to Sessions');
    await page.evaluate(() => (window as unknown as FakeWindow).__emit('lab-bridge://files-taken', { id: 'o1', source: 'upbdb', files: 2, bytes: 2 * 1024 * 1024 }));
    await expect(card).toContainText('Taken by UPbDB (2 files, 2.00 MB)');
    await page.evaluate(s => { (window as unknown as FakeWindow).__fake.fixtures['/v1/sessions'] = [s]; }, session);
    await page.clock.fastForward(5_000);
    await expect(card).toContainText('Session Qtegra_demo ingested, 2 acquisitions');
    await expect(card.getByRole('button', { name: 'Open in Sessions', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Reduce in UPbRPy Studio', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Review', exact: true })).toBeDisabled();
    await expect(card).toContainText('Review is available once a reduction run is submitted from UPbRPy Studio');
    expect(await problems(page, 'Home upload ingested')).toEqual([]);
    await page.evaluate(() => { (window as unknown as FakeWindow).__fake.fixtures['/v1/sessions/session-upload/reductions'] = [{ id: 'run-upload', status: 'completed' }]; });
    await page.clock.fastForward(5_000);
    await expect(card.getByRole('button', { name: 'Review', exact: true })).toBeEnabled();
    await expect(card).toContainText('Ready to review ✓');
    expect(await problems(page, 'Home upload ready')).toEqual([]);
    await card.getByRole('button', { name: 'Dismiss session upload' }).click();
    await expect(card.getByRole('list')).toHaveCount(0);
  });
}

const SEM = '/invented/sem/Demo_XS_150X';
const handoff = 'Files handed to grainatlas, where they are segmented and published. UPb Lab updates when grainatlas syncs.';

for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test(`desktop "Upload image set" hands the chosen folder to standalone grainatlas at ${width} x ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route('**/modules/manifest.json', r => r.fulfill({ json: { modules: [] } }));
    await page.addInitScript(installFakeTauri, {
      store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'home' },
      signedIn: true,
      folderPaths: [SEM],
      fixtures: { '/v1/sessions': [], '/v1/mounts': [] },
      scans: { [SEM]: { scan: 'scan-sem', roots: [{ name: 'Demo_XS_150X', dir: true, path: SEM }], entries: [
        { root: 0, rel: '001_Demo/001_Demo_0000.jpg', size: 41000 },
        { root: 0, rel: '001_Demo/001_Demo_0000.txt', size: 900 },
        { root: 0, rel: 'Demo_XS_150X.zag', size: 400 },
      ], truncated: false, missing: [] } },
    });
    await page.goto('./');
    await page.waitForFunction(() => (window as unknown as FakeWindow).__fake.listeners.has('lab-bridge://files-taken'));
    await page.getByRole('button', { name: 'Upload image set…', exact: true }).click();
    const card = page.getByTestId('upload-images');
    await expect(card).toContainText(handoff);
    const fake = () => page.evaluate(() => (window as unknown as FakeWindow).__fake.calls);
    expect((await fake()).filter(([cmd]) => cmd === 'grainatlas_open_paths').map(([, args]) => args)).toEqual([{ paths: [SEM] }]);
    // The images never go to a hosted module or another tab.
    expect((await fake()).filter(([cmd]) => cmd === 'files_offer' || cmd === 'module_open')).toEqual([]);
    await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(card.getByRole('link', { name: 'Open grainatlas' })).toHaveCount(0);
    expect(await problems(page, 'Home image hand-off')).toEqual([]);
  });

  test(`web "Upload image set" points to grainatlas in a new tab at ${width} x ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route('http://localhost:8000/**', r => r.fulfill({ json: [] }));
    await page.route('**/modules/manifest.json', r => r.fulfill({ json: { modules: [{ name: 'grainatlas', version: 'demo', source: 'fixture', sha256: 'demo', entry: 'modules/grainatlas/index.html' }] } }));
    await page.addInitScript(() => {
      localStorage.setItem('upbstudio.settings', JSON.stringify({ mode: 'server', lastTab: 'home', theme: 'light', themeChosen: true }));
      sessionStorage.setItem('upbstudio.token:http://localhost:8000', 'invented-token');
    });
    await page.goto('./?server=http://localhost:8000');
    await page.getByRole('button', { name: 'Upload image set…', exact: true }).click();
    const card = page.getByTestId('upload-images');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Open grainatlas in a new browser tab and drop the files there.');
    const link = card.getByRole('link', { name: 'Open grainatlas', exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('href', /.+/);
    await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(await problems(page, 'web image hand-off')).toEqual([]);
  });
}
