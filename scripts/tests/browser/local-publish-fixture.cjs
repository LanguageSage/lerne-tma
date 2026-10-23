/* Compile the real component for a test-only loopback fixture, without Vite HMR,
 * application startup, dotenv, or any configured API proxy. No files are emitted.
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const http = require('node:http');

(async () => {
  const root = path.resolve(__dirname, '../../..');
  const { build } = await import(pathToFileURL(path.join(root, 'app/node_modules/vite/dist/node/index.js')));
  const result = await build({ configFile: false, root: path.join(root, 'app'), envDir: false, logLevel: 'error',
    define: { 'import.meta.env.VITE_LERNE_LOCAL': '"1"', 'import.meta.env.PROD': 'false',
      'process.env.NODE_ENV': '"production"' },
    build: { write: false, minify: false, lib: { entry: path.join(__dirname, 'local-publish-entry.jsx'),
      name: 'LocalPublishFixture', formats: ['iife'] } },
  });
  const outputs = Array.isArray(result) ? result.flatMap(item => item.output) : result.output;
  const script = outputs.find(item => item.type === 'chunk').code;
  http.createServer((request, response) => {
    if (request.url === '/harness.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); response.end(script);
    } else if (request.url === '/' || request.url === '/publish-harness') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html lang="ru"><head><meta charset="utf-8">'
        + outputs.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => `<link rel="stylesheet" href="/${item.fileName}">`).join('')
        + '</head><body><div id="harness"></div><script src="/harness.js"></script></body></html>');
    } else if (outputs.some(item => '/' + item.fileName === request.url && item.type === 'asset')) {
      const asset = outputs.find(item => '/' + item.fileName === request.url);
      response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' }); response.end(asset.source);
    } else { response.writeHead(404); response.end(); }
  }).listen(5183, '127.0.0.1');
})().catch(error => { console.error(error); process.exit(1); });
