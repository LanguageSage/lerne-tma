import axios from 'axios';
import { getUserId } from '../utils/auth';
import { isOfflineMode } from './localDb';
import { offlineApi } from './offlineApi';

const getBaseURL = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  if (typeof window !== 'undefined') {
    if (window.Capacitor || window.location.protocol === 'capacitor:' || window.location.protocol === 'file:') {
      return 'https://tma-amber.vercel.app/api';
    }
  }
  return '/api';
};

const baseURL = getBaseURL();

const axiosInstance = axios.create({
  baseURL: baseURL,
});

// Добавляем X-User-ID ко всем запросам автоматически и отключаем кэширование GET-запросов
axiosInstance.interceptors.request.use((config) => {
  const userId = getUserId();
  if (userId) {
    config.headers['X-User-ID'] = userId;
  }
  if (config.method && config.method.toLowerCase() === 'get') {
    const separator = config.url.includes('?') ? '&' : '?';
    config.url = `${config.url}${separator}_t=${Date.now()}`;
  }
  return config;
});

// Проксируем методы Axios для поддержки офлайн-режима и автоматического фоллбека
const api = new Proxy(axiosInstance, {
  get(target, propKey, receiver) {
    if (['get', 'post', 'put', 'delete', 'patch'].includes(propKey)) {
      return async (url, ...args) => {
        const isOfflineEndpoint = 
          url.startsWith('/decks') || 
          url.startsWith('/folders') ||
          url.startsWith('/cards') || 
          url.startsWith('/study') || 
          url.startsWith('/trash') ||
          url.startsWith('/init');

        const forceOffline = isOfflineMode() || (typeof navigator !== 'undefined' && !navigator.onLine);

        if (forceOffline && isOfflineEndpoint) {
          try {
            return await offlineApi.handle(propKey, url, ...args);
          } catch (err) {
            console.warn(`[Offline Mode Request Failed] ${propKey.toUpperCase()} ${url}:`, err);
          }
        }

        // Try online server request first
        try {
          return await Reflect.get(target, propKey, receiver).call(target, url, ...args);
        } catch (networkErr) {
          // Automatic fallback to local Dexie DB when network is disconnected or server unavailable
          const isNetworkFailure = 
            !navigator?.onLine || 
            networkErr.code === 'ERR_NETWORK' || 
            !networkErr.response || 
            networkErr.message?.includes('Network Error');

          if (isOfflineEndpoint && isNetworkFailure) {
            console.log(`[Network Unavailable] Falling back to local offline DB for ${propKey.toUpperCase()} ${url}`);
            try {
              return await offlineApi.handle(propKey, url, ...args);
            } catch (fallbackErr) {
              console.error(`[Offline Fallback Failed] ${propKey.toUpperCase()} ${url}:`, fallbackErr);
            }
          }
          throw networkErr;
        }
      };
    }
    return Reflect.get(target, propKey, receiver);
  },
  
  apply(target, thisArg, argumentsList) {
    return Reflect.apply(target, thisArg, argumentsList);
  }
});

export default api;


