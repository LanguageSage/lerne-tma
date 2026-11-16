// Three real frontend modes, synthetic browser APIs only. No backend or .env.
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const variant = process.argv[2];
if (!['build', 'local', 'preview'].includes(variant)) throw Error('Unknown parity mode');
process.env.LERNE_ISOLATED_CHECKS = '1';
delete process.env.LERNE_MODE;
delete process.env.LERNE_V2_PREVIEW;
delete process.env.VITE_LERNE_LOCAL;
for (const key of Object.keys(process.env)) if (key.startsWith('VITE_')) delete process.env[key];
process.env.VITE_API_URL = '/api';
let directory;
if (variant !== 'build') {
  directory = mkdtempSync(path.join(tmpdir(), 'lerne-design-parity-'));
  const config = path.join(directory, 'local.json');
  writeFileSync(config, JSON.stringify({ login_secret: 'synthetic-not-used-by-mocked-api' }));
  process.env.LERNE_MODE = 'LOCAL';
  process.env.LERNE_LOCAL_CONFIG = config;
  if (variant === 'preview') process.env.LERNE_V2_PREVIEW = '1';
  process.on('exit', () => { unlinkSync(config); rmdirSync(directory); });
}
const { build, preview, createServer } = await import('../../app/node_modules/vite/dist/node/index.js');
const options = { root: path.join(root, 'app'), configFile: path.join(root, 'app/vite.config.js') };
if (variant === 'build') {
  const outDir = path.join(root, 'local/test-data/design-parity-build');
  await build({ ...options, build: { outDir, emptyOutDir: true } });
  await preview({ ...options, build: { outDir }, preview: { host: '127.0.0.1', port: 5198, strictPort: true } });
} else {
  const server = await createServer(options);
  await server.listen();
}
