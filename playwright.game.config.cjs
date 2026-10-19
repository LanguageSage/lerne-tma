const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './scripts/tests/browser', testMatch: 'game-mode.spec.cjs', timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5211', headless: true, viewport: { width: 393, height: 851 } },
  webServer: { command: 'npm --prefix app run dev -- --host 127.0.0.1 --port 5211 --strictPort',
    url: 'http://127.0.0.1:5211', reuseExistingServer: false },
});
