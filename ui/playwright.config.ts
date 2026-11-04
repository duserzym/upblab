import { defineConfig, devices } from '@playwright/test';

// ux-conventions rule 7: the shell is checked at 1440 x 900 and 1280 x 800
// (tests/sizes.spec.ts). Chromium stands for WebView2 (Windows), WebKit for
// WKWebView (macOS). `make e2e` runs it; `make setup` installs the browsers.
const PORT = 1431;

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}/` },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
