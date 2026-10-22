export const IS_LOCAL = import.meta.env?.VITE_LERNE_LOCAL === '1';

if (IS_LOCAL && (import.meta.env?.PROD || (typeof window !== 'undefined'
    && !['127.0.0.1', 'localhost'].includes(window.location.hostname)))) {
  throw new Error('LOCAL is available only on the loopback development server');
}

export const localStorageKey = key => IS_LOCAL ? `lerne_local:${key}` : key;
