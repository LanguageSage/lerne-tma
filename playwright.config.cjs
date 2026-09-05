const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './scripts/tests/browser',
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5199', headless: true },
  webServer: {
    command: 'npm --prefix app run dev -- --host 127.0.0.1 --port 5199 --strictPort',
    url: 'http://127.0.0.1:5199', reuseExistingServer: true,
  },
});
