const storage = {
  get: (key) => {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  set: (key, value) => {
    try { localStorage.setItem(key, value); } catch (e) {}
  },
  remove: (key) => {
    try { localStorage.removeItem(key); } catch (e) {}
  }
};

const FALLBACK_USER_ID = import.meta.env.VITE_TMA_USER_ID_FALLBACK;
const LOCAL_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./
];

const parseUserId = (value) => {
  const id = parseInt(value);
  return Number.isNaN(id) ? null : id;
};

const isLocalHost = (hostname) => LOCAL_HOST_PATTERNS.some(pattern => pattern.test(hostname));

export const getUserId = () => {
  try {
    // 1. Пытаемся взять из Telegram WebApp
    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user?.id) {
      const id = parseUserId(tg.initDataUnsafe.user.id);
      if (id !== null) {
        storage.set('lerne_user_id', id);
        return id;
      }
    }
    
    // 2. Пытаемся взять из URL (?user_id=123)
    const params = new URLSearchParams(window.location.search);
    const urlId = params.get('user_id');
    if (urlId) {
      const id = parseUserId(urlId);
      if (id !== null) {
        storage.set('lerne_user_id', id);
        return id;
      }
    }

    // 3. Для локальной разработки можно зафиксировать пользователя в app/.env:
    // VITE_TMA_USER_ID_FALLBACK=7187932783
    const fallbackId = parseUserId(FALLBACK_USER_ID);
    if (fallbackId !== null && isLocalHost(window.location.hostname)) {
      storage.set('lerne_user_id', fallbackId);
      return fallbackId;
    }

    // 4. Пытаемся взять из localStorage
    const savedId = storage.get('lerne_user_id');
    if (savedId) {
      const id = parseUserId(savedId);
      if (id !== null) return id;
    }
    
    // 5. Генерируем новый случайный ID (для новых веб-пользователей)
    if (isLocalHost(window.location.hostname)) {
      return 642478257;
    }

    const newId = Math.floor(100000000 + Math.random() * 900000000);
    storage.set('lerne_user_id', newId);
    return newId;
  } catch (err) {
    console.error("Critical error in getUserId:", err);
    return 642478257; 
  }
};

export { storage };
