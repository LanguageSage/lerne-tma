import axios from 'axios';
import { getUserId } from '../utils/auth';

const api = axios.create({
  baseURL: '/api',
});

// Добавляем X-User-ID ко всем запросам автоматически
api.interceptors.request.use((config) => {
  const userId = getUserId();
  if (userId) {
    config.headers['X-User-ID'] = userId;
  }
  return config;
});

export default api;
