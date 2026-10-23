const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: __dirname, testMatch: 'admin-transfer.spec.cjs', workers: 1, timeout: 45000,
  reporter: 'list', outputDir: '../../../scratch/transfer-browser-results',
  use: { baseURL: 'http://127.0.0.1:8061', headless: true, serviceWorkers: 'block' },
  webServer: { command: 'python -m scripts.tests.admin_transfer_fixture',
    url: 'http://127.0.0.1:8061', reuseExistingServer: false,
    cwd: require('node:path').resolve(__dirname, '../../..') },
});
