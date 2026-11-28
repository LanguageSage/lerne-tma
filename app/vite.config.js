import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'
const standalone = process.env.VITE_LERNE_STANDALONE === '1';
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
export default defineConfig({
  // The regression server must not load developer credentials or proxy to a
  // configured backend. Missing API mocks fail against a closed local port.
  envDir: standalone || process.env.LERNE_ISOLATED_CHECKS === '1' ? false : undefined,
  define: { 'import.meta.env.VITE_LERNE_STANDALONE': JSON.stringify(standalone ? '1' : '0') },
  plugins: [react(), ...(standalone ? [standalonePlugin] : [])],
  server: {
    cors: standalone ? false : undefined,
    hmr: process.env.LERNE_ISOLATED_CHECKS === '1' ? false : undefined,
    host: standalone ? '127.0.0.1' : true,
    port: 5173,
    strictPort: standalone,
    allowedHosts: standalone ? ['localhost', '127.0.0.1'] : true,
    proxy: standalone ? {} : {
      '/api': {
        target: process.env.LERNE_ISOLATED_CHECKS === '1'
          ? 'http://127.0.0.1:1'
          : process.env.VITE_DEV_API_TARGET || 'http://127.0.0.1:8001',
        changeOrigin: true,
      }
    }
  },
  ...(standalone ? {
    preview: {
      cors: false,
      host: '127.0.0.1',
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
})
