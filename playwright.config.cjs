const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './scripts/tests/browser',
  timeout: 30000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  outputDir: './local/test-data/playwright',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'local/test-data/playwright-report' }]],
  projects: [
    { name: 'critical', testMatch: /(?:guest-entry|library-mobile|card-editor|study-finished|offline)\.spec\.cjs$/,
      // Requires a separately started HTTP sandbox; never probe an arbitrary
      // running backend during the isolated gate.
      grepInvert: /two separate devices exchange real HTTP/ },
    { name: 'extended', testMatch: /.*\.spec\.cjs$/,
      testIgnore: /(?:guest-entry|library-mobile|card-editor|study-finished|offline)\.spec\.cjs$/ },
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
