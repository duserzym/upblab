import { defineConfig, devices } from '@playwright/test';

// ux-conventions rule 7: the shell is checked at 1440 x 900 and 1280 x 800
// (tests/sizes.spec.ts). Chromium stands for WebView2 (Windows), WebKit for
// WKWebView (macOS). `make e2e` runs it; `make setup` installs the browsers.
const configuredPort = Number(process.env.UPBLAB_E2E_PORT ?? 1431);
const PORT = Number.isFinite(configuredPort) ? configuredPort : 1431;

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  // Most of a run is waiting on the dev server and browsers; more workers than
  // Playwright's default half of the cores cut the full suite about 15 %.
  workers: process.env.CI ? undefined : '80%',
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}/` },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    env: { UPBLAB_DEV_PORT: String(PORT) },
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI && process.env.UPBLAB_E2E_PORT === undefined,
    timeout: 60_000,
  },
});
