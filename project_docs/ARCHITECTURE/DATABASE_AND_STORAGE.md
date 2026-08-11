# 📐 Архитектура БД и 3-Уровневой Системы Хранения

Техническая спецификация базы данных PostgreSQL Supabase и каскадной системы хранения состояния пользователя в Telegram Mini App.

---

## 🗄 Схема Сборки Базы Данных в Supabase (PostgreSQL)

```mermaid
erDiagram
    TMAUser ||--o{ TMADeck : "создает"
    TMAUser ||--o{ TMAFolder : "создает"
    TMAUser ||--o{ TMACustomPrompt : "настраивает"
    TMAFolder ||--o{ TMADeck : "содержит"
    TMADeck ||--o{ TMACard : "содержит"
    TMAUser ||--o{ TMAProgress : "имеет"
    TMACard ||--o{ TMAProgress : "отслеживается"

    TMAUser {
        bigint user_id PK
        string first_name
        string username
        string active_language
        boolean has_selected_language
        boolean is_guest
    }

    TMADeck {
        int id PK
        bigint user_id FK
        string name
        string target_language
        int folder_id FK
        boolean is_pinned
        int position
    }

    TMACard {
        int id PK
        int deck_id FK
        string front_text
        string back_text
        string context
        string audio_url
    }

    TMAProgress {
        bigint user_id PK,FK
        int card_id PK,FK
        float ease_factor
        int interval
        int repetitions
        timestamp next_review
        string queue
    }
```

---

## 🔄 Механизм Каскадного Хранения (Cascading Storage)

Для предотвращения потери состояния выбранного языка во встроенном WebKit браузере Telegram применён каскад из трёх связанных слоёв:

1. **Слой 1 — Client `LocalStorage`**:
   - Чтение происходит мгновенно в синхронном режиме.
   - Запись выполняется при любом изменении через `localStorage.setItem()`.

2. **Слой 2 — Telegram `CloudStorage API`**:
   - Вызывается при отсутствии данных в `LocalStorage` или при первом старте.
   - Запись осуществляется через `window.Telegram.WebApp.CloudStorage.setItem()`.
   - Гарантирует сохранение между сессиями во встроенном контейнере Telegram iOS/Android.

3. **Слой 3 — PostgreSQL Backend Database**:
   - Фиксируется на сервере при вызове `POST /user/language` или `/auth/sync`.
   - Запрашивается бэкендом при консолидированной инициализации `/api/init`.
