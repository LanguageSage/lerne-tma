# Lerne Telegram Mini App (TMA)

Современное веб-приложение для изучения языковых карточек с интервальным повторением (SRS SM-2), ИИ-генерацией и совместным редактированием колод. Работает как внутри Telegram Mini App, так и в браузере или на Android (Capacitor).

---

## 📚 Документация

* 🗺️ **[Карта документации](project_docs/DOCS_MAP.md)**: Полная структура всей технической документации проекта.
* 🏛️ **[Обзор архитектуры](project_docs/OVERVIEW.md)**: Архитектурные принципы, стек и взаимодействие модулей.
* 🧠 **[Алгоритм интервальных повторений (SRS)](project_docs/ARCHITECTURE/SRS_SYSTEM.md)**: Математика очередей, интервалы и шкала SM-2.
* 🗄️ **[База данных и облачное хранилище](project_docs/ARCHITECTURE/DATABASE_AND_STORAGE.md)**: Схема таблиц Supabase PostgreSQL и медиа-хранилище.
* 📘 **[Руководство пользователя](docs/USER_MANUAL.md)**: Подробное описание всех экранов, тренажеров и настроек.

---

## 🏗️ Стек технологий

* **Frontend (`/app`)**: React 19, Vite, Zustand, Dexie.js (IndexedDB для офлайна), Framer Motion, Lucide React.
* **Backend (`/api`)**: Python FastAPI, Peewee ORM, Supabase PostgreSQL, edge-tts (синтез речи), python-telegram-bot.
* **Mobile (`/android`)**: Capacitor 8 (сборка под Android).
* **CLI & Утилиты (`/tools`)**: Классификатор уровней CEFR, утилиты резервного копирования, локальная консоль администратора.

---

## 🚀 Быстрый запуск

### Вариант A: Готовые скрипты запуска (Windows)
* **`clean_run.bat`**: Очищает порты 8001 и 5173 и запускает API и Frontend в режиме разработки.
* **`run_dev.bat` / `run_cloud.bat`**: Запуск с локальной или облачной базой данных.
* **`run_admin.bat`**: Запуск локальной консоли администратора (порт 8002).

### Вариант B: Ручной запуск

#### 1. Backend (FastAPI, порт 8001)
```bash
# Из корня проекта с активным venv:
pip install -r api/requirements.txt
python -m uvicorn api.main:app --port 8001 --reload
```
Бэкенд доступен по адресу: `http://localhost:8001`.

#### 2. Frontend (React / Vite, порт 5173)
```bash
cd app
npm install
npm run dev
```
Фронтенд доступен по адресу: `http://localhost:5173`.

Прямая ссылка для тестирования в браузере:
`http://localhost:5173/?user_id=642478257`

---

## 📱 Сборка под Android (Capacitor)

Для синхронизации веб-сборки с проектом Android Studio:
```bash
npm run build:android
```
Или вручную:
```bash
cd app && npm run build && cd ..
npx cap sync android
npx cap open android
```

---

## 🌐 Доступ с телефона (по локальной сети Wi-Fi)

1. Узнайте свой локальный IP-адрес:
   * В командной строке введите `ipconfig` и найдите `IPv4 Address` (например, `192.168.1.50`).
2. Откройте в браузере телефона:
   `http://192.168.1.50:5173/?user_id=ВАШ_ID`
   *(Компьютер и телефон должны быть подключены к одной Wi-Fi сети).*
