import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { largeReviewFixtures } from './fixtures/review-large';
import { openReview } from './review-helpers';

type Recorder = {
  started: number;
  last: number;
  raf: number;
  intervals: number[];
  observer?: PerformanceObserver;
  longTasks?: { count: number; totalDurationMs: number };
  action?: Promise<number>;
};
declare global {
  interface Window { __concordiaPerf?: Recorder }
}
type Scenario = 'pan' | 'zoom' | 'hover' | 'select' | 'diagram-switch' | 'sample-toggle';
const scenarios: Scenario[] = ['pan', 'zoom', 'hover', 'select', 'diagram-switch', 'sample-toggle'];
const diagrams = ['wetherill', 'tw'] as const;
const enabled = !!process.env.CONCORDIA_PERF;
const sizes: number[] = enabled ? [...new Set((process.env.CONCORDIA_PERF_N ?? '800,2000').split(',').map((value: string) => {
  const n = Number(value.trim());
  if (!Number.isSafeInteger(n) || n < 41) throw new Error('CONCORDIA_PERF_N must contain integer spot counts >= 41');
  return n;
}))] : [800, 2000];

const durationMetrics = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'] as const;
const countMetrics = ['LayoutCount', 'RecalcStyleCount'] as const;
async function metrics(cdp?: CDPSession): Promise<Record<string, number> | undefined> {
  if (!cdp) return;
  const reply = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(reply.metrics.map((metric: { name: string; value: number }) => [metric.name, metric.value]));
}
const rounded = (value: number) => Math.round(value * 1000) / 1000;
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return {
    count: n,
    medianMs: n ? rounded((sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2) : null,
    p95Ms: n ? rounded(sorted[Math.ceil(n * 0.95) - 1]) : null,
    maxMs: n ? rounded(sorted[n - 1]) : null,
  };
}
async function frames(page: Page, count = 2) {
  await page.evaluate(count => new Promise<void>(resolve => {
    const next = () => { if (--count === 0) resolve(); else requestAnimationFrame(next); };
    requestAnimationFrame(next);
  }), count);
}
async function startRecording(page: Page, chromium: boolean) {
  await page.evaluate(chromium => new Promise<void>(resolve => {
    const state: Recorder = { started: 0, last: 0, raf: 0, intervals: [] };
    window.__concordiaPerf = state;
    if (chromium && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      state.longTasks = { count: 0, totalDurationMs: 0 };
      state.observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (entry.startTime >= state.started) {
          state.longTasks!.count++;
          state.longTasks!.totalDurationMs += entry.duration;
        }
      });
      state.observer.observe({ type: 'longtask' });
    }
    const tick = (time: number) => {
      state.intervals.push(time - state.last);
      state.last = time;
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(time => {
      state.started = state.last = time;
      state.raf = requestAnimationFrame(tick);
      resolve();
    });
  }), chromium);
}
async function stopRecording(page: Page) {
  return page.evaluate(() => {
    const state = window.__concordiaPerf!;
    cancelAnimationFrame(state.raf);
    const wallTimeMs = performance.now() - state.started;
    for (const entry of state.observer?.takeRecords() ?? []) if (entry.startTime >= state.started) {
      state.longTasks!.count++;
      state.longTasks!.totalDurationMs += entry.duration;
    }
    state.observer?.disconnect();
    delete window.__concordiaPerf;
    return { intervals: state.intervals, wallTimeMs, ...(state.longTasks ? { longTasks: state.longTasks } : {}) };
  });
}

// Start each discrete latency at the actual input event, excluding Playwright's
// actionability checks. The frame fence is scheduled in-page at that event too.
async function actionLatency(page: Page, target: Locator, event: string, frameCount: number, action: () => Promise<unknown>) {
  await target.evaluate((element, { event, frameCount }) => {
    window.__concordiaPerf!.action = new Promise<number>(resolve => {
      element.addEventListener(event, () => {
        const start = performance.now();
        const next = () => {
          if (--frameCount === 0) resolve(performance.now() - start);
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }, { capture: true, once: true });
    });
  }, { event, frameCount });
  await action();
  return page.evaluate(() => window.__concordiaPerf!.action!);
}

// Locate the dense population from coloured pixels in the rendered canvas.
// This stays independent of DOM hit targets, uPlot internals and axis bounds.
async function denseSweep(canvas: Locator) {
  return canvas.evaluate(element => {
    const canvas = element as HTMLCanvasElement, box = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d')!;
    const { width, height } = canvas, pixels = ctx.getImageData(0, 0, width, height).data;
    const columns = 24, rows = 16, bins = new Array<number>(columns * rows).fill(0);
    for (let y = Math.floor(height * 0.05); y < height * 0.9; y += 2) {
      for (let x = Math.floor(width * 0.08); x < width * 0.98; x += 2) {
        const offset = (y * width + x) * 4;
        const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
        if (pixels[offset + 3] > 100 && Math.max(r, g, b) - Math.min(r, g, b) > 40)
          bins[Math.floor(y / height * rows) * columns + Math.floor(x / width * columns)]++;
      }
    }
    const best = bins.indexOf(Math.max(...bins));
    if (!bins[best]) throw new Error('No coloured measurements found on the concordia canvas');
    const x = box.x + ((best % columns) + 0.5) / columns * box.width;
    const y = box.y + (Math.floor(best / columns) + 0.5) / rows * box.height;
    return {
      left: Math.max(box.x + box.width * 0.15, x - 60),
      right: Math.min(box.right - 12, x + 60),
      top: Math.max(box.y + 12, y - 30),
      bottom: Math.min(box.bottom - box.height * 0.15, y + 30),
    };
  });
}

type Measurement = ReturnType<typeof distribution> & {
  wallTimeMs: number;
  framesOver33Ms: number;
  frameIntervalsMs: number[];
  longTasks?: { count: number; totalDurationMs: number };
  cdp?: Record<string, number>;
  actions?: { count: number; medianMs: number | null; maxMs: number | null; latenciesMs: number[] };
};
type Report = {
  schemaVersion: number;
  browser: string;
  browserVersion: string;
  viewport: { width: number; height: number };
  results: Record<string, Record<string, Partial<Record<Scenario, Measurement & { measuredAt: string }>>>>;
};
async function save(browser: string, browserVersion: string, n: number, diagram: string, scenario: Scenario, result: Measurement) {
  const directory = resolve('test-results'), path = resolve(directory, `concordia-perf-${browser}.json`);
  await mkdir(directory, { recursive: true });
  let report: Report;
  try { report = JSON.parse(await readFile(path, 'utf8')) as Report; }
  catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
    report = { schemaVersion: 1, browser, browserVersion, viewport: { width: 1440, height: 900 }, results: {} };
  }
  report.browserVersion = browserVersion;
  ((report.results[String(n)] ??= {})[diagram] ??= {})[scenario] = { measuredAt: new Date().toISOString(), ...result };
  await writeFile(`${path}.tmp`, `${JSON.stringify(report, null, 2)}\n`);
  await rename(`${path}.tmp`, path);
}

test.describe('Concordia performance (opt-in)', () => {
  test.skip(!enabled, 'Set CONCORDIA_PERF=1 to run the benchmark');
  // Override fullyParallel: one writer and one measured page per browser project.
  test.describe.configure({ mode: 'serial' });
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const n of sizes) for (const diagram of diagrams) {
    test(`${n} spots / ${diagram}`, async ({ page, browserName, browser }) => {
      test.setTimeout(119_000);
      const { session, fixtures } = largeReviewFixtures(n);
      await openReview(page, { fixtures, store: {
        reviewScope: JSON.stringify({ kind: 'session', id: session.id, run: 'preferred' }),
      } });
      const plot = page.getByTestId('review-plot');
      const canvas = plot.locator('canvas').first();
      // CSS locators: label/role queries scan every spot button in the page and
      // would add Playwright's own main-thread work to the measured frames.
      const select = page.locator('[role=radiogroup][aria-label="Concordia diagram"]');
      const tree = page.locator('[role="tree"][aria-label="Result spots"]');
      await expect(canvas).toBeVisible();
      await expect(tree.locator('[data-spot-key]')).toHaveCount(n);
      // Five samples default to collapsed except the selected sample. Open all
      // so keyboard navigation can cross sample boundaries even for small n.
      for (let sample = 1; sample <= 5; sample++) {
        const expand = tree.getByRole('button', { name: `Expand Invented sample ${sample}`, exact: true });
        if (await expand.count()) await expand.click();
      }
      await select.locator(`[role=radio][value="${diagram}"]`).click();
      // Allow the initial 100 ms ResizeObserver debounce and font layout to settle.
      await page.waitForTimeout(250);
      await frames(page);
      let cdp: CDPSession | undefined;
      if (browserName === 'chromium') {
        cdp = await page.context().newCDPSession(page);
        await cdp.send('Performance.enable');
      }
      const table: string[] = [`${browserName} | n=${n} | ${diagram}`, 'scenario       frames  med ms  p95 ms  max ms  >33  wall ms  action med/max ms  longtasks/ms'];
      try {
        for (const scenario of scenarios) {
          await page.getByRole('group', { name: 'Concordia navigation', exact: true }).getByRole('button', { name: 'Fit all', exact: true }).click();
          await page.mouse.move(5, 5);
          await frames(page);
          const box = (await canvas.boundingBox())!;
          const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          const sweep = scenario === 'hover' ? await denseSweep(canvas) : undefined;
          const chip = page.locator('[aria-label="Sample legend"] button').first();
          let selectionKeys: string[] = [];
          if (scenario === 'select') {
            selectionKeys = await tree.locator('[data-spot-key]').evaluateAll(buttons => buttons.map(b => b.getAttribute('data-spot-key')!));
            await tree.locator('[data-spot-key]').first().click();
            await tree.focus();
            await frames(page);
          }
          if (scenario === 'pan' || scenario === 'zoom') await page.mouse.move(center.x, center.y);
          if (scenario === 'pan') await expect(page.locator('[aria-label="Concordia navigation"] [role=radio]', { hasText: /^Pan$/ })).toHaveAttribute('aria-checked', 'true');
          const before = await metrics(cdp);
          await startRecording(page, browserName === 'chromium');
          const latencies: number[] = [];
          if (scenario === 'pan') {
            // Pointer capture permits the 360 px drag to continue past the canvas.
            const dx = center.x + 360 < 1440 ? 3 : -3, dy = center.y + 360 < 900 ? 3 : -3;
            await page.mouse.down();
            for (let step = 1; step <= 120; step++) await page.mouse.move(center.x + step * dx, center.y + step * dy);
            await page.mouse.up();
          } else if (scenario === 'zoom') {
            for (let i = 0; i < 40; i++) {
              await page.mouse.wheel(0, Math.floor(i / 10) % 2 === 0 ? -56 : 56);
              await frames(page, 1);
            }
          } else if (scenario === 'hover') {
            for (let i = 0; i < 150; i++) {
              const row = Math.floor(i / 15), column = row % 2 === 0 ? i % 15 : 14 - i % 15;
              await page.mouse.move(sweep!.left + column / 14 * (sweep!.right - sweep!.left), sweep!.top + row / 9 * (sweep!.bottom - sweep!.top));
            }
          } else if (scenario === 'select') {
            for (let i = 0; i < 40; i++) latencies.push(await actionLatency(page, tree, 'keydown', 1, () => page.keyboard.press('ArrowDown')));
          } else if (scenario === 'diagram-switch') {
            for (let i = 0; i < 6; i++) {
              const next = i % 2 === 0 ? (diagram === 'tw' ? 'wetherill' : 'tw') : diagram;
              latencies.push(await actionLatency(page, select, 'click', 2, () => select.locator(`[role=radio][value="${next}"]`).click()));
            }
          } else {
            for (let i = 0; i < 6; i++) latencies.push(await actionLatency(page, chip, 'click', 2, () => chip.click()));
          }
          await frames(page);
          const recording = await stopRecording(page), after = await metrics(cdp);
          if (scenario === 'select') {
            expect(await page.evaluate(() => document.activeElement?.getAttribute('data-spot-key'))).toBe(selectionKeys[40]);
          }
          if (scenario === 'diagram-switch') await expect(select.locator(`[role=radio][value="${diagram}"]`)).toHaveAttribute('aria-checked', 'true');
          if (scenario === 'sample-toggle') await expect(chip).toHaveAttribute('aria-pressed', 'true');
          const result: Measurement = {
            ...distribution(recording.intervals), wallTimeMs: rounded(recording.wallTimeMs),
            framesOver33Ms: recording.intervals.filter(ms => ms > 33).length,
            frameIntervalsMs: recording.intervals.map(rounded),
            ...(recording.longTasks ? { longTasks: { count: recording.longTasks.count, totalDurationMs: rounded(recording.longTasks.totalDurationMs) } } : {}),
            ...(before && after ? { cdp: Object.fromEntries([
              ...durationMetrics.map(key => [`${key}Ms`, rounded((after[key] - before[key]) * 1000)]),
              ...countMetrics.map(key => [key, after[key] - before[key]]),
            ]) } : {}),
            ...(latencies.length ? { actions: { count: latencies.length, medianMs: distribution(latencies).medianMs, maxMs: distribution(latencies).maxMs, latenciesMs: latencies.map(rounded) } } : {}),
          };
          expect(result.count).toBeGreaterThan(0);
          await save(browserName, browser.version(), n, diagram, scenario, result);
          table.push(`${scenario.padEnd(14)} ${String(result.count).padStart(6)} ${String(result.medianMs).padStart(7)} ${String(result.p95Ms).padStart(7)} ${String(result.maxMs).padStart(7)} ${String(result.framesOver33Ms).padStart(4)} ${String(result.wallTimeMs).padStart(8)}  ${result.actions ? `${result.actions.medianMs}/${result.actions.maxMs}` : '-'}  ${result.longTasks ? `${result.longTasks.count}/${result.longTasks.totalDurationMs}` : '-'}`);
          if (result.cdp) table.push(`  CDP ${JSON.stringify(result.cdp)}`);
        }
      } finally {
        await cdp?.detach();
        console.log(table.join('\n'));
      }
    });
  }
});
