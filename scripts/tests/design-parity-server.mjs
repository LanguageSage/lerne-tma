// Production build and dev with synthetic browser APIs. No backend or .env.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const variant = process.argv[2];
if (!['build', 'dev'].includes(variant)) throw Error('Unknown parity mode');
process.env.LERNE_ISOLATED_CHECKS = '1';
for (const key of Object.keys(process.env)) if (key.startsWith('VITE_')) delete process.env[key];
process.env.VITE_API_URL = '/api';
const { build, preview, createServer } = await import('../../app/node_modules/vite/dist/node/index.js');
const options = { root: path.join(root, 'app'), configFile: path.join(root, 'app/vite.config.js') };
if (variant === 'build') {
  const outDir = path.join(root, 'local/test-data/design-parity-build');
  await build({ ...options, build: { outDir, emptyOutDir: true } });
  await preview({ ...options, build: { outDir }, preview: { host: '127.0.0.1', port: 5198, strictPort: true } });
} else {
  const server = await createServer({ ...options, server: { host: '127.0.0.1', port: 5197, strictPort: true } });
  await server.listen();
}
