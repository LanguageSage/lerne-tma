import axios from 'axios';
import { getUserId } from '../utils/auth';
import { isOfflineMode } from './localDb';
import { offlineApi } from './offlineApi';

const axiosInstance = axios.create({
  baseURL: '/api',
});

// Добавляем X-User-ID ко всем запросам автоматически
axiosInstance.interceptors.request.use((config) => {
  const userId = getUserId();
  if (userId) {
    config.headers['X-User-ID'] = userId;
  }
  return config;
});

// Проксируем методы Axios для поддержки офлайн-режима
const api = new Proxy(axiosInstance, {
  get(target, propKey, receiver) {
    if (isOfflineMode() && ['get', 'post', 'put', 'delete', 'patch'].includes(propKey)) {
      return async (url, ...args) => {
        // Проверяем, относится ли эндпоинт к локальным данным
        const isOfflineEndpoint = 
          url.startsWith('/decks') || 
          url.startsWith('/cards') || 
          url.startsWith('/study') || 
          url.startsWith('/trash') ||
          url.startsWith('/init');

        if (isOfflineEndpoint) {
          try {
            return await offlineApi.handle(propKey, url, ...args);
          } catch (err) {
            console.error(`[Offline API Error] ${propKey.toUpperCase()} ${url}:`, err);
            throw err;
          }
        }
        
        // Все остальные запросы пропускаем на сервер
        return Reflect.get(target, propKey, receiver).call(target, url, ...args);
      };
    }
    return Reflect.get(target, propKey, receiver);
  },
  
  // Позволяет вызывать api(config) напрямую, если потребуется
  apply(target, thisArg, argumentsList) {
    return Reflect.apply(target, thisArg, argumentsList);
  }
});

export default api;

