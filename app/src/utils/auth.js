const storage = {
  get: (key) => {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  set: (key, value) => {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
};

export const getUserId = () => {
  try {
    // 1. Пытаемся взять из Telegram WebApp
    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user?.id) {
      const id = parseInt(tg.initDataUnsafe.user.id);
      if (!isNaN(id)) {
        storage.set('lerne_user_id', id);
        return id;
      }
    }
    
    // 2. Пытаемся взять из URL (?user_id=123)
    const params = new URLSearchParams(window.location.search);
    const urlId = params.get('user_id');
    if (urlId) {
      const id = parseInt(urlId);
      if (!isNaN(id)) {
        storage.set('lerne_user_id', id);
        return id;
      }
    }

    // 3. Пытаемся взять из localStorage
    const savedId = storage.get('lerne_user_id');
    if (savedId) {
      const id = parseInt(savedId);
      if (!isNaN(id)) return id;
    }
    
    // 4. Генерируем новый случайный ID (для новых веб-пользователей)
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
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
