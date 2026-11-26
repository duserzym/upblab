import { expect, test, type Locator, type Page } from '@playwright/test';
import { layoutFixtures, layoutHome, storedLayout } from './fixtures/home-layout';
import { homeAtlasMounts, homeMounts, homeSessions } from './fixtures/home';
import { problems } from './problems';

async function inside(page: Page, locator: Locator) {
  const box = (await locator.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(48);
  // Two pixels of slack: scrollIntoView lands on whole pixels while layout heights are fractional.
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 2);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 2);
}
async function fixedHome(page: Page) {
  const sizes = await page.getByTestId('home-scroll').evaluate(el => ({ h: el.clientHeight, sh: el.scrollHeight, w: el.clientWidth, sw: el.scrollWidth }));
  expect(sizes.sh).toBeLessThanOrEqual(sizes.h + 1);
  expect(sizes.sw).toBeLessThanOrEqual(sizes.w + 1);
  expect(await problems(page, 'Compact Home')).toEqual([]);
}
async function innerScroll(locator: Locator, overflowing = true) {
  const result = await locator.evaluate(el => {
    const style = getComputedStyle(el);
    el.scrollTop = 100;
    return { overflow: style.overflowY, top: el.scrollTop, height: el.clientHeight, content: el.scrollHeight };
  });
  expect(result.overflow).toBe('auto');
  expect(result.height).toBeGreaterThan(0);
  if (overflowing) {
    expect(result.content).toBeGreaterThan(result.height);
    expect(result.top).toBeGreaterThan(0);
  }
}

for (const desktop of [true, false]) for (const theme of ['light', 'dark']) {
  for (const [width, height] of [[1512, 982], [1440, 900], [1280, 800]]) {
    test(`${desktop ? 'desktop' : 'web'} pinned Home fits ${width} x ${height}, ${theme}`, async ({ page }) => {
      test.slow(); // A dozen layout audits; about 8 s alone, longer when the full suite shares the CPU.
      await page.setViewportSize({ width, height });
      await layoutHome(page, desktop, { theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await fixedHome(page);
      expect(await page.getByTestId('home-columns').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3);
      await expect(page.getByRole('button', { name: 'Refresh sessions and mounts', exact: true })).toHaveCount(1);
      for (const name of ['Sessions', 'Mounts']) {
        const column = page.getByRole('region', { name, exact: true });
        await expect(column.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(0);
        const rows = await column.locator('.toolbar-controls').evaluate(el => new Set([...el.querySelectorAll('input, select, button')].map(control => { const box = control.getBoundingClientRect(); return Math.round(box.y + box.height / 2); })).size);
        expect(rows).toBeLessThanOrEqual(width === 1512 ? 1 : 2);
      }
      const actions = (await page.getByTestId('open-panel').boundingBox())!;
      const views = (await page.getByRole('navigation', { name: 'Home view' }).boundingBox())!;
      expect(views.y).toBeLessThan(actions.y + actions.height);
      expect(views.y + views.height).toBeGreaterThan(actions.y);
      for (const locator of [page.getByRole('heading', { name: 'UPb Lab', exact: true }),
        page.getByRole('region', { name: 'Narrow data by person, team and project' }), page.getByTestId('open-panel'), page.getByTestId('home-summary'),
        ...['Sessions', 'Mounts', 'On this computer', 'Links'].map(name => page.getByRole('heading', { name, exact: true }))]) await inside(page, locator);
      for (const id of ['session-grid', 'mount-grid', 'local-session-grid', 'links-scroll']) {
        await innerScroll(page.getByTestId(id), id === 'session-grid' || id === 'mount-grid' || (desktop && id === 'local-session-grid'));
      }
      // Filling Links does not change the fixed frame; its table scrolls internally too.
      for (let i = 0; i < 10; i++) {
        await page.getByLabel('Open a link', { exact: true }).fill(`invalid://invented-${i}`);
        await page.getByRole('region', { name: 'Links', exact: true }).getByRole('button', { name: 'Open', exact: true }).click();
      }
      await innerScroll(page.getByTestId('links-scroll'));
      await fixedHome(page);
      await page.getByRole('radio', { name: 'Records · Samples and Projects', exact: true }).click();
      await expect(page.getByTestId('home-columns')).toBeHidden();
      for (const name of ['Samples', 'Projects']) await inside(page, page.getByRole('region', { name, exact: true }));
      await innerScroll(page.getByTestId('samples-list'));
      await innerScroll(page.getByTestId('projects-list'));
      await fixedHome(page);
      await page.getByRole('radio', { name: 'Overview', exact: true }).click();
      for (const name of ['Upload LA-ICP-MS session…', 'Upload image set…']) {
        // Web session upload opens a file chooser; the mounted input remains usable.
        if (!desktop && name.includes('LA-ICP-MS')) {
          const chooser = page.waitForEvent('filechooser');
          await page.getByRole('button', { name, exact: true }).click();
          await chooser;
        } else await page.getByRole('button', { name, exact: true }).click();
        const which = name.includes('LA-ICP-MS') ? 'sessions' : 'images';
        await expect(page.getByTestId(`upload-panel-${which}`)).toBeVisible();
        await fixedHome(page);
        for (const name of ['Sessions', 'Mounts', 'On this computer', 'Links']) await inside(page, page.getByRole('heading', { name, exact: true }));
        await inside(page, page.getByTestId('home-columns'));
        await page.getByRole('button', { name: which === 'sessions' ? 'Close session upload panel' : 'Close image set upload panel' }).click();
      }
      await fixedHome(page);
    });
  }
}

for (const desktop of [true, false]) {
  test(`${desktop ? 'desktop' : 'web'} pins, filters and Records survive reload, and reset keeps pins`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await layoutHome(page, desktop, { homeSections: { sessions: { height: 4000, collapsed: true }, mounts: { height: 4000, collapsed: true } } });
    await expect(page.getByRole('separator', { name: /^Resize (Sessions|Mounts)/ })).toHaveCount(0);
    const session = page.getByTestId('session-card').first(), mount = page.getByTestId('mount-card').first();
    await session.getByRole('button', { name: 'Pin Board session 0', exact: true }).click();
    await expect(session.getByRole('button', { name: 'Unpin Board session 0', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await mount.getByRole('button', { name: /^Pin / }).click();
    const strip = page.getByTestId('home-pins');
    await expect(strip.getByTestId('pinned-item')).toHaveCount(2);
    await expect(strip).toContainText('Board session 0');
    await expect(strip).toContainText('Zircon_mount_1');
    await page.getByRole('button', { name: 'Show not reduced →', exact: true }).click();
    await expect(page.getByTestId('session-card')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Not reduced', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Not reduced', exact: true }).click();
    await expect(page.getByTestId('session-card')).toHaveCount(homeSessions.length);
    await page.getByRole('button', { name: 'Show without atlas →', exact: true }).click();
    await expect(page.getByTestId('mount-card')).toHaveCount(homeMounts.length - homeAtlasMounts.length);
    await page.getByRole('radio', { name: 'Records · Samples and Projects', exact: true }).click();
    await expect.poll(async () => (await storedLayout(page, desktop)).homeSections).toMatchObject({ view: 'records', mounts: { atlasFilter: 'without' } });
    await expect.poll(async () => Object.values((await storedLayout(page, desktop)).homePins as Record<string, unknown[]>)[0]?.length).toBe(2);
    await page.reload();
    await expect(strip.getByTestId('pinned-item')).toHaveCount(2);
    await expect(page.getByTestId('home-records')).toBeVisible();
    await expect(page.getByTestId('home-columns')).toBeHidden();
    await fixedHome(page);
    await strip.getByRole('button', { name: 'Unpin Board session 0', exact: true }).click();
    await expect(strip.getByTestId('pinned-item')).toHaveCount(1);
    await page.getByRole('button', { name: 'Reset Home layout', exact: true }).click();
    await expect(page.getByTestId('home-columns')).toBeVisible();
    await expect(page.getByTestId('mount-card')).toHaveCount(homeMounts.length);
    await expect(strip.getByTestId('pinned-item')).toHaveCount(1);
    await expect(page.getByTestId('mount-card').first().getByRole('button', { name: /^Unpin / })).toHaveAttribute('aria-pressed', 'true');
    await fixedHome(page);
  });

  test(`${desktop ? 'desktop' : 'web'} unloaded pins keep labels and overflow collapses without fetching`, async ({ page }) => {
    const pins = Array.from({ length: 50 }, (_, i) => ({ kind: i % 2 ? 'mount' : 'session', id: `unloaded-${i}`, label: `Unloaded ${i}`, pinned_at: '2026-11-18T10:00:00Z' }));
    const reads: string[] = [];
    await page.setViewportSize({ width: 1440, height: 900 });
    page.on('request', request => { if (request.url().includes('/v1/')) reads.push(request.url()); });
    await layoutHome(page, desktop, { homePins: { 'http://localhost:8000|demo': pins } });
    const strip = page.getByTestId('home-pins');
    await expect(strip).toContainText('Unloaded 0');
    await expect(strip).toContainText('not loaded');
    const chips = strip.getByTestId('pinned-item');
    const overflow = strip.getByRole('button', { name: /^\+\d+$/ });
    await expect.poll(() => chips.count()).toBeGreaterThanOrEqual(3);
    await expect(overflow).toBeVisible();
    const visible = await chips.count();
    expect(visible + Number((await overflow.innerText()).slice(1))).toBe(50);
    const bounds = await strip.getByRole('group', { name: 'Pinned items' }).evaluate(el => {
      const strip = el.getBoundingClientRect();
      return { left: strip.left, right: strip.right, top: strip.top, bottom: strip.bottom,
        chips: [...el.querySelectorAll('[data-testid="pinned-item"]')].map(chip => {
          const box = chip.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        }) };
    });
    for (const chip of bounds.chips) {
      expect(chip.left).toBeGreaterThanOrEqual(bounds.left - 1);
      expect(chip.right).toBeLessThanOrEqual(bounds.right + 1);
      expect(chip.top).toBeGreaterThanOrEqual(bounds.top - 1);
      expect(chip.bottom).toBeLessThanOrEqual(bounds.bottom + 1);
      expect(chip.top).toBeCloseTo(bounds.chips[0].top, 1);
    }
    const before = reads.length;
    const height = (await strip.boundingBox())!.height;
    await overflow.click();
    await expect(strip.getByTestId('pinned-item')).toHaveCount(50);
    expect((await strip.boundingBox())!.height).toBe(height);
    await innerScroll(strip.getByRole('group', { name: 'Pinned items' }));
    await fixedHome(page);
    await strip.getByRole('button', { name: 'Show fewer', exact: true }).click();
    await expect(chips).toHaveCount(visible);
    await strip.getByRole('button', { name: 'Unpin Unloaded 0', exact: true }).click();
    expect(reads.length).toBe(before);
    expect(reads.some(url => url.includes('unloaded-'))).toBe(false);
  });

  test(`${desktop ? 'desktop' : 'web'} three short pins fit without overflow at 1440 x 900`, async ({ page }) => {
    const pins = Array.from({ length: 3 }, (_, i) => ({ kind: 'session', id: `unloaded-${i}`, label: `Pin ${i + 1}`, pinned_at: '2026-11-18T10:00:00Z' }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await layoutHome(page, desktop, { homePins: { 'http://localhost:8000|demo': pins } });
    const strip = page.getByTestId('home-pins');
    await expect(strip.getByTestId('pinned-item')).toHaveCount(3);
    await expect(strip.getByRole('button', { name: /^\+\d+$/ })).toHaveCount(0);
    await fixedHome(page);
  });

  for (const [width, height] of [[1024, 640], [1280, 720]]) {
    test(`${desktop ? 'desktop' : 'web'} Home scrolls vertically with usable columns at ${width} x ${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await layoutHome(page, desktop);
      const home = page.getByTestId('home-scroll');
      const size = await home.evaluate(el => ({ h: el.clientHeight, sh: el.scrollHeight, w: el.clientWidth, sw: el.scrollWidth }));
      expect(size.sh).toBeGreaterThan(size.h);
      expect(size.sw).toBeLessThanOrEqual(size.w + 1);
      for (const name of ['Sessions', 'Mounts', 'On this computer', 'Links']) {
        const column = page.getByRole('region', { name, exact: true });
        expect((await column.boundingBox())!.height).toBeGreaterThanOrEqual(420);
        await column.scrollIntoViewIfNeeded();
        await inside(page, column);
        expect(await column.locator('.column-scroll').evaluate(el => el.clientHeight)).toBeGreaterThan(200);
      }
      // The utility columns stay in the page, including while the server is unavailable.
      await page.getByLabel('Open a link', { exact: true }).fill('invalid://invented-narrow');
      await page.getByRole('region', { name: 'Links', exact: true }).getByRole('button', { name: 'Open', exact: true }).click();
      expect(await problems(page, 'Scrolling Home')).toEqual([]);
      await page.getByRole('radio', { name: 'Records · Samples and Projects', exact: true }).click();
      for (const name of ['Samples', 'Projects']) {
        const column = page.getByRole('region', { name, exact: true });
        expect((await column.boundingBox())!.height).toBeGreaterThanOrEqual(420);
        await column.scrollIntoViewIfNeeded();
        await innerScroll(column.locator('.record-rows'));
      }
      expect(await problems(page, 'Scrolling Records')).toEqual([]);
    });
  }

}

test('desktop pins stay editable offline and survive a restart of Home', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await layoutHome(page, true, {}, layoutFixtures, { offline: true,
    cached: { asOf: '2026-11-18T10:00:00Z', reason: 'unreachable', detail: 'Invented offline server' } });
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await page.getByTestId('session-card').first().getByRole('button', { name: /^Pin / }).click();
  await expect(page.getByTestId('home-pins').getByTestId('pinned-item')).toHaveCount(1);
  await expect.poll(async () => Object.values(((await storedLayout(page, true))?.homePins ?? {}) as Record<string, unknown[]>)[0]?.length).toBe(1);
  await page.reload();
  await expect(page.getByTestId('home-pins')).toContainText('Board session 0');
  await page.getByTestId('home-pins').getByRole('button', { name: 'Unpin Board session 0', exact: true }).click();
  await expect(page.getByTestId('home-pins').getByTestId('pinned-item')).toHaveCount(0);
  await fixedHome(page);
});

test('thousands of invented sessions remain capped and make no request per row or pin', async ({ page }) => {
  const sessions = Array.from({ length: 2400 }, (_, i) => ({ ...(layoutFixtures['/v1/sessions'] as Record<string, unknown>[])[0], id: `large-${i}`, session_key: `Large session ${i}` }));
  const reads: string[] = [];
  await page.setViewportSize({ width: 1440, height: 900 });
  page.on('request', request => { if (request.url().includes('/v1/')) reads.push(new URL(request.url()).pathname); });
  await layoutHome(page, false, {}, { ...layoutFixtures, '/v1/sessions': sessions });
  await expect(page.getByTestId('home-summary')).toContainText('2400 sessions');
  const before = reads.length;
  await page.getByTestId('session-card').first().getByRole('button', { name: /^Pin / }).click();
  await page.getByRole('button', { name: 'Show not reduced →', exact: true }).click();
  await page.getByRole('region', { name: 'Sessions', exact: true }).getByRole('button', { name: 'Load the rest', exact: true }).click();
  await expect(page.getByTestId('session-card')).toHaveCount(2400);
  expect(reads.length).toBe(before);
  expect(reads.some(path => /^\/v1\/(sessions|mounts)\//.test(path))).toBe(false);
  await fixedHome(page);
});

for (const [width, height] of [[1440, 900], [1280, 800], [1024, 640]]) {
  test(`column headers stay separate from clickable rows at ${width} x ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await layoutHome(page, true);
    for (const [name, testId] of [['Sessions', 'session-card'], ['Mounts', 'mount-card']]) {
      const column = page.getByRole('region', { name, exact: true });
      await column.scrollIntoViewIfNeeded();
      const header = column.locator('.toolbar');
      const headerBox = (await header.boundingBox())!;
      for (const card of [column.getByTestId(testId).last(), column.getByTestId(testId).first()]) {
        await card.scrollIntoViewIfNeeded();
        const button = card.getByRole('button', { name: name === 'Mounts' ? 'Review' : 'Reduce', exact: true });
        await button.click({ trial: true });
        expect((await header.boundingBox())!.y).toBe(headerBox.y);
        const body = (await column.locator('.column-scroll').boundingBox())!;
        expect(body.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
        const control = (await button.boundingBox())!;
        expect(control.y).toBeGreaterThanOrEqual(body.y);
        expect(control.y + control.height).toBeLessThanOrEqual(body.y + body.height + 1);
      }
    }
    const legend = page.getByText('Spot mix ⓘ', { exact: true });
    await legend.click();
    for (const label of ['Sample', 'Primary standard', 'Secondary standard', 'Blank', 'Tune', 'Unclassified']) {
      await expect(page.locator('.spot-key').getByText(label, { exact: true })).toBeVisible();
    }
  });
}
