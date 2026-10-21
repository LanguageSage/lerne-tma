const path = require('node:path');
const { devices } = require('@playwright/test');
const base = require('../../../playwright.config.cjs');
const root = path.resolve(__dirname, '../../..');

// Explicit opt-in: installed Chrome + Playwright WebKit are required.
module.exports = { ...base,
  testDir: __dirname,
  outputDir: path.join(root, 'test-results/free-text-compat'),
  webServer: { ...base.webServer, cwd: root },
  projects: [
    { name: 'desktop-chrome', testMatch: /free-text-dictation\.spec\.cjs$/, use: { channel: 'chrome' } },
    { name: 'mobile-chrome', testMatch: /free-text-dictation\.spec\.cjs$/, use: { ...devices['Pixel 5'], channel: 'chrome' } },
    { name: 'mobile-webkit', testMatch: /free-text-dictation\.spec\.cjs$/, use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
};
