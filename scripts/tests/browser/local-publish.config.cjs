const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({ testDir: __dirname, testMatch: 'local-publish.check.cjs', workers: 1, timeout: 30000,
  reporter: 'list',
  outputDir: '../../../scratch/local-publish-results',
  use: { baseURL: 'http://127.0.0.1:5183', headless: true, serviceWorkers: 'block' },
  webServer: {
    cwd: require('node:path').resolve(__dirname, '../../..'),
    command: 'node scripts/tests/browser/local-publish-fixture.cjs',
    url: 'http://127.0.0.1:5183', reuseExistingServer: false } });
