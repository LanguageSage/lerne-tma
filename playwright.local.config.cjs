const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './scripts/tests/browser',
  testMatch: 'local-mode.check.cjs',
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', headless: true, serviceWorkers: 'block' },
  webServer: {
    command: 'npm --prefix app run dev -- --host 127.0.0.1 --strictPort',
    env: { LERNE_MODE: 'LOCAL', VITE_LERNE_LOCAL: '1' },
    url: 'http://127.0.0.1:5173', reuseExistingServer: false,
  },
});
