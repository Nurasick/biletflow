const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: './.test-artifacts',
  use: {
    baseURL: process.env.MOBILE_WEB_URL || 'http://localhost:8090',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    viewport: { width: 440, height: 956 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
