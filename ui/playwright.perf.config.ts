import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// The concordia benchmark (tests/concordia-perf.spec.ts) against the production
// build: the dev server runs Svelte's development runtime, whose stack capture
// on every state write dominates per-frame cost and hides the app's own work.
// Port 1432 so it never reuses a dev server from `make e2e`.
const PORT = 1432;
export default defineConfig({
  ...base,
  testMatch: 'concordia-perf.spec.ts',
  fullyParallel: false,
  workers: 1,
  use: { ...base.use, baseURL: `http://localhost:${PORT}/` },
  webServer: {
    command: `pnpm exec vite build --logLevel warn && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
