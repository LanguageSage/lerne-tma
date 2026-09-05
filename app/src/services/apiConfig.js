import { Capacitor } from '@capacitor/core';

export const API_BASE_URL = import.meta.env.VITE_API_URL
  || (Capacitor.isNativePlatform() ? 'https://tma-amber.vercel.app/api' : '/api');

export const mediaURL = (path, kind = 'images') => {
  if (!path) return null;
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  const base = new URL(API_BASE_URL, window.location.origin);
  const relative = path.startsWith('/api/media/')
    ? path : `${base.pathname.replace(/\/$/, '')}/media/${kind}/${path.split(/[\\/]/).pop()}`;
  return new URL(relative, base).href;
};
