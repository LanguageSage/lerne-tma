import { tr } from '../i18n/locale';
const storage = {
  get: (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set: (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  },
  remove: (key) => {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
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
    return Math.floor(100000000 + Math.random() * 900000000); 
  }
};

export const resetUserSession = () => {
  try {
    localStorage.clear();
    sessionStorage.clear();
    const newId = Math.floor(100000000 + Math.random() * 900000000);
    const profile = { user_id: newId, is_guest: true, first_name: tr("Гость") };
    storage.set('lerne_user_id', newId);
    storage.set('lerne_user_profile', JSON.stringify(profile));
    window.location.href = window.location.origin + window.location.pathname;
  } catch (e) {
    console.error("Error resetting user session:", e);
    window.location.reload();
  }
};

export const getUserProfile = () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const isResetRequested = params.get('guest') === '1' || params.get('reset') === '1';

    if (isResetRequested) {
      storage.remove('lerne_user_id');
      storage.remove('lerne_user_profile');
      storage.remove('lerne_init_cache');
      storage.remove('lerne_current_deck_id');
    }

    // 1. Пытаемся взять из Telegram WebApp (если не запрошен сброс в гостя)
    const tg = window.Telegram?.WebApp;
    if (!isResetRequested && tg?.initDataUnsafe?.user?.id) {
      const u = tg.initDataUnsafe.user;
      const profile = {
        user_id: parseUserId(u.id),
        first_name: u.first_name,
        last_name: u.last_name,
        username: u.username,
        photo_url: u.photo_url,
        is_guest: false
      };
      const existingSavedId = storage.get('lerne_user_id');
      if (profile.user_id !== null) {
        if (existingSavedId && parseInt(existingSavedId, 10) !== profile.user_id) {
          storage.set('lerne_previous_guest_id', existingSavedId);
        }
        storage.set('lerne_user_id', profile.user_id);
        storage.set('lerne_user_profile', JSON.stringify(profile));
        return profile;
      }
    }
    
    // 2. Пытаемся взять из URL (?user_id=123)
    const urlIdStr = params.get('user_id');
    if (urlIdStr) {
      const urlId = parseUserId(urlIdStr);
      if (urlId !== null) {
        let existing = null;
        const savedProfileRaw = storage.get('lerne_user_profile');
        if (savedProfileRaw) {
          try {
            const parsed = JSON.parse(savedProfileRaw);
            if (parsed && parsed.user_id === urlId) {
              existing = parsed;
            }
          } catch { /* ignore */ }
        }

        const rawFirstName = params.get('first_name') || params.get('account');
        const validRawName = (rawFirstName && rawFirstName !== 'Пользователь') ? rawFirstName : null;
        const validExistingName = (existing?.first_name && existing.first_name !== 'Пользователь') ? existing.first_name : null;
        const firstNameParam = validRawName || validExistingName || null;

        const lastNameParam = params.get('last_name') || existing?.last_name || null;
        const usernameParam = params.get('username') || existing?.username || null;
        const photoParam = params.get('photo') || params.get('photo_url') || existing?.photo_url || null;
        
        const profile = { 
          user_id: urlId, 
          first_name: firstNameParam, 
          last_name: lastNameParam,
          username: usernameParam,
          photo_url: photoParam,
          is_guest: existing ? Boolean(existing.is_guest) : false 
        };
        storage.set('lerne_user_id', urlId);
        storage.set('lerne_user_profile', JSON.stringify(profile));
        return profile;
      }
    }

    // 3. Пытаемся взять из сохранённого localStorage профиля (высокий приоритет для браузера)
    const savedProfile = storage.get('lerne_user_profile');
    if (savedProfile) {
      try {
        const p = JSON.parse(savedProfile);
        if (p && p.user_id) {
          if (p.first_name === 'Пользователь') {
            p.first_name = null;
            storage.set('lerne_user_profile', JSON.stringify(p));
          }
          return p;
        }
      } catch { /* ignore */ }
    }

    const savedId = storage.get('lerne_user_id');
    if (savedId) {
      const id = parseUserId(savedId);
      if (id !== null) return { user_id: id, is_guest: true };
    }

    // 4. Для локальной веб-разработки (Vite Dev Server) без сохранённого профиля
    const fallbackId = parseUserId(FALLBACK_USER_ID) || 642478257;
    if (import.meta.env.DEV && fallbackId !== null && isLocalHost(window.location.hostname) && !window.Capacitor) {
      const profile = { user_id: fallbackId, is_guest: false, first_name: 'Aruna Андрей', username: 'Aruna27' };
      storage.set('lerne_user_id', fallbackId);
      storage.set('lerne_user_profile', JSON.stringify(profile));
      return profile;
    }
    
    // 5. Генерируем новый случайный ID
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

export const cloudStorage = {
  get: (key) => new Promise((resolve) => {
    try {
      const cs = window.Telegram?.WebApp?.CloudStorage;
      if (cs && typeof cs.getItem === 'function') {
        cs.getItem(key, (err, val) => resolve(err ? null : val));
      } else {
        resolve(null);
      }
    } catch {
      resolve(null);
    }
  }),
  set: (key, val) => new Promise((resolve) => {
    try {
      const cs = window.Telegram?.WebApp?.CloudStorage;
      if (cs && typeof cs.setItem === 'function') {
        cs.setItem(key, String(val), (err) => resolve(!err));
      } else {
        resolve(false);
      }
    } catch {
      resolve(false);
    }
  })
};

export { storage };
