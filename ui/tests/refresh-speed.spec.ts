import { test, expect, type Page } from '@playwright/test';
import { calls, openReview } from './review-helpers';
import { session, table } from './fixtures/review';
import { atlasSyncedFixture } from './fixtures/atlas-sync';

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const inventoryReads = async (page: Page) => (await calls(page)).filter(([name, args]) =>
  name === 'api_get' && ['/v1/sessions', '/v1/mounts'].includes(String(args?.path)));
const overlays = async (page: Page) => (await calls(page)).filter(([name, args]) =>
  name === 'module_command' && (args?.command as { type?: string })?.type === 'review-spots');

test('atlas sync keeps the Review tree visible while replacing results without reopening Images', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReview(page, { store: { reviewSplit: true } });
  const tree = page.getByRole('tree', { name: 'Result spots' });
  await expect(tree).toBeVisible();
  await page.locator('[data-spot-key="acq-2"]').click();
  await expect.poll(() => overlays(page)).not.toHaveLength(0);
  const beforeLists = (await inventoryReads(page)).length;
  const beforeOverlays = (await overlays(page)).length;
  const path = `/v1/sessions/${session.id}/results?run=preferred`;
  // Hold the results response across browser frames so even a transient blank is observed.
  await page.evaluate(({ path, updated }) => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (name: string, args?: Record<string, unknown>) => Promise<unknown> };
      __releaseResults?: () => void;
      __refreshObservation?: { blank: boolean; loading: boolean; requested: boolean };
    };
    const observation: { blank: boolean; loading: boolean; requested: boolean } = w.__refreshObservation = { blank: false, loading: false, requested: false };
    const view = document.querySelector('[data-testid="review-view"]')!;
    new MutationObserver(() => {
      observation.blank ||= !view.querySelector('[role="tree"]');
      observation.loading ||= view.textContent?.includes('Loading results from laicpmsdb') ?? false;
    }).observe(view, { subtree: true, childList: true, characterData: true });
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (name, args) => {
      if (name === 'api_get' && args?.path === path) {
        observation.requested = true;
        await new Promise<void>(resolve => { w.__releaseResults = resolve; });
        await invoke(name, args); // Keep the existing call recorder.
        return { status: 200, body: updated };
      }
      return invoke(name, args);
    };
  }, { path, updated: { ...table, rows: [...table.rows].reverse().map(row => ({ ...row, label: `${row.label} synced` })) } });
  await page.evaluate(event => (window as unknown as { __emit: (name: string, payload: unknown) => void })
    .__emit('lab-bridge://notify', { source: 'grainatlas', event }), atlasSyncedFixture);
  await page.waitForFunction(() => (window as unknown as { __refreshObservation: { requested: boolean } }).__refreshObservation.requested);
  await expect(tree).toBeVisible();
  await expect(page.getByText('Loading results from laicpmsdb…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('treeitem', { name: 'Zircon_2', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => (window as unknown as { __releaseResults: () => void }).__releaseResults());
  await expect(page.getByRole('treeitem', { name: 'Zircon_2 synced', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => (window as unknown as { __refreshObservation: unknown }).__refreshObservation))
    .toEqual({ blank: false, loading: false, requested: true });
  expect(await inventoryReads(page)).toHaveLength(beforeLists);
  expect(await overlays(page)).toHaveLength(beforeOverlays);
});

test('Home to Review to Home within 60 seconds makes no additional v1 requests', async ({ page }) => {
  await openReview(page);
  await tab(page, 'Home').click();
  await expect(page.getByTestId('session-card')).toHaveCount(1);
  await expect(page.getByTestId('mount-card')).toHaveCount(1);
  for (const section of ['Sessions', 'Mounts'])
    await expect(page.getByRole('region', { name: section, exact: true }).getByRole('status')).toHaveCount(0);
  const reads = async () => (await calls(page)).filter(([name, args]) => name === 'api_get' && String(args?.path).startsWith('/v1/'));
  const before = (await reads()).length;
  await tab(page, 'Review').click();
  await expect(page.getByRole('tree', { name: 'Result spots' })).toBeVisible();
  await tab(page, 'Home').click();
  await expect(page.getByTestId('session-card')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Sessions', exact: true }).getByRole('status')).toHaveCount(0);
  expect(await reads()).toHaveLength(before);
});
