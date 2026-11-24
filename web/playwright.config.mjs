import { defineConfig, devices } from '@playwright/test';

// Browser journeys against the production build with a mocked API
// (tests/e2e/mock-api.mjs), so they need no backend and run the same in CI.
// Set WEB_E2E_URL to point at an already running server instead.
const PORT = 4174;
const external = process.env.WEB_E2E_URL;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  // Each worker is a full browser; two keep laptops and CI runners responsive.
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  outputDir: './test-results',
  ...(!external && {
    webServer: {
      command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  }),
  use: {
    baseURL: external || `http://127.0.0.1:${PORT}`,
    locale: 'en-US',
    timezoneId: 'Asia/Almaty',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env.PLAYWRIGHT_CHANNEL && { channel: process.env.PLAYWRIGHT_CHANNEL }),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: '**/accessibility.spec.mjs' },
  ],
});
