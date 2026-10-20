const { test: base, expect } = require('@playwright/test');

// Shared by the critical specs. Browser assets come only from our Vite server;
// API responses are supplied by each spec. Unmatched APIs cannot hit a backend
// because the regression Vite server has its proxy disabled.
const test = base.extend({
  context: async ({ context }, use) => {
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === 'http://127.0.0.1:5199'
        ? route.continue() : route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*', () => {});
    await use(context);
  },
});

module.exports = { test, expect };
