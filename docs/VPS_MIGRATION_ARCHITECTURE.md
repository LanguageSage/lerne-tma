# Архитектура собственного VPS для Lerne TMA и Lerne Admin
## Практический план перехода с Vercel и Supabase на арендованный сервер (Задача A2)

> **Статус документа:** Аналитико-архитектурный проект (Ready for Review).  
> **Ограничение:** Не затрагивает рабочий код, схему БД и зависимости. Не инициирует аренду сервера. Не пересекается с параллельной веткой оптимизации БД (`c1-worktree`).

---

## 1. Введение и цели архитектурного анализа

Проект **Lerne** состоит из двух ключевых компонентов:
1. **Lerne TMA (Telegram Mini App)**: клиентское React 18 SPA (Vite) и серверный бэкенд на FastAPI (Python 3.12), в настоящее время размещенные на **Vercel** (Serverless Functions) и использующие **Supabase** (управляемый PostgreSQL 17 + Supabase Storage для медиафайлов).
2. **Lerne Admin**: независимая десктопная панель управления (`lerne-admin`), работающая в локальном защищенном контуре (loopback `127.0.0.1:8050`) и взаимодействующая с базой данных PostgreSQL напрямую через строку подключения и с медиа-хранилищем через REST API.

### Мотивация переезда
Текущий стек Vercel + Supabase обеспечивает быстрый старт, однако сопряжен со следующими архитектурными и эксплуатационными ограничениями:
- **Serverless-ограничения Vercel**: эфемерный жизненный цикл функций (холодные старты 1.5–4.5 с), жесткие таймауты выполнения (10–60 с), невозможность гарантированного выполнения длительных фоновых задач (см. `docs/VERCEL_BACKGROUND_RELIABILITY.md`), сброс in-memory кэша (`MediaMemoryCache`) при перезапуске контейнеров функции.
- **Ограничения пула соединений Supabase**: использование Supavisor и PgBouncer с ограничениями одновременных транзакций, накладные расходы на внешние сетевые вызовы между Vercel (AWS) и Supabase (AWS/GCP).
- **Поверхность атаки BaaS**: для предотвращения несанкционированного доступа через публичный PostgREST Data API потребовался масштабный аудит и включение deny-all RLS на всех 39 таблицах (см. `security/supabase/README.md`).
- **Непрозрачное и потенциально высокое масштабирование затрат**: платные тарифы Vercel Pro ($20/мес/пользователь) и Supabase Pro ($25/мес + плата за compute и egress) делают инфраструктуру неоправданно дорогой при росте аудитории.

### Цель анализа
Разработать надежный, бережливый (lean) и воспроизводимый архитектурный план возможного переноса Lerne TMA на собственный VPS с минимальными расходами (от ~€4/мес), высокой стабильностью и полной автономностью.

---

## 2. Анализ существующей архитектуры и зависимостей

```mermaid
flowchart TD
    subgraph Clients["Клиентские платформы"]
        TG["Telegram Mini App (iOS / Android / Desktop)"]
        Browser["Обычный Web Browser"]
        Capacitor["Android APK (Capacitor WebView)"]
        AdminDesk["Lerne Admin (Desktop localhost:8050)"]
    end

    subgraph Vercel["Vercel Cloud (Current)"]
        VStatic["Static CDN (React 18 SPA / Vite)"]
        VPython["Serverless Python (@vercel/python)\nFastAPI / api/index.py"]
    end

    subgraph Supabase["Supabase Cloud (Current)"]
        SupaPG["PostgreSQL 17.6 (public schema, 39 tables, RLS deny-all)"]
        SupaPool["Supavisor / PgBouncer"]
        SupaStorage["Supabase Storage REST API (audio & images buckets)"]
    end

    subgraph ClientStorage["Клиентское хранилище"]
        Dexie["Dexie (IndexedDB)\nOffline-first entities & sync queue"]
        TGStorage["Telegram CloudStorage"]
        LocalStore["LocalStorage"]
    end

    TG --> VStatic
    Browser --> VStatic
    Capacitor --> VStatic
    
    TG --> ClientStorage
    
    VStatic -->|REST API /api/*| VPython
    VPython -->|Peewee ORM / SSL TCP:5432| SupaPool --> SupaPG
    VPython -->|REST API Upload/Verify| SupaStorage
    
    AdminDesk -->|Прямой TCP:5432| SupaPool
    AdminDesk -->|REST API Storage| SupaStorage
    
    TG -.->|Прямой аудио-стриминг CDN| SupaStorage
```

### 2.1. Данные и потоки Lerne TMA
- **Клиент**: React 18, Zustand, Dexie.js (IndexedDB). Мутации производятся сначала в локальной БД Dexie, а затем синхронизируются пачками через `/api/sync/v2/*` и `/api/knowledge/attempts/sync`.
- **Сервер**: FastAPI (`api/main.py`), Peewee ORM (`api/models.py`, `api/database.py`).
- **БД**: 39 таблиц в схеме `public`. Все таблицы являются серверными. Прямой доступ клиентов через Supabase Data API запрещен (RLS без политик, права отозваны).
- **Медиа**: 
  - Аудио генерируется на сервере через Microsoft Edge TTS (`api/routers/media.py`, `api/utils/audio.py`), загружается в Supabase Storage бакет `audio`, клиент воспроизводит его по прямому CDN URL (`https://wdopyuulhiykrextyvnt.supabase.co/storage/v1/object/public/audio/{filename}`).
  - Изображения загружаются через `/api/media/upload-image`, оптимизируются в WebP и сохраняются в бакет `images` или BLOB в таблице `tma_media`.

### 2.2. Аутентификация (Auth v2)
Lerne **не использует** Supabase Auth (`auth.users`, Supabase JWT, `auth.uid()`).  
Вся аутентификация полностью автономна и реализована внутри FastAPI:
- Telegram Mini App: валидация криптографической подписи HMAC-SHA256 входящего `initData` с использованием секретного ключа бота (`BOT_TOKEN`).
- Google OAuth: серверная проверка Google ID Token библиотекой `google-auth`.
- Сессии: генерация 256-битных криптографических токенов (хранятся в виде SHA-256 хэшей в таблице `tma_auth_token`), ротация refresh-токенов, валидация через заголовок `Authorization: Bearer <token>`.
- **Вывод для миграции**: переезд с Supabase **не затрагивает** логику и таблицы авторизации.

### 2.3. Lerne Admin
- Независимый проект (`C:\121\Lerne_projekt\lerne-admin`), запускается локально на рабочей станции оператора.
- Взаимодействует с БД через переменную окружения `SUPABASE_DB_URL` (любая стандартная строка подключения PostgreSQL).
- Содержит готовый модуль полного резервного копирования и восстановления (`Backup/Restore БД`), который создает единый архив `full-db-<UUID>.zip`, включающий:
  - Custom-format дамп схемы и данных PostgreSQL (`pg_dump -Fc`).
  - Все объекты медиа-хранилища (`audio` и `images`).
  - Манифест целостности с контрольными суммами SHA-256 каждого файла.
- **Вывод для миграции**: Lerne Admin готов к работе с любой PostgreSQL БД и не требует публичного размещения в интернете.

---

## 3. Сравнение двух сценариев миграции

### Сценарий 1: Перенос только PostgreSQL на VPS (Гибридный)
В этом сценарии на VPS переносится только база данных PostgreSQL. Фронтенд и бэкенд FastAPI остаются на Vercel, медиа — в Supabase Storage.

```mermaid
flowchart LR
    User([Пользователь]) --> Vercel[Vercel: Frontend + Serverless FastAPI]
    Vercel -->|Трансатлантический / WAN TCP:5432| VPS_DB[(PostgreSQL 17 на VPS)]
    Vercel --> SupaStorage[Supabase Storage]
```

- **Плюсы**:
  - Быстрый первый шаг (не нужно настраивать веб-сервер и деплой фронтенда/бэкенда на VPS).
  - Сохранение текущего пайплайна Vercel git-deploy.
- **Критические минусы и риски**:
  - **Колоссальная сетевая задержка (Cross-Cloud Latency)**: функции Vercel выполняются в дата-центрах AWS (например, `iad1` Вашингтон или `fra1` Франкфурт). Каждый SQL-запрос через открытый интернет добавляет 30–80 мс. При инициализации приложения (`/api/init`) или сложных синхронизациях выполняется 5–15 последовательных запросов, что приведет к задержке 0.5–1.5 секунды только на сеть!
  - **Угроза безопасности**: порт 5432 PostgreSQL на VPS должен быть открыт в публичный интернет (поскольку Vercel не имеет фиксированных исходящих IP-адресов на бесплатных тарифах), что требует сложной настройки TLS-сертификатов клиента или VPN.
  - **Сохранение проблем Vercel**: обрывы фоновых задач (`BackgroundTasks`), холодные старты и лимиты таймаутов остаются.

### Сценарий 2: Полный отказ от Supabase и Vercel (All-in-One VPS) — **Целевой**
Все компоненты (PostgreSQL 17, FastAPI Uvicorn, React SPA, локальное медиа-хранилище и Caddy/Nginx) разворачиваются на одном арендованном сервере в Docker Compose.

```mermaid
flowchart LR
    User([Пользователь / TMA]) -->|HTTPS 443| Caddy[Caddy Reverse Proxy + Static Files]
    Caddy -->|/api/*| FastAPI[FastAPI (Uvicorn Workers)]
    Caddy -->|/media/*| MediaFiles[Local Media Volume]
    FastAPI -->|Local Docker Network: <0.3ms| PG[(PostgreSQL 17)]
    FastAPI --> MediaFiles
    Admin[Lerne Admin] -.->|SSH Tunnel: 5432| PG
```

- **Плюсы**:
  - **Минимальная задержка**: обмен между FastAPI и PostgreSQL происходит по локальной сети Docker bridge / loopback с задержкой **< 0.3 мс** (в 100–300 раз быстрее, чем между облаками).
  - **Надежность фоновых задач**: долгоживущий процесс FastAPI гарантирует корректную работу `BackgroundTasks` (генерация аудио, AI-классификация, отложенная обработка) без риска принудительного убийства контейнера Vercel.
  - **Постоянный кэш в памяти**: `MediaMemoryCache` сохраняет горячие файлы в RAM между запросами.
  - **Абсолютная безопасность БД**: порт 5432 привязан строго к `127.0.0.1` или внутренней сети Docker. Никакого доступа из публичного интернета.
  - **Нулевая зависимость от вендоров**: предсказуемые расходы, независимость от тарифной политики Supabase и Vercel.
- **Минусы**:
  - Необходимость самостоятельного контроля обновлений ОС, фаервола и автоматического резервного копирования.

### Сравнительная матрица вариантов

| Критерий | Текущее (Vercel + Supabase) | Сценарий 1 (DB на VPS) | Сценарий 2 (All-in-One VPS) |
| :--- | :--- | :--- | :--- |
| **Задержка API $\to$ DB** | 10–35 мс (внутри AWS) | **40–120 мс (высокая, WAN)** | **< 0.5 мс (экстремально низкая)** |
| **Холодные старты** | Да (1.5–4.5 сек) | Да (1.5–4.5 сек) | **Нет (0 мс, постоянные воркеры)** |
| **Фоновые задачи (TTS, AI)** | Ненадежно (риск обрыва) | Ненадежно (риск обрыва) | **Полностью надежно** |
| **Безопасность порта БД** | Защита через Supavisor + RLS | Требует открытия 5432 наружу | **Полная изоляция (Loopback/Docker)** |
| **Сложность обслуживания** | Минимальная (SaaS) | Высокая (двойная среда) | **Умеренная (Docker Compose)** |
| **Ежемесячные расходы** | $0–$45/мес (с рисками скачков) | €4 + $0–$25/мес | **€3.80 – €7/мес (фиксировано)** |
| **Рекомендация** | Временная среда разработки | **Не рекомендуется** | **Рекомендуется как целевое решение** |

---

## 4. Целевая архитектура VPS (Scenario 2: All-in-One)

### 4.1. Схема целевой архитектуры

```mermaid
flowchart TD
    subgraph Internet["Внешний контур (Интернет)"]
        ClientApp["Клиент (Telegram Mini App / Browser / Android APK)"]
        TGServer["Серверы Telegram (Webhook / Bot API)"]
        Operator["Оператор (Lerne Admin Desktop)"]
    end

    subgraph VPS["Арендованный VPS (Ubuntu 24.04 LTS / Debian 12)"]
        subgraph Perimeter["Сетевой периметр (UFW Firewall)"]
            Port443["Порт 443 (HTTPS TLS)"]
            Port80["Порт 80 (HTTP -> HTTPS Redirect)"]
            PortSSH["Порт 2222 (SSH Key-Only, non-standard)"]
        end

        subgraph DockerCompose["Docker Compose изолированная сеть (lerne-net)"]
            Caddy["Caddy Web Server / Reverse Proxy\n- Автоматический Let's Encrypt TLS\n- HTTP/2 & HTTP/3\n- Раздача статики React SPA (/app/dist)\n- Раздача медиафайлов (/data/media)"]
            
            Backend["FastAPI App (Gunicorn + Uvicorn Workers)\n- Python 3.12, 2 воркера\n- Auth v2, Sync, SRS, Study\n- Встроенный Background Worker"]
            
            DB[("PostgreSQL 17-bookworm\n- Tuning под RAM сервера\n- UTF-8, pg_trgm\n- Порт 5432 ТОЛЬКО внутри lerne-net")]
            
            BackupCron["Контейнер / Systemd Backup Runner\n- Ежедневный pg_dump -Fc\n- Бэкап медиафайлов\n- Шифрование и выгрузка во внешнее хранилище"]
        end

        subgraph HostStorage["Дисковая подсистема хоста (/opt/lerne/)"]
            V_PG["/opt/lerne/data/postgres/ (Том БД)"]
            V_Media["/opt/lerne/data/media/ (Аудио и изображения)"]
            V_Backups["/opt/lerne/backups/ (Локальные резервные копии)"]
        end
    end

    subgraph Offsite["Внешнее хранилище резервных копий"]
        CloudStorage["S3 / Backblaze B2 / Hetzner Storage Box"]
    end

    ClientApp -->|HTTPS:443| Port443 --> Caddy
    TGServer -->|Webhook POST /api/bot/webhook| Port443 --> Caddy
    Operator -->|SSH Tunnel: localhost:5432 -> 127.0.0.1:5432| PortSSH
    PortSSH -.-> DB

    Caddy -->|/index.html & /assets/*| VStaticFiles["Встроенные статические файлы"]
    Caddy -->|/media/* (direct stream)| V_Media
    Caddy -->|/api/* (proxy_pass)| Backend
    
    Backend -->|Peewee Pool / TCP:5432| DB
    Backend -->|Чтение и запись медиа| V_Media
    
    DB --> V_PG
    BackupCron -->|pg_dump| DB
    BackupCron -->|Копирование| V_Media
    BackupCron -->|Архив| V_Backups
    BackupCron -->|Ежесуточная отправка| CloudStorage
```

### 4.2. Сетевая топология и изоляция
1. **Порты наружу**:
   - `80/tcp` (HTTP) — автоматический редирект на HTTPS и ACME HTTP-01 challenge.
   - `443/tcp` (HTTPS) — основной защищенный трафик (TLS 1.2 / 1.3).
   - `22/tcp` (или нестандартный порт, например `2222/tcp`) — SSH доступ, **только по ключам Ed25519** (`PasswordAuthentication no`, `PermitRootLogin no`).
2. **Изоляция базы данных**:
   - Порт `5432` **не публикуется** в интерфейсе `0.0.0.0`.
   - В `compose.yaml` отсутствует секция `ports: - "5432:5432"`. Контейнер доступен исключительно внутри внутренней Docker-сети `lerne-net`.
   - Для подключения локальной `lerne-admin` с компьютера администратора используется SSH-туннель:
     ```powershell
     ssh -N -L 5432:postgres:5432 -p 2222 lerne_admin@vps.example.com
     ```
     После поднятия туннеля `lerne-admin` подключается к `localhost:5432` абсолютно безопасно.

---

## 5. Детальная спецификация компонентов

### 5.1. База данных PostgreSQL 17 на собственном VPS
- **Образ**: официальный `postgres:17-bookworm`.
- **Кодировка и локаль**: `C.UTF-8` или `en_US.UTF-8`, `LC_COLLATE = C`, `LC_CTYPE = C.UTF-8`.
- **Необходимые расширения**: `pg_trgm` (быстрый полнотекстовый поиск по карточкам), `btree_gist`, `unaccent`.
- **Конфигурационный профиль (для VPS с 4 ГБ RAM)**:
  ```ini
  # /etc/postgresql/postgresql.conf
  max_connections = 50
  shared_buffers = 1GB                  # 25% от общей RAM
  effective_cache_size = 3GB            # 75% от общей RAM
  maintenance_work_mem = 256MB
  work_mem = 16MB                       # shared_buffers / max_connections
  checkpoint_completion_target = 0.9
  wal_buffers = 16MB
  default_statistics_target = 100
  random_page_cost = 1.1                # Для NVMe SSD
  effective_io_concurrency = 200        # Для NVMe SSD
  autovacuum = on
  autovacuum_max_workers = 3
  autovacuum_naptime = 1min
  autovacuum_vacuum_scale_factor = 0.1
  autovacuum_analyze_scale_factor = 0.05
  ```
- **Управление подключениями**:
  - Поскольку воркеры FastAPI являются постоянными долгоживущими процессами (в отличие от Vercel serverless), Peewee использует встроенный `PooledPostgresqlDatabase` (драйвер `psycopg2`).
  - 2 воркера FastAPI $\times$ пул из 10 соединений = максимум 20 соединений к БД. Это устраняет необходимость в дополнительном PgBouncer на начальном этапе.

### 5.2. Бэкенд FastAPI и фронтенд React
- **Веб-сервер / Reverse Proxy**: **Caddy 2** (рекомендуется) или **Nginx**.
  - *Преимущество Caddy*: автоматический выпуск и продление сертификатов Let's Encrypt / ZeroSSL «из коробки», встроенный HTTP/3 (QUIC), лаконичный конфигурационный файл без сторонних демонов `certbot`.
- **Frontend SPA**:
  - Собирается на этапе CI/CD (или локально перед деплоем) командой `npm run build` в каталог `dist/`.
  - Раздается веб-сервером как статика.
  - Ассеты (`/assets/*`) отдаются с заголовком:  
    `Cache-Control: public, max-age=31536000, immutable`
  - Файл `index.html` отдается с заголовком:  
    `Cache-Control: no-cache, no-store, must-revalidate` (для мгновенного обновления версий).
  - Настроен SPA fallback: любые ненайденные пути перенаправляются на `/index.html`.
- **Backend FastAPI**:
  - Запускается внутри контейнера через менеджер процессов Gunicorn с Uvicorn-воркерами:
    ```bash
    gunicorn api.main:app \
      --workers 2 \
      --worker-class uvicorn.workers.UvicornWorker \
      --bind 0.0.0.0:8000 \
      --timeout 120 \
      --graceful-timeout 30 \
      --access-logfile - \
      --error-logfile -
    ```
  - **Стриминг аудио**: для стабильного воспроизведения в iOS Safari / Telegram WebApp веб-сервер и FastAPI корректно поддерживают заголовок `Accept-Ranges: bytes` и HTTP 206 Partial Content. Буферизация прокси для медиа-путей отключается.
- **Telegram Bot Webhook и Cron**:
  - Эндпоинт `/api/bot/webhook` получает обновления напрямую от Telegram через публичный HTTPS.
  - Напоминания об учебе (`/api/bot/send-reminders`) вызываются регулярным cron-заданием на самом VPS (через локальный `curl` к `http://127.0.0.1:8000`), без зависимости от внешних бесплатных планировщиков.

### 5.3. Хранение изображений, аудио и резервных копий
- **Хранение на диске**:
  - Структура каталогов:
    - `/opt/lerne/data/media/audio/` — аудиофайлы произношений (`.mp3`).
    - `/opt/lerne/data/media/images/` — сжатые карточные иллюстрации (`.webp`).
  - Раздача медиа: запросы на чтение (`GET /media/audio/*` и `GET /media/images/*`) обрабатываются **напрямую веб-сервером Caddy/Nginx**, минуя интерпретатор Python! Это снижает нагрузку на CPU бэкенда до нуля при прослушивании аудио.
  - Генерация медиа: FastAPI генерирует файлы через Edge TTS и сохраняет их напрямую в `/opt/lerne/data/media/audio/{filename}`.
- **Политика резервного копирования (Правило 3-2-1)**:
  1. **Локальный снапшот БД**: ежедневный запуск `pg_dump -Fc` в сжатом бинарном формате. Хранение последних 7 дней локально.
  2. **Локальный архив медиа**: инкрементальная синхронизация медиафайлов.
  3. **Шифрованная выгрузка во внешнее хранилище (Offsite Backup)**:
     - Использование утилиты `restic` или `rclone` с шифрованием на стороне клиента.
     - Целевое хранилище: S3-совместимое объектное хранилище (Hetzner Storage Box €3.80/1TB, Cloudflare R2, Backblaze B2 $0.006/GB или Яндекс.Облако).
     - Срок хранения: 7 ежедневных копий, 4 еженедельных, 6 месячных.
  4. **Совместимость с Lerne Admin**: локальный бэкап можно в любой момент выгрузить через существующий интерфейс Lerne Admin в формате `full-db-<UUID>.zip` для локального аудита или аварийного восстановления на рабочей станции.

### 5.4. Авторизация, безопасность, TLS, RLS и управление секретами
- **Аутентификация (Auth v2)**:
  - Никаких изменений в коде не требуется. Проверка HMAC Telegram `initData` и Google Token Verification работает штатно.
- **Row Level Security (RLS)**:
  - *Контекст*: в Supabase включение RLS было критически необходимо, так как PostgREST выставлял таблицы в публичный доступ.
  - *На собственном VPS*: база данных скрыта за внутренним сетевым экраном Docker. Публичный доступ к порту 5432 отсутствует. Все запросы выполняются исключительно через доверенный бэкенд FastAPI под выделенной ролью БД `lerne_app`.
  - *Рекомендация*: сохранить включенный RLS со встроенным правом `BYPASSRLS` для служебного пользователя `lerne_app` (принцип defense-in-depth). Это исключит риски регрессий и сохранит совместимость со скриптами миграций.
- **TLS и безопасность периметра**:
  - Автоматические сертификаты Let's Encrypt (ECDSA P-256).
  - Принудительный HSTS (`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`).
  - Политика заголовков безопасности: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. Заголовок `X-Frame-Options` конфигурируется так, чтобы разрешать встраивание во фрейм Telegram (`https://web.telegram.org`).
- **Управление секретами**:
  - Файл конфигурации окружения `.env.production` размещается на хосте по пути `/opt/lerne/.env.production`.
  - Права доступа жестко ограничены: `chmod 600 /opt/lerne/.env.production`, владелец — системный пользователь `lerne`.
  - Секреты никогда не коммитятся в git-репозиторий.

---

## 6. Минимальная конфигурация сервера и масштабирование

### 6.1. Минимальные системные требования (MVP / Production Starter)
Для обслуживания базы данных, бэкенда, раздачи статики и медиафайлов до **5 000 – 10 000 активных пользователей в сутки** (DAU) достаточен виртуальный сервер следующей конфигурации:

| Параметр | Минимально (2 ГБ RAM) | Рекомендуемо (4 ГБ RAM) |
| :--- | :--- | :--- |
| **vCPU** | 2 ядра (x86_64 или ARM64) | 2–3 ядра (x86_64 или ARM64) |
| **RAM** | 2 ГБ | 4 ГБ |
| **Диск** | 40 ГБ NVMe SSD | 50–80 ГБ NVMe SSD |
| **Трафик** | от 1 ТБ / месяц | от 2 ТБ / месяц |
| **Пример провайдера** | Hetzner Cloud CX22 (~€3.79/мес) / CAX11 ARM (~€3.29/мес) | Hetzner Cloud CPX21 (~€7.00/мес) / Netcup VPS 1000 (~€5.50/мес) |

### 6.2. Распределение оперативной памяти на сервере (4 ГБ RAM)
- **PostgreSQL 17** (`shared_buffers` + соединения + кэш запросов): **~1.2 ГБ**
- **FastAPI Backend** (2 воркера Uvicorn по ~150 МБ): **~300–400 МБ**
- **Caddy Web Server**: **~50 МБ**
- **Системные службы Linux / Docker**: **~300 МБ**
- **Дисковый кэш ОС (Page Cache)** для быстрого чтения медиа: **~1.5 ГБ**
- **Свободный резерв под пиковые нагрузки**: **~500 МБ**

### 6.3. Дорожная карта дальнейшего масштабирования
1. **Этап 1 (Вертикальное масштабирование, до 25 000 DAU)**:
   - Апгрейд тарифа VPS до 4 vCPU / 8 ГБ RAM (~€12–15/мес).
   - Увеличение числа воркеров Uvicorn до 4.
   - Увеличение `shared_buffers` PostgreSQL до 2 ГБ.
2. **Этап 2 (Вынос медиа в объектное хранилище, от 25 000 DAU)**:
   - Подключение Cloudflare R2 для отдачи медиа ($0 за исходящий трафик).
   - Диск VPS освобождается от аудио и картинок, VPS занимается только вычислениями и базой.
3. **Этап 3 (Разделение сервисов / Horizontal Scaling, от 50 000 DAU)**:
   - Сервер 1: Reverse Proxy (Caddy) + FastAPI Cluster.
   - Сервер 2: Выделенный PostgreSQL сервер с репликацией (Master-Replica).

---

## 7. Финансовое сравнение и оценка рисков (TCO Analysis)

### 7.1. Сравнение ежемесячных расходов

| Статья расходов | Текущая модель (Vercel + Supabase) | Сценарий 2: Собственный VPS |
| :--- | :--- | :--- |
| **Хостинг приложения и статики** | $0 (Free) или $20/мес (Vercel Pro) | Включено в VPS (€0) |
| **База данных PostgreSQL** | $0 (Free) или $25/мес (Supabase Pro) | Включено в VPS (€0) |
| **Хранилище медиа и Egress** | Включено в квоты Supabase (риск перерасхода) | Включено в диск VPS (или €0.5 Cloudflare R2) |
| **Аренда сервера (Hetzner / Netcup)** | $0 | **€3.80 – €7.00 / месяц** |
| **Внешний бэкап (Offsite Backup)** | $0 (ручные снапшоты) | **~€1.00 / месяц** (Backblaze B2 / R2) |
| **ИТОГО в месяц** | **$0 – $45+ / месяц** | **~€5 – €8 / месяц (~500–800 руб)** |

### 7.2. Оценка рисков и меры смягчения

| Риск | Вероятность | Влияние | Мера предотвращения и смягчения |
| :--- | :---: | :---: | :--- |
| **Аппаратный сбой сервера провайдера** | Низкая | Высокое | Ежедневные бэкапы во внешнее хранилище. Восстановление на новом VPS за 20–30 минут по Playbook. |
| **Переполнение диска логами или медиа** | Средняя | Высокое | Docker log-rotation (`max-size: 10m`, `max-file: 3`), мониторинг свободного места через Uptime Kuma / healthcheck. |
| **DDoS или всплеск трафика** | Средняя | Среднее | Подключение бесплатного Cloudflare Proxy перед VPS (проксирование DNS, защита от ботов и атак). |
| **Ошибочный релиз / повреждение БД** | Средняя | Высокое | Транзакционные миграции, обязательный автоматический `pg_dump` перед деплоем, готовый скрипт rollback. |
| **Утечка секретов** | Низкая | Критическое | Файл `.env.production` имеет права `600`, SSH только по ключам, порт БД закрыт для внешнего мира. |

---

## 8. Пошаговый план миграции (Phased Migration Plan)

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Архитектор / Dev
    participant Supa as Supabase (Old DB)
    participant VPS as Новый VPS (Docker)
    participant DNS as DNS / Telegram Bot API
    actor Users as Пользователи (TMA)

    Note over Dev,VPS: Фаза 0: Подготовка хоста и окружения
    Dev->>VPS: Настройка ОС, UFW, Docker, Caddy, развертывание контейнеров
    Dev->>VPS: Проверка тестового подключения и SSL сертификатов

    Note over Dev,VPS: Фаза 1: Теневая выгрузка и первичное наполнение
    Dev->>Supa: Создание базового дампа (pg_dump -Fc) и экспорт медиа
    Dev->>VPS: Импорт дампа в локальный PostgreSQL, копирование медиа
    Dev->>VPS: Smoke-тестирование API через curl / staging хост

    Note over Dev,Users: Фаза 2: Окно обслуживания и переключение (Downtime: 5-10 мин)
    Dev->>Users: Включение режима техобслуживания (Maintenance Screen)
    Dev->>Supa: Финальный инкрементальный дамп (дельта новых записей)
    Dev->>VPS: Накатывание финальной дельты в PostgreSQL на VPS
    Dev->>DNS: Переключение A-записи домена на IP адрес VPS
    Dev->>TGServer: Обновление Telegram Bot Webhook URL на новый сервер
    Dev->>Users: Отключение режима обслуживания, открытие трафика

    Note over Dev,VPS: Фаза 3: Верификация и стабилизация
    Users->>VPS: Запросы идут на новый сервер (<0.5ms DB latency)
    Dev->>VPS: Мониторинг логов, метрик и успешности фоновых задач
    Dev->>Supa: Перевод старой БД в read-only (сохранение на 14 дней)
```

### Фаза 0: Подготовка инфраструктуры (за 2–3 дня до миграции)
1. Аренда VPS (например, Hetzner CX22 / CPX21, регион Falkenstein/Helsinki или эквивалент).
2. Базовая настройка ОС (Ubuntu 24.04 LTS):
   - Создание пользователя `deploy` с sudo-правами.
   - Настройка SSH-доступа по Ed25519 ключу, отключение авторизации по паролю.
   - Настройка UFW: `ufw allow 80/tcp`, `ufw allow 443/tcp`, `ufw allow 22/tcp`, `ufw enable`.
   - Установка Docker Engine и Docker Compose V2.
3. Развертывание каталога `/opt/lerne/` с production compose-файлом и генерация надежных паролей для PostgreSQL.

### Фаза 1: Теневое развертывание и предварительный перенос данных
1. Выгрузка текущего дампа базы данных из Supabase:
   ```bash
   pg_dump "$SUPABASE_DB_URL" -Fc -v -f /tmp/lerne_pre_migration.dump
   ```
2. Выгрузка медиафайлов из Supabase Storage через утилиту или скрипт `scripts/migrate_images_to_storage.py` (или через Backup/Restore в Lerne Admin).
3. Восстановление дампа в PostgreSQL на VPS:
   ```bash
   docker compose exec -T postgres pg_restore -U lerne_app -d lerne_production --no-owner --no-acl /tmp/lerne_pre_migration.dump
   ```
4. Сборка фронтенда и запуск бэкенда на staging-поддомене (например, `stage.lerne.app`).
5. Проверка работоспособности: авторизация, загрузка карточек, генерация TTS.

### Фаза 2: Окно переключения (Maintenance Window, 5–10 минут)
1. Выбор наименее активного времени (обычно 03:00–04:00 утра UTC).
2. Выставление временной страницы-заглушки (HTTP 503 Maintenance) на Vercel.
3. Снятие финального дельта-дампа из Supabase (только изменившиеся строки за последние дни или полный быстрый дамп).
4. Импорт дельты в целевую базу на VPS.
5. Переключение DNS-записей (A-запись основного домена переводится на IP нового VPS). Значение TTL рекомендуется заранее уменьшить до 300 секунд (5 минут).
6. Перерегистрация вебхука Telegram бота:
   ```bash
   curl -F "url=https://api.lerne.app/api/bot/webhook" \
        -F "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
        https://api.telegram.org/bot$BOT_TOKEN/setWebhook
   ```
7. Снятие режима обслуживания.

### Фаза 3: Постмиграционный контроль и вывод из эксплуатации
1. Мониторинг логов контейнеров в реальном времени (`docker compose logs -f`).
2. Проверка прохождения запросов от мобильных клиентов Telegram Mini App и Android APK.
3. Проверка подключения локальной консоли Lerne Admin через SSH-туннель.
4. Хранение старой базы данных Supabase и аккаунта Vercel в замороженном (read-only) состоянии в течение 14–30 дней, после чего следует полное отключение.

---

## 9. Контрольный список готовности (Go / No-Go Checklist)

### 9.1. Предмиграционный чек-лист (Pre-Migration)
- [ ] VPS арендован, ОС обновлена, системное время синхронизировано через NTP (`chrony`).
- [ ] SSH настроен: порт изменен/защищен, авторизация по паролям отключена, root-вход заблокирован.
- [ ] UFW фаервол активен: открыты только порты 80, 443 и SSH. Порт 5432 **закрыт**.
- [ ] Docker и Docker Compose установлены и запускаются без sudo.
- [ ] Создан файл `.env.production` с правами `chmod 600`, все секреты (`BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `POSTGRES_PASSWORD`, `SECRET_KEY`) заполнены уникальными значениями.
- [ ] DNS TTL основного домена снижен до 300 секунд (за 24 часа до миграции).
- [ ] Протестирован тестовый запуск `pg_dump` $\to$ `pg_restore` на VPS без ошибок.
- [ ] Скрипт автоматического бэкапа протестирован, тестовый архив успешно загружен во внешнее хранилище.

### 9.2. Чек-лист окна миграции (Cutover Window)
- [ ] Зафиксировано точное время начала окна обслуживания.
- [ ] Включен maintenance-режим на Vercel (остановка входящих записей).
- [ ] Снят финальный дамп PostgreSQL из Supabase.
- [ ] Финальный дамп успешно восстановлен на VPS: количество строк в таблицах `tma_user`, `tma_card`, `tma_deck` совпадает до единицы.
- [ ] Медиа-каталоги синхронизированы (`audio/` и `images/`).
- [ ] Контейнеры на VPS запущены, healthcheck PostgreSQL и FastAPI возвращает `healthy`.
- [ ] A-запись DNS обновлена на IP-адрес VPS.
- [ ] Telegram Webhook обновлен и возвращает `{"ok":true,"result":true}`.
- [ ] SSL-сертификат Let's Encrypt успешно получен Caddy, HTTPS-соединение валидно.

### 9.3. Постмиграционный чек-лист (Post-Migration & Verification)
- [ ] Вход в Telegram Mini App проходит успешно (проверка HMAC `initData` валидна).
- [ ] Вход через Google OAuth функционирует штатно.
- [ ] Карточки открываются, изображения отображаются, кэш Dexie синхронизируется.
- [ ] Аудио воспроизводится (проверен заголовок `Accept-Ranges: bytes` на iOS и Android).
- [ ] Генерация новой озвучки через Edge TTS создает файл на диске и возвращает валидный URL.
- [ ] Регулярное напоминание Telegram бота отправляется по расписанию.
- [ ] Lerne Admin подключается через SSH-туннель `127.0.0.1:5432`, отображает статус базы и пользователей.
- [ ] Использование RAM на сервере не превышает 70–75%.
- [ ] Логи не содержат циклических ошибок `Database connection error` или `500 Internal Server Error`.

### 9.4. Критерии отката (Rollback Trigger)
Если в течение 30 минут после переключения:
- Не удается восстановить целостность базы данных.
- SSL-сертификат не выпускается и домен недоступен.
- Критические ошибки авторизации затрагивают >5% пользователей.  
$\implies$ **Активируется план отката**: A-запись DNS возвращается на Vercel, Telegram Webhook переключается обратно на Vercel, старая база Supabase снимается с read-only.

---

## 10. Эталонные конфигурационные файлы (Production-Ready Templates)

Ниже приведены готовые шаблоны конфигураций, оптимизированные для быстрого развертывания.

### 10.1. `compose.production.yaml`
```yaml
services:
  caddy:
    image: caddy:2.8-alpine
    container_name: lerne-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp" # HTTP/3 (QUIC)
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./frontend_dist:/var/www/html:ro
      - ./data/media:/var/www/media:ro
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - lerne-net
    depends_on:
      backend:
        condition: service_healthy

  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    container_name: lerne-backend
    restart: unless-stopped
    env_file:
      - .env.production
    environment:
      - ENVIRONMENT=production
      - SUPABASE_DB_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      - MEDIA_STORAGE_PATH=/data/media
    volumes:
      - ./data/media:/data/media
    networks:
      - lerne-net
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/ping', timeout=5)"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s

  postgres:
    image: postgres:17-bookworm
    container_name: lerne-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-lerne_production}
      POSTGRES_USER: ${POSTGRES_USER:-lerne_app}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Database password required}
      PGDATA: /var/lib/postgresql/data/pgdata
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    networks:
      - lerne-net
    # ПОРТ 5432 НЕ ПУБЛИКУЕТСЯ НАРУЖУ!
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-lerne_app} -d ${POSTGRES_DB:-lerne_production}"]
      interval: 5s
      timeout: 5s
      retries: 10

networks:
  lerne-net:
    driver: bridge

volumes:
  postgres_data:
  caddy_data:
  caddy_config:
```

### 10.2. `Caddyfile`
```caddy
{
    email admin@example.com
    # Ограничение размера загрузок до 25 МБ (для изображений)
    order request_body before respond
}

lerne.example.com {
    encode zstd gzip

    # Заголовки безопасности
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-XSS-Protection "1; mode=block"
        Referrer-Policy "strict-origin-when-cross-origin"
        # Разрешаем Telegram WebApp встраивать фрейм
        Content-Security-Policy "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org;"
    }

    # 1. Прямая отдача статических медиафайлов минуя Python
    handle /media/* {
        root * /var/www
        file_server
        header {
            Cache-Control "public, max-age=2592000"
            Accept-Ranges "bytes"
        }
    }

    # 2. Проксирование API-запросов к FastAPI
    handle /api/* {
        reverse_proxy backend:8000 {
            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
            header_up Host {upstream_hostport}
            
            # Отключение буферизации для аудио-стриминга
            flush_interval -1
        }
    }

    # 3. Раздача фронтенда React SPA
    handle {
        root * /var/www/html
        try_files {path} /index.html
        file_server

        # Кэширование хэшированных ассетов Vite
        @static path /assets/*
        header @static Cache-Control "public, max-age=31536000, immutable"

        # Не кэшировать index.html
        @index path /index.html
        header @index Cache-Control "no-cache, no-store, must-revalidate"
    }
}
```

### 10.3. `Dockerfile.backend`
```dockerfile
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Установка минимальных системных библиотек для компиляции и работы с медиа
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Создание непривилегированного пользователя
RUN groupadd -g 10001 lerne && \
    useradd -u 10001 -g lerne -s /bin/bash -m lerne

# Установка Python зависимостей
COPY api/requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && \
    pip install gunicorn && \
    pip install -r requirements.txt

# Копирование исходного кода приложения
COPY api/ /app/api/
RUN chown -R lerne:lerne /app

USER lerne

EXPOSE 8000

CMD ["gunicorn", "api.main:app", \
     "--workers", "2", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--bind", "0.0.0.0:8000", \
     "--timeout", "120", \
     "--graceful-timeout", "30", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
```

### 10.4. Скрипт автоматического резервного копирования (`scripts/backup_vps.sh`)
```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/opt/lerne/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_DUMP_FILE="${BACKUP_DIR}/lerne_db_${TIMESTAMP}.dump"
MEDIA_ARCHIVE="${BACKUP_DIR}/lerne_media_${TIMESTAMP}.tar.gz"

mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Starting PostgreSQL backup..."
docker compose -f /opt/lerne/compose.production.yaml exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-lerne_app}" -d "${POSTGRES_DB:-lerne_production}" -Fc > "${DB_DUMP_FILE}"

echo "[$(date)] Archiving media files..."
tar -czf "${MEDIA_ARCHIVE}" -C /opt/lerne/data/media .

echo "[$(date)] Uploading to Offsite S3 / Storage Box..."
# Пример с использованием rclone (настроен remote 'offsite_backup')
if command -v rclone &> /dev/null; then
    rclone copy "${DB_DUMP_FILE}" offsite_backup:lerne-backups/database/
    rclone copy "${MEDIA_ARCHIVE}" offsite_backup:lerne-backups/media/
fi

echo "[$(date)] Cleaning up local backups older than 7 days..."
find "${BACKUP_DIR}" -type f -name "lerne_db_*.dump" -mtime +7 -delete
find "${BACKUP_DIR}" -type f -name "lerne_media_*.tar.gz" -mtime +7 -delete

echo "[$(date)] Backup completed successfully."
```

---

## 11. Заключение и дальнейшие шаги

1. **Техническая реализуемость**: Архитектура Lerne TMA и Lerne Admin на 100% готова к переезду на собственный VPS. Приложение не зависит от проприетарных сервисов Supabase Auth или Data API, используя стандартный PostgreSQL и собственную систему аутентификации Auth v2.
2. **Оптимальный сценарий**: Рекомендуется реализовать **Сценарий 2 (All-in-One VPS)**. Он полностью устраняет сетевую задержку между Vercel и базой данных, снимает все ограничения на длительность фоновых задач и сокращает стоимость инфраструктуры до фиксированных ~€5/месяц.
3. **Безопасность**: Полная изоляция порта 5432 внутри виртуальной сети Docker и организация доступа к консоли администратора через SSH-туннель обеспечивает уровень защищенности, превосходящий текущую облачную конфигурацию.
4. **Статус ветки**: Документ подготовлен в отдельной ветке `docs/a2-vps-architecture` в соответствии с инструкциями задачи A2 без внесения изменений в рабочий код и зависимости.
