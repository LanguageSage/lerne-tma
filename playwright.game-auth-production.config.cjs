const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './scripts/tests/browser', testMatch: 'game-auth.spec.cjs', timeout: 30000,
  outputDir: 'test-results/game-auth-production',
  projects: [{ name: 'production', use: { baseURL: 'https://tma-amber.vercel.app', headless: true } }],
  // The spec serves app/dist at the public origin and intercepts all APIs.
  // Build first; no real login/provider/AI requests are made.
});
