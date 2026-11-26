import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'
import { Buffer } from 'node:buffer'
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
const rawStandalonePort = Number.parseInt(process.env.LERNE_STANDALONE_PORT || '', 10);
const standalonePort = Number.isInteger(rawStandalonePort) && rawStandalonePort > 0 && rawStandalonePort <= 65535
  ? rawStandalonePort
  : 5175;
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
const STANDALONE_HOST_ALLOWLIST = {
  gemini: (host) => host === 'generativelanguage.googleapis.com',
  openrouter: (host) => host === 'openrouter.ai',
  groq: (host) => host === 'api.groq.com',
  azure_tts: (host) => /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?\.tts\.speech\.microsoft\.com$/.test(host),
};

const RESERVED_EXT_HEADERS = new Set([
  'authorization',
  'x-goog-api-key',
  'ocp-apim-subscription-key',
  'host',
  'content-length',
  'cookie',
  'set-cookie',
]);

function scrubSecretText(text, secret) {
  const s = String(secret || '').trim();
  const raw = String(text || '');
  return s.length >= 4 ? raw.replaceAll(s, '***') : raw;
}

function attachStandaloneExtHttpsMiddleware(server, allowedOrigins) {
  server.middlewares.use('/__standalone_ext_https', (req, res) => {
    let responded = false;
    const fail = (status, message) => {
      if (responded) return;
      responded = true;
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ ok: false, error: message }));
    };

    const remote = req.socket?.remoteAddress || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
      return fail(403, 'Loopback requests only');
    }
    if (req.method !== 'POST') {
      return fail(405, 'Method not allowed');
    }
    if (Array.isArray(req.headers.origin) || Array.isArray(req.headers.host)) {
      return fail(403, 'Invalid duplicate security headers');
    }
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !allowedOrigins.has(origin)) {
      return fail(403, 'Untrusted origin');
    }

    const chunks = [];
    let totalBytes = 0;
    const MAX_BODY = 2 * 1024 * 1024;
    req.on('data', (chunk) => {
      if (responded) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY) {
        fail(413, 'Request body too large');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => fail(400, 'Stream read error'));
    req.on('end', async () => {
      if (responded) return;
      let apiKey = '';
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const slot = String(parsed?.slot || '').trim();
        const rawUrl = String(parsed?.url || '').trim();
        const method = String(parsed?.method || 'POST').trim().toUpperCase();
        apiKey = String(parsed?.apiKey || '').trim();
        const validator = STANDALONE_HOST_ALLOWLIST[slot];
        if (!validator) return fail(403, 'Unsupported provider slot');
        if (!['GET', 'POST'].includes(method)) return fail(400, 'Unsupported HTTP method');
        if (!apiKey) return fail(401, 'API key is required');

        let target;
        try {
          target = new URL(rawUrl);
        } catch {
          return fail(400, 'Invalid target URL');
        }
        if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443')) {
          return fail(403, 'Only standard HTTPS URLs are permitted');
        }
        if (!validator(target.hostname.toLowerCase())) {
          return fail(403, `Host not allowed for ${slot}`);
        }

        const outHeaders = {};
        if (parsed?.headers && typeof parsed.headers === 'object') {
          for (const [k, v] of Object.entries(parsed.headers)) {
            const trimmed = String(k).trim();
            const lower = trimmed.toLowerCase();
            if (trimmed && !RESERVED_EXT_HEADERS.has(lower) && typeof v === 'string' && !/[\r\n]/.test(v)) {
              outHeaders[trimmed] = v;
            }
          }
        }
        if (slot === 'gemini') outHeaders['x-goog-api-key'] = apiKey;
        else if (slot === 'azure_tts') outHeaders['Ocp-Apim-Subscription-Key'] = apiKey;
        else outHeaders.Authorization = `Bearer ${apiKey}`;

        const timeoutMs = Math.max(1000, Math.min(120000, Number(parsed?.timeoutMs) || 45000));
        const body = method === 'POST'
          ? (typeof parsed?.bodyBase64 === 'string'
            ? Buffer.from(parsed.bodyBase64, 'base64')
            : (typeof parsed?.body === 'string' ? parsed.body : undefined))
          : undefined;

        const upstream = await fetch(target.toString(), {
          method,
          headers: outHeaders,
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });
        const maxRespBytes = 20 * 1024 * 1024;
        const respChunks = [];
        let respTotal = 0;
        if (upstream.body && typeof upstream.body.getReader === 'function') {
          const reader = upstream.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            respTotal += value.byteLength;
            if (respTotal > maxRespBytes) {
              await reader.cancel().catch(() => {});
              return fail(502, 'Upstream response exceeded 20 MiB');
            }
            respChunks.push(Buffer.from(value));
          }
        } else {
          const fallbackBuf = Buffer.from(await upstream.arrayBuffer());
          if (fallbackBuf.length > maxRespBytes) {
            return fail(502, 'Upstream response exceeded 20 MiB');
          }
          respChunks.push(fallbackBuf);
        }
        const buf = Buffer.concat(respChunks);
        const contentType = upstream.headers.get('content-type') || '';
        const responseType = parsed?.responseType === 'base64' ? 'base64' : 'text';

        res.statusCode = 200;
        responded = true;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({
          status: upstream.status,
          ok: upstream.ok,
          contentType,
          ...(responseType === 'base64' && upstream.ok
            ? { bodyBase64: buf.toString('base64') }
            : { bodyText: upstream.ok ? buf.toString('utf8') : scrubSecretText(buf.toString('utf8'), apiKey) }),
        }));
      } catch (err) {
        return fail(502, scrubSecretText(err?.message || 'Upstream HTTPS error', apiKey));
      }
    });
  });
}

const standaloneAllowedOrigins = new Set([
  `http://127.0.0.1:${standalonePort}`,
  `http://localhost:${standalonePort}`,
]);

const standalonePlugin = {
  name: 'lerne-standalone-offline',
  configureServer(server) {
    attachStandaloneExtHttpsMiddleware(server, standaloneAllowedOrigins);
  },
  configurePreviewServer(server) {
    attachStandaloneExtHttpsMiddleware(server, standaloneAllowedOrigins);
  },
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
    host: (local || standalone) ? '127.0.0.1' : true,
    port: local ? localPort : standalone ? standalonePort : 5173,
    strictPort: local || standalone,
    allowedHosts: (local || standalone) ? ['localhost', '127.0.0.1'] : true,
    headers: local ? {
      'Content-Security-Policy': `default-src 'self' blob: data:; script-src 'self' 'nonce-${localNonce}'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:${localPort} ws://localhost:${localPort}; object-src 'none'; frame-src 'none'; form-action 'self'; base-uri 'self'`,
    } : {},
    proxy: standalone ? {} : {
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
  ...(standalone ? {
    preview: {
      host: '127.0.0.1',
      port: standalonePort,
      strictPort: true,
      allowedHosts: ['localhost', '127.0.0.1'],
    },
  } : {}),
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
