import { getAudioUrl } from '../utils/media';
import { IS_STANDALONE } from '../utils/standaloneMode.js';
import { isOfflineMediaUrl, resolveOfflineMediaUrlSync } from '../pilot/offlineMediaResolver.js';

const getApiBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (typeof window === 'undefined') return 'https://tma-amber.vercel.app/api';

  const { hostname, port } = window.location;
  // Local Vite dev server, test runner, or local network
  if (port === '5173' || port === '5199' || hostname === 'localhost' || hostname === '127.0.0.1') return '/api';
  // Web build running on Vercel
  if (hostname.endsWith('vercel.app')) return '/api';

  // Fallback API base URL for custom web hosts (Android Offline Pilot blocks networkApi)
  return 'https://tma-amber.vercel.app/api';
};

export const API_BASE_URL = getApiBaseUrl();

export const mediaURL = (path, kind = 'images') => {
  if (!path) return null;
  if (kind === 'audio') {
    return getAudioUrl(path);
  }
  if (isOfflineMediaUrl(path)) return path;
  if (IS_STANDALONE) return resolveOfflineMediaUrlSync(path, kind);
  const localUrl = resolveOfflineMediaUrlSync(path, kind);
  if (localUrl) return localUrl;
  if (/^https?:/.test(path)) return path;
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://localhost';
  const base = new URL(API_BASE_URL, origin);
  const relative = path.startsWith('/api/media/')
    ? path : `${base.pathname.replace(/\/$/, '')}/media/${kind}/${path.split(/[\\/]/).pop()}`;
  return new URL(relative, base).href;
};
