// Opt-in harness: actual browser modules, actual API proxy, no .env or cloud target.
import baseConfig from '../../app/vite.config.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default async function config(environment) {
  const target = process.env.KNOWLEDGE_HTTP_TARGET;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(target || '')) throw new Error('Disposable loopback API required');
  const base = await baseConfig(environment);
  return {
    ...base,
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app'),
    envDir: false,
    plugins: [...base.plugins, { name: 'knowledge-http-harness', configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== '/knowledge-harness.html') return next();
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><html><body><div id="harness"></div><script type="module" src="/src/hooks/useStudyNavigation.js"></script></body></html>');
      });
    } }],
    server: { ...base.server, host: '127.0.0.1',
      proxy: { '/api': { target, changeOrigin: true } } },
  };
}
