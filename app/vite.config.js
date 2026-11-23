import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const mode = (process.env.LERNE_MODE || '').toUpperCase();
if (mode && mode !== 'LOCAL') throw new Error('Unknown LERNE_MODE; use LOCAL or leave it unset');
const local = mode === 'LOCAL' || process.env.VITE_LERNE_LOCAL === '1';
const standalone = process.env.VITE_LERNE_STANDALONE === '1';
if (local && standalone) throw new Error('LOCAL and STANDALONE cannot be enabled together');
const preview = local && process.env.LERNE_V2_PREVIEW === '1';
const localPort = preview ? 5174 : 5173;
const localApiPort = preview ? 8002 : 8001;
const localNonce = local ? randomBytes(16).toString('base64') : undefined;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localRoot = process.env.LERNE_DATA_ROOT || path.resolve(projectRoot, '../data');
const configPath = path.resolve(process.env.LERNE_LOCAL_CONFIG || path.join(localRoot, 'config/local.json'));
if (local) {
  if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === 'production'
      || process.env.ENVIRONMENT === 'production') throw new Error('LOCAL cannot run in Production');
  const relative = path.relative(fs.realpathSync(projectRoot), fs.realpathSync(configPath));
  if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error('LOCAL config must be outside the repository');
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('VITE_')) delete process.env[key];
  }
  process.env.VITE_LERNE_LOCAL = '1';
}
const localPlugin = {
  name: 'lerne-local-isolation',
  configureServer(server) {
    if (!preview) return;
    server.middlewares.use('/v2-preview', (_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(fs.readFileSync(path.join(projectRoot, 'local/v2_preview.html'), 'utf8')
        .replaceAll('__NONCE__', localNonce));
    });
  },
  transformIndexHtml: html => html.replace(/<link[^>]+https:\/\/fonts\.[^>]+>/g, '')
    .replace(/<script src="https:\/\/telegram\.org[^>]+><\/script>/g, ''),
  transform(code, id) {
    if (id.endsWith('.css')) return code.replace(/@import url\(['"]https?:[^;]+;/g, '');
  },
};
const standalonePlugin = {
  name: 'lerne-standalone-offline',
  transformIndexHtml: html => html.replace(/<link[^>]+https:\/\/fonts\.[^>]+>/g, '')
    .replace(/<script src="https:\/\/telegram\.org[^>]+><\/script>/g, '')
    .replace('</head>', '    <meta name="lerne-android-mode" content="offline-pilot" />\n  </head>'),
  transform(code, id) {
    if (id.endsWith('.css')) return code.replace(/@import url\(['"]https?:[^;]+;/g, '');
  },
};

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  if (local && command !== 'serve') throw new Error('LOCAL is dev-server only; no deployable build');
  return {
  // The regression server must not load developer credentials or proxy to a
  // configured backend. Missing API mocks fail against a closed local port.
  envDir: local || standalone || process.env.LERNE_ISOLATED_CHECKS === '1' ? false : undefined,
  define: { 'import.meta.env.VITE_LERNE_LOCAL': JSON.stringify(local ? '1' : '0'),
    'import.meta.env.VITE_LERNE_STANDALONE': JSON.stringify(standalone ? '1' : '0'),
    'import.meta.env.VITE_LERNE_V2_PREVIEW': JSON.stringify(preview ? '1' : '0') },
  html: { cspNonce: localNonce },
  plugins: [react(), ...(local ? [localPlugin] : []), ...(standalone ? [standalonePlugin] : [])],
  server: {
    hmr: process.env.LERNE_ISOLATED_CHECKS === '1' ? false : undefined,
    host: local ? '127.0.0.1' : true,
    port: local ? localPort : 5173,
    strictPort: local,
    allowedHosts: local ? ['localhost', '127.0.0.1'] : true,
    headers: local ? {
      'Content-Security-Policy': `default-src 'self' blob: data:; script-src 'self' 'nonce-${localNonce}'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:${localPort} ws://localhost:${localPort}; object-src 'none'; frame-src 'none'; form-action 'self'; base-uri 'self'`,
    } : {},
    proxy: {
      '/api': {
        target: local ? `http://127.0.0.1:${localApiPort}` : process.env.LERNE_ISOLATED_CHECKS === '1'
          ? 'http://127.0.0.1:1'
          : process.env.VITE_DEV_API_TARGET || 'http://127.0.0.1:8001',
        changeOrigin: true,
        configure(proxy) {
          if (!local) return;
          proxy.on('proxyReq', (proxyReq, req) => {
            proxyReq.removeHeader('x-lerne-local-secret');
            const loginPaths = preview ? ['/api/auth/local/preview-users', '/api/auth/local/preview-login', '/api/auth/local/preview-admin'] : ['/api/auth/local/login'];
            if (loginPaths.includes(req.url?.split('?')[0])
                && [`http://127.0.0.1:${localPort}`, `http://localhost:${localPort}`].includes(req.headers.origin)) {
              const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
              if (config.login_secret) proxyReq.setHeader('x-lerne-local-secret', config.login_secret);
            }
          });
        },
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) {
              return 'vendor-react';
            }
            if (id.includes('framer-motion')) {
              return 'vendor-motion';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('dexie')) {
              return 'vendor-db';
            }
            return 'vendor-common';
          }
        }
      }
    }
  }
  };
})
