import { expect, type Locator, type Page } from '@playwright/test';
import { installFakeTauri, type FakeOptions } from './fake-tauri';
import { reviewFixtures, session } from './fixtures/review';

export type Call = [string, Record<string, unknown> | undefined];
export const calls = (page: Page) => page.evaluate(() => (window as unknown as {
  __fake: { calls: Call[] };
}).__fake.calls);

export async function openReview(page: Page, options: { signedIn?: boolean; store?: Record<string, unknown>; fixtures?: Record<string, unknown>; grainatlasLaunchErrors?: string[]; studioFound?: boolean; studioVersion?: string; studioLaunchErrors?: FakeOptions['studioLaunchErrors']; waitForSpots?: boolean; apiReplies?: FakeOptions['apiReplies']; renderModules?: boolean } = {}) {
  await page.route('**/modules/manifest.json', r => r.fulfill({ json: { modules: [{ name: 'grainatlas', version: 'demo', source: 'fixture', sha256: 'demo', entry: 'modules/grainatlas/index.html' }] } }));
  await page.addInitScript(installFakeTauri, { store: { mode: 'server', serverUrl: 'http://localhost:8000', lastTab: 'review', reviewScope: JSON.stringify({ kind: 'session', id: session.id, run: 'preferred' }), ...options.store }, fixtures: { ...reviewFixtures, ...options.fixtures }, signedIn: options.signedIn ?? true, apiReplies: options.apiReplies, grainatlasLaunchErrors: options.grainatlasLaunchErrors, studioFound: options.studioFound, studioVersion: options.studioVersion, studioLaunchErrors: options.studioLaunchErrors, renderModules: options.renderModules });
  await page.goto('./');
  await page.waitForFunction(() => (window as unknown as {
    __fake: { listeners: Map<string, unknown> };
  }).__fake.listeners.has('lab-bridge://notify'));
  if (options.signedIn !== false && options.waitForSpots !== false) await expect(page.locator('[data-spot-key]').first()).toBeAttached();
}

export async function inside(element: Locator, owner: Locator) {
  const box = (await element.boundingBox())!, tile = (await owner.boundingBox())!;
  expect(box).toBeTruthy();
  expect(box.x).toBeGreaterThanOrEqual(tile.x - 1);
  expect(box.y).toBeGreaterThanOrEqual(tile.y - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(tile.x + tile.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(tile.y + tile.height + 1);
}

export async function intersection(element: Locator, owner: Locator) {
  const a = (await element.boundingBox())!, b = (await owner.boundingBox())!;
  expect(a).toBeTruthy(); expect(b).toBeTruthy();
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}
