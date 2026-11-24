const { defineConfig } = require('@playwright/test');

// Without MOBILE_WEB_URL the suite serves the exported web build itself.
// Run `npm run export:check` first (or use `npm run test:e2e:fresh`).
const EXPORT_PORT = Number(process.env.MOBILE_EXPORT_PORT || 8090);
const useLocalExport = !process.env.MOBILE_WEB_URL;

module.exports = defineConfig({
  ...(useLocalExport && {
    webServer: {
      command: 'node scripts/serve-export.cjs',
      env: { MOBILE_EXPORT_PORT: String(EXPORT_PORT) },
      url: `http://127.0.0.1:${EXPORT_PORT}`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  }),
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: './.test-artifacts',
  use: {
    baseURL: process.env.MOBILE_WEB_URL || `http://127.0.0.1:${EXPORT_PORT}`,
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    viewport: { width: 440, height: 956 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
