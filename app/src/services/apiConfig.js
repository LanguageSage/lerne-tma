const getApiBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (typeof window === 'undefined') return 'https://tma-amber.vercel.app/api';

  const { hostname, port } = window.location;
  // Local Vite dev server (proxies to local backend)
  if (port === '5173') return '/api';
  // Web build running on Vercel
  if (hostname.endsWith('vercel.app')) return '/api';

  // Android APK (Capacitor / WebView on https://localhost), standalone, or custom host
  return 'https://tma-amber.vercel.app/api';
};

export const API_BASE_URL = getApiBaseUrl();

export const mediaURL = (path, kind = 'images') => {
  if (!path) return null;
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  const base = new URL(API_BASE_URL, window.location.origin);
  const relative = path.startsWith('/api/media/')
    ? path : `${base.pathname.replace(/\/$/, '')}/media/${kind}/${path.split(/[\\/]/).pop()}`;
  return new URL(relative, base).href;
};
