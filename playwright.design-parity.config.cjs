const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './scripts/tests/browser', testMatch: 'design-local-parity.check.cjs',
  workers: 1, timeout: 60000, reporter: 'list',
  outputDir: './local/test-data/design-parity',
  use: { headless: true, serviceWorkers: 'block' },
  webServer: [['build', 5198], ['local', 5173]].map(([mode, port]) => ({
    command: `node scripts/tests/design-parity-server.mjs ${mode}`,
    url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 120000,
  })),
});
