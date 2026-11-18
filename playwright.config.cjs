const { defineConfig } = require('@playwright/test');
const criticalSpecs = /(?:auth-recovery|guest-entry|library-mobile|native-card-editor|cardlist-menu|cardlist-media|list-drag|study-finished)\.spec\.cjs$/;

module.exports = defineConfig({
  testDir: './scripts/tests/browser',
  timeout: 30000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  outputDir: './local/test-data/playwright',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'local/test-data/playwright-report' }]],
  projects: [
    { name: 'critical', testMatch: criticalSpecs },
    { name: 'extended', testMatch: /.*\.spec\.cjs$/, testIgnore: criticalSpecs },
    { name: 'auth-chrome', testMatch: /auth-lifecycle\.spec\.cjs$/,
      use: { channel: 'chrome' } },
  ],
  use: { baseURL: 'http://127.0.0.1:5199', headless: true,
    serviceWorkers: 'block', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm --prefix app run dev -- --host 127.0.0.1 --port 5199 --strictPort',
    env: { LERNE_ISOLATED_CHECKS: '1', VITE_API_URL: '/api' },
    url: 'http://127.0.0.1:5199', reuseExistingServer: false,
  },
});
