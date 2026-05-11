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
    const profile = getUserProfile();
    return profile.user_id;
  } catch (err) {
    console.error("Critical error in getUserId:", err);
    return 642478257; 
  }
};

export const getUserProfile = () => {
  try {
    // 1. Пытаемся взять из Telegram WebApp
    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user?.id) {
      const u = tg.initDataUnsafe.user;
      const profile = {
        user_id: parseUserId(u.id),
        first_name: u.first_name,
        last_name: u.last_name,
        username: u.username,
        photo_url: u.photo_url,
        is_guest: false
      };
      if (profile.user_id !== null) {
        storage.set('lerne_user_id', profile.user_id);
        storage.set('lerne_user_profile', JSON.stringify(profile));
        return profile;
      }
    }
    
    // 2. Пытаемся взять из URL (?user_id=123)
    const params = new URLSearchParams(window.location.search);
    const urlIdStr = params.get('user_id');
    if (urlIdStr) {
      const urlId = parseUserId(urlIdStr);
      if (urlId !== null) {
        // Проверяем, нет ли уже в сторадже полноценного профиля для этого ID
        const savedProfile = storage.get('lerne_user_profile');
        if (savedProfile) {
          try {
            const p = JSON.parse(savedProfile);
            if (p.user_id === urlId && !p.is_guest) {
              return p; // Оставляем как есть, если это уже не гость
            }
          } catch (e) {}
        }
        
        // Если ID новый или в сторадже был гость - создаем временный профиль
        const profile = { user_id: urlId, is_guest: true };
        storage.set('lerne_user_id', urlId);
        storage.set('lerne_user_profile', JSON.stringify(profile));
        return profile;
      }
    }

    // 3. Для локальной разработки
    const fallbackId = parseUserId(FALLBACK_USER_ID);
    if (fallbackId !== null && isLocalHost(window.location.hostname)) {
      const profile = { user_id: fallbackId, is_guest: true, first_name: 'Dev Admin' };
      storage.set('lerne_user_id', fallbackId);
      storage.set('lerne_user_profile', JSON.stringify(profile));
      return profile;
    }

    // 4. Пытаемся взять из localStorage
    const savedProfile = storage.get('lerne_user_profile');
    if (savedProfile) {
      try {
        return JSON.parse(savedProfile);
      } catch (e) {}
    }

    const savedId = storage.get('lerne_user_id');
    if (savedId) {
      const id = parseUserId(savedId);
      if (id !== null) return { user_id: id, is_guest: true };
    }
    
    // 5. Генерируем новый случайный ID (для новых веб-пользователей)
    const hostname = window.location.hostname;
    if (isLocalHost(hostname)) {
      const profile = { user_id: 642478257, is_guest: true, first_name: 'Local User' };
      storage.set('lerne_user_id', 642478257);
      storage.set('lerne_user_profile', JSON.stringify(profile));
      return profile;
    }

    const newId = Math.floor(100000000 + Math.random() * 900000000);
    const profile = { user_id: newId, is_guest: true };
    storage.set('lerne_user_id', newId);
    storage.set('lerne_user_profile', JSON.stringify(profile));
    return profile;
  } catch (err) {
    console.error("Error in getUserProfile:", err);
    return { user_id: 642478257, is_guest: true };
  }
};

export { storage };
