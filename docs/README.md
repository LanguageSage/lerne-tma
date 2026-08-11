# 📚 Документация проекта Lerne TMA (Telegram Mini App)

Добро пожаловать в центральный хаб документации проекта **Lerne TMA** — независимого веб-приложения для изучения иностранных языков прямо внутри Telegram.

---

## 🗂 Структура документации

В этой папке собраны подробные документы, описывающие устройство, архитектуру и историю развития проекта:

| Файл | Описание |
| :--- | :--- |
| 🏗 [**`ARCHITECTURE.md`**](./ARCHITECTURE.md) | Полный обзор архитектуры бэкенда (FastAPI, Peewee ORM, Supabase Postgres) и фронтенда (React, Zustand, Telegram WebApp SDK). |
| 💾 [**`DATA_PERSISTENCE_AND_STORAGE.md`**](./DATA_PERSISTENCE_AND_STORAGE.md) | Описание 3-уровневой системы хранения данных (`LocalStorage` → `Telegram CloudStorage` → `Supabase DB`), авторизации и устойчивости сети. |
| 🌍 [**`MULTI_LANGUAGE_SYSTEM.md`**](./MULTI_LANGUAGE_SYSTEM.md) | Механика изоляции языковых пространств (DE 🇩🇪, EN 🇬🇧, NO 🇳🇴), разграничения колод, папок и ИИ-промптов по уровням (A1–B2). |
| 📜 [**`CHANGELOG_AND_MILESTONES.md`**](./CHANGELOG_AND_MILESTONES.md) | История ключевых вех разработки, хронология проведенных архитектурных изменений и решений. |

---

## 🚀 Краткая справка по стеку технологий

- **Backend**: Python 3.12, FastAPI, Peewee ORM, PostgreSQL (Supabase Cloud), `psycopg2-binary` / `pg8000`.
- **Frontend**: React 18, Vite, Zustand (state management), Framer Motion (3D & UI animations), Lucide React.
- **Telegram Platform**: Telegram Mini Apps SDK, Telegram CloudStorage API.
- **Deployment**: Vercel Serverless Functions (`api/index.py` & Vite production bundle).
