const config = require('../../../playwright.config.cjs');
const path = require('node:path');
const origin = process.env.LERNE_NATIVE_MEDIA_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || '')) throw new Error('Disposable loopback origin required');
const port = new URL(origin).port;
module.exports = {
  ...config,
  testDir: __dirname,
  reporter: 'list',
  use: { ...config.use, baseURL: origin },
  webServer: { ...config.webServer,
    cwd: path.resolve(__dirname, '../../..'),
    command: `npm --prefix app run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: origin,
  },
};
