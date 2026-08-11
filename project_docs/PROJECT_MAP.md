# Карта проекта Lerne TMA (Project Map)

## 🌳 Дерево структуры файлов проекта

```
tma/
├── api/                        # БЭКЕНД (FastAPI + Peewee ORM)
│   ├── dependencies/           # Зависимости FastAPI (аутентификация get_user_id)
│   ├── routers/                # Модули API-эндпоинтов
│   │   ├── auth.py             # Регистрация, сессии и синхронизация языка (/user/language)
│   │   ├── decks.py            # Колоды (создание, получение, архивация)
│   │   ├── cards.py            # Операции с карточками и их статусами
│   │   ├── study.py            # Интервальное повторение SM-2
│   │   ├── settings.py         # Настройки ИИ и пользовательские промпты
│   │   ├── ai.py               # Генерация примеров и картинок через ИИ
│   │   ├── folders.py          # Папки и их привязка к языкам
│   │   ├── media.py            # Аудио и изобразительные ресурсы
│   │   └── share.py            # Публичный шеринг колод
│   ├── services/               # Сервисная бизнес-логика
│   ├── index.py                # Точка входа для Vercel Serverless Functions
│   ├── main.py                 # Главный FastAPI app и консолидированный /api/init
│   ├── models.py               # Модели Peewee ORM (TMAUser, TMA_Deck, TMA_Card, etc.)
│   ├── migrations.py           # Система авто-миграций структуры PostgreSQL
│   └── requirements.txt        # Зависимости бэкенда (psycopg2-binary, pg8000)
│
├── app/                        # ФРОНТЕНД (React 18 + Vite)
│   ├── src/
│   │   ├── components/         # Компоненты интерфейса
│   │   │   ├── deckgrid/       # Сетка колод, папки, флаги языков
│   │   │   ├── study/          # Экран обучения, 3D flip card, кнопочная панель SM-2
│   │   │   ├── settings/       # Настройки промптов ИИ и голоса TTS
│   │   │   ├── LanguageSelectionModal.jsx  # Модальное окно выбора языка
│   │   │   └── TopBar.jsx      # Шапка с переключателем языка и профилем
│   │   ├── hooks/              # Кастомные хуки
│   │   │   └── useAppInitialization.js # Инициализация сессии, CloudStorage, DB
│   │   ├── store/              # Zustand Хранилища состояния
│   │   │   ├── useDeckStore.js # Хранение и загрузка колод/карточек
│   │   │   ├── useLanguageStore.js # Управление целевым языком
│   │   │   ├── useUiStore.js   # UI состояния, модалки, тосты
│   │   │   └── useSettingsStore.js # ИИ настройки
│   │   ├── utils/
│   │   │   └── auth.js         # Телеграм профиль, LocalStorage и Telegram CloudStorage API
│   │   ├── App.jsx             # Главный маршутизатор React
│   │   └── main.jsx            # Точка монтирования React DOM
│   ├── vite.config.js          # Конфигурация сборки Vite
│   └── package.json            # Зависимости фронтенда
│
├── project_docs/               # Проектная документация (Эта папка)
├── vercel.json                 # Конфигурация развертывания Vercel (rewrites /api/*)
└── requirements.txt            # Корневой файл зависимостей
```

---

## 🛠 Стек технологий

| Модуль | Технология | Назначение |
| :--- | :--- | :--- |
| **Backend Runtime** | Python 3.12 | Высокопроизводительная среда бэкенда |
| **Web Framework** | FastAPI | Асинхронная обработка HTTP REST API |
| **ORM** | Peewee | Легковесный ORM для маппинга PostgreSQL |
| **DB Drivers** | `psycopg2-binary`, `pg8000` | Двойная система драйверов для Vercel Functions |
| **Frontend Framework** | React 18 | Компонентный UI |
| **Build Tool** | Vite | Моментальная сборка и HMR |
| **State Management** | Zustand | Легковесное реактивное хранилище |
| **Animations** | Framer Motion | 3D-перевороты карточек и анимации выезда |
| **Integration** | Telegram WebApp SDK | Интеграция с Telegram Mini App и CloudStorage API |
| **Cloud Storage** | Supabase PostgreSQL | Облачная масштабируемая реляционная БД |
| **Cloud Hosting** | Vercel | Автоматический деплой статичной сборки и serverless API |
