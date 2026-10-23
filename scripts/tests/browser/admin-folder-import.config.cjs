const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'admin-folder-import.desktop.cjs',
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:8059', viewport: { width: 1440, height: 900 },
    headless: true, serviceWorkers: 'block', trace: 'retain-on-failure' },
  webServer: {
    command: 'python -m scripts.tests.admin_folder_import_fixture',
    url: 'http://127.0.0.1:8059', reuseExistingServer: false,
    cwd: require('node:path').resolve(__dirname, '../../..'),
  },
});
