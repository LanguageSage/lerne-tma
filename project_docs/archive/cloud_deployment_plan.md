# План миграции TMA в облако (Supabase + Render/Vercel)

Этот документ описывает стратегию переноса Telegram Mini App (TMA) с локальных SQLite баз данных на полноценную облачную архитектуру с бесплатным хостингом.

## 1. Стек технологий
- **База данных**: Supabase (PostgreSQL) — бесплатный уровень.
- **Хранилище файлов**: Supabase Storage (Buckets) — для озвучки и изображений.
- **Бэкенд**: Render.com (FastAPI) — бесплатный уровень (Web Service).
- **Фронтенд**: Vercel.com (React/Vite) — бесплатный уровень.

---

## 2. Подготовительные действия (User Check-list)

> [!IMPORTANT]
> **Регистрация в Supabase**:
> 1. Создайте проект на [supabase.com](https://supabase.com).
> 2. В разделе **Settings -> Database** скопируйте `Connection String` (URI).
> 3. В разделе **Settings -> API** скопируйте `Project URL` и `service_role` key.
> 4. В разделе **Storage** создайте публичный бакет с именем `tma-audio`.

---

## 3. Технические изменения в коде

### А. База данных (api/models.py)
Необходимо реализовать динамическое переключение:
```python
if os.environ.get("SUPABASE_DB_URL"):
    database = PostgresqlDatabase(os.environ.get("SUPABASE_DB_URL"))
else:
    database = SqliteDatabase("tma.db")
```
*Важно: Удалить SQLite-прагмы (WAL mode) при работе с Postgres.*

### Б. Хранение аудио (api/utils/audio.py)
Интеграция с Supabase SDK:
1. Генерация аудио через `edge-tts` во временный файл.
2. Загрузка в бакет: `supabase.storage.from_('tma-audio').upload(path, file)`.
3. Сохранение в БД публичной ссылки вместо локального пути.

---

## 4. Файлы конфигурации для деплоя

### app/vercel.json
```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "https://your-backend-url.onrender.com/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

### render.yaml (Blueprint)
```yaml
services:
  - type: web
    name: lerne-tma-api
    env: python
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn api.main:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: SUPABASE_DB_URL
        fromConfig: ...
```

---

## 5. План миграции данных
Будет создан скрипт `scripts/migrate_to_cloud.py`, который:
1. Подключится к локальным `tma.db` и `lerne.db`.
2. Считает все записи.
3. Пакетно вставит их в соответствующие таблицы в Supabase Postgres.

---

## 6. Как вернуться к этой задаче
Когда вы будете готовы, просто напишите: **"Начинаем миграцию в облако по плану"**, и я приступлю к установке зависимостей и изменению кода.
