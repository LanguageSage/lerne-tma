# RFC: Переход Lerne к архитектуре Local-first V3

**Дата:** `2026-11-24`  
**Статус:** `DRAFT — НА УТВЕРЖДЕНИЕ ВЛАДЕЛЬЦА ПРОЕКТА (ОСТАНОВКА НА РУБЕЖЕ РАЗДЕЛА 13)`  
**Область:** `tma` (`C:\121\Lerne_projekt\tma`) + `lerne-admin` (`C:\121\Lerne_projekt\lerne-admin`)  
**Базовые документы (обязательный контекст):**
- [ANDROID_UPGRADE_AND_DATA_SAFETY.md](./ANDROID_UPGRADE_AND_DATA_SAFETY.md) — отчёт Этапа B / R3 (подпись APK, `versionCode`, `LerneStandaloneDB_900001`, матрица угроз сохранности данных, воспроизводимая процедура проверки).
- [LOCAL_FIRST_V3_AUDIT_BASELINE.md](./LOCAL_FIRST_V3_AUDIT_BASELINE.md) — отчёт Этапа C / R4 (аудит C1–C6, сквозная матрица платформ, локальный baseline на PostgreSQL 17.11 и SQLite, ранжированный список источников нагрузки).

> **Политика достоверности и согласования:** Все описания текущего состояния, путей файлов, символов и числовых замеров опираются строго на проверенный исходный код и локальные прогоны Этапов A–C. Настоящий RFC **не утверждает** архитектурные решения самостоятельно: в разделе D12 по каждому существенному вопросу представлены 2–3 реалистичных варианта с критериями и предварительной рекомендацией, а выполнение Этапов E–F останавливается на рубеже раздела D13 до явного решения владельца проекта.

---

## D1. Существующая архитектура

Текущая система состоит из единого React/Vite-клиента (`app/`), серверного FastAPI-приложения (`api/`), размещённого на Vercel поверх PostgreSQL и Object Storage в Supabase, а также локальной консоли администратора (`lerne-admin/`). Подробная верификация приведена в [LOCAL_FIRST_V3_AUDIT_BASELINE.md](./LOCAL_FIRST_V3_AUDIT_BASELINE.md) и [ANDROID_UPGRADE_AND_DATA_SAFETY.md](./ANDROID_UPGRADE_AND_DATA_SAFETY.md).

### D1.1. Клиенты: Android Offline Pilot, Web и Telegram Mini App

1. **Android (`com.lerne.offlinepilot`, `IS_STANDALONE=1`):**
   - Собирается с `VITE_LERNE_STANDALONE=1` (`package.json:17`), `namespace="com.lerne.app"`, Java `package com.lerne.app`, `applicationId="com.lerne.offlinepilot"` (`android/app/build.gradle:7-10`, `capacitor.config.json:2`), origin WebView `https://localhost`.
   - Работает в полностью изолированном офлайн-режиме (`runStandaloneBootstrap` в `app/src/pilot/standaloneBootstrap.js`, синтетический `STANDALONE_USER_ID = 900001`, БД `LerneStandaloneDB_900001`, перехватчик `networkApi.js:80-84` с ошибкой `ERR_STANDALONE_OFFLINE`).
   - Локальные карточки создаются/редактируются через отдельный движок `app/src/pilot/standaloneCardStorage.js` (`id > 1_000_000`, `is_dirty: 0`, квитанции `standalone-card-op:*` с лимитом `64`, флаги `standalone_local_created`/`standalone_local_edit`), оценки SRS пишутся в `db.progress` + `grade:*` (лимит `64`, ключи `review:*` удаляются в `offlineApi.js:407`), медиа хранятся на диске через нативный `OfflineMaterialArchivePlugin.java` (`getFilesDir()/lerne-offline-media/<folder>/archive_<sha256>.<ext>`), резервные копии и архивы выгружаются через SAF (`OfflineBackupFilePlugin.java`, `progressBackup.js` v1 / `full-v2`, `materialArchive.js` v4).
   - ИИ-генерация, облачный TTS, серверная синхронизация и редактирование макета отключены пропсами в `CardForm.jsx:86-101`.
   - В сборке отсутствуют `signingConfigs` и единый источник `versionCode` (fallback `1` в `android/app/build.gradle:13`); в `AndroidManifest.xml:6` включён `android:allowBackup="true"` без правил исключения.

2. **Web (`IS_STANDALONE=0`):**
   - Использует пер-аккаунтную Dexie БД `LerneLocalDB_<userId>` (схема `v1`–`v5` в `app/src/services/localDb.js:99-128`), кешируя данные поверх REST API и `/sync/v2/*`.
   - Мутации карточек в кешированных колодах перехватываются `apiCacheSync.js:15-109` + `cardOfflineQueue.js` (временные отрицательные ID, `is_dirty`, ключи `card-create-v2:`, `card-edit-v2:`, `card-move-v2:`, `card-lifecycle-v2:`) и дренируются `cardOutboxSync.js`.
   - В `useAppInitialization.js:17,118-200` работают фоновые таймеры синхронизации (`60 000 ms`, `visibilitychange`, `online`, включая срабатывание при `offline_mode=true` при наличии сети), `knowledgeSyncOrchestrator.js` (`60 000 ms`), а на совместных колодах `useCollaborativePresence.js` (`4 000 ms`).
   - Медиа кешируются лениво при рендере через `mediaCache.js` в `database.media` (лимит 150 MiB без LRU и SHA-256) или запрашиваются по CDN Supabase (`getAudioUrl`). Service Worker, Workbox, Web App Manifest, OPFS и `navigator.storage.persist()` отсутствуют (`app/index.html:5-7` выставляет `no-cache, no-store, must-revalidate`).

3. **Telegram Mini App (`IS_STANDALONE=0`):**
   - Разделяет ту же кодовую базу Web, добавляя авторизацию через `POST /api/auth/v2/telegram/mini-app` (`initData` HMAC), `Telegram.WebApp.CloudStorage` для языков и `HapticFeedback`.

### D1.2. Сервер (FastAPI + Supabase PG/Storage) и `lerne-admin`

1. **FastAPI (`tma/api/`):**
   - Авторизация `auth_v2` (Google PKCE, Telegram challenge / Mini App, Email/Password, Lerne SSO) с токенами `la_`/`lr_` в `TMAAuthSession`/`TMAAuthToken`.
   - Единый синхронизатор `/api/sync/v2/pull`, `/api/sync/v2/push`, `/api/sync/v2/status` (`api/services/offline_sync.py`), CAS по `revision` для карточек (`structured_card_api.py`), поколению БД `X-Lerne-Generation` (`sync_generation.py`) и квитанциями `TMAOfflineBatch` (`receipts.py`, без TTL/очистки).
   - ИИ-маршруты (`/cards/ai-generate`, `*-batch`, `/cards/classify-batch`, `/ai/evaluate-answer`) с серверным хранением ключей (`TMASetting`/env) и фильтрацией в `/api/init` и `/api/admin/settings`.
   - TTS (`api/utils/audio.py::generate_audio`) жёстко связывает `edge_tts` с загрузкой `audio_<sha256>.mp3` в Supabase Storage.
   - Библиотека: плоские шаблоны `scope='library'` (импорт копированием) и разделяемые папки `access_scope='global_readonly'` + `TMA_Collaborator` (проецируются в `/sync/v2/pull` каждого пользователя).

2. **`lerne-admin` (`C:\121\Lerne_projekt\lerne-admin`):**
   - **Material Transfer (`lerne-admin/src/lerne_admin/services/material_transfer.py` + `lerne-admin/src/lerne_admin/transfer_worker.py`):** 3-уровневый diff локальной и удалённой БД с `pg_try_advisory_lock`, `REPEATABLE READ READ ONLY`, явной блокировкой пользовательских SRS-полей (`FORBIDDEN`) и вызовом `touch_deck_and_parent_folders`.
   - **Очистка медиа (`lerne-admin/src/lerne_admin/routers/media.py::cleanup_orphaned_images`):** очищает только неиспользуемые записи `TMAMedia` папки `images` с учётом soft-deleted карточек, не удаляя файлы в Storage и не затрагивая `audio`.
   - **APK Builder (`lerne-admin/src/lerne_admin/services/android_build.py`, Этап A зафиксирован локальным коммитом `af39d18531bdf1a41d0b3ad878f2abc448988f7e`):** удалён устаревший режим `standard` из UI (`AdminAndroidBuildTab.jsx`), API (`routers/android_build.py`), валидации и логики сборки; сохранён единственный режим `offline-pilot`, параметры версии (`-PlernePilotVersionCode`, `-PlernePilotVersionName`), проверка APK (`aapt2`, `apksigner`) и интеграция с Android-проектом `tma`.

### D1.3. Подтверждённый локальный baseline (C6) и ограничения замеров

По результатам [LOCAL_FIRST_V3_AUDIT_BASELINE.md §7](./LOCAL_FIRST_V3_AUDIT_BASELINE.md):
- **Автотесты (проверено локально):** `npm --prefix app test` — `410/410 PASS`; `test_sync_read_queries.py` — `13/13 PASS`; `test_offline_sync.py` — `11/11 PASS`; `standaloneOfflinePilot` + `standaloneMaterialArchive` + `standaloneCardEditor` — `24/24 PASS`.
- **Одноразовый PostgreSQL 17.11 (`TestClient`, синтетический фикстур: 2 пользователя, 275 Native V2 карточек, 150 `TMAProgress`):**
  - `GET /api/sync/v2/status`: `7 SQL SELECT`, `105 B`, `257.30 ms`
  - `GET /api/sync/v2/pull` (холодный полный): `28 SQL SELECT`, `205 031 B`, `238.97 ms`
  - **`GET /api/sync/v2/pull` (`unchanged`):** **`26 SQL SELECT`**, `552 B`, `287.57 ms` (включая 4 auth SELECT с `2` блокировками `FOR UPDATE`, дублирующий вызов `generation_state()`, полное сканирование `tma_folder` и пересчёт `MD5(STRING_AGG(...))` по карточкам и прогрессу)
  - `GET /api/sync/v2/pull` (`progress_only`): `27 SQL SELECT`, `37 962 B`, `174.00 ms`
  - `POST /api/sync/v2/push` (1 `flag_only` + 1 UUID review): `27 SQL` (`18 SELECT`, `7 Write`), `134 B`, `264.63 ms`
  - `GET /api/init`: `40 SQL` (`36 SELECT`, `2 Write`), `6 329 B`, `474.74 ms`
  - `GET /api/collaborative/deck/11/presence` (каждые 4 с при открытой общей колоде): `26 SQL SELECT`, `465 B`, `147.82 ms`
- **Невыполненные / сбойные проверки:**
  - Live-тест обновления APK `v1 -> v2` на Android-эмуляторе не проводился из-за отсутствия `adb`/`emulator`/AVD в локальном окружении (см. [ANDROID_UPGRADE_AND_DATA_SAFETY.md §4](./ANDROID_UPGRADE_AND_DATA_SAFETY.md)).
  - Браузерный бенчмарк `--background-sync-browser` завершился ошибкой на базовом варианте `before` (`TimeoutError: 30000ms exceeded` в `scripts/tests/background_sync_browser.cjs:122`), поэтому браузерные HTTP/байт/decode-метрики в baseline не получены.

---

## D2. Целевая архитектура

Целевая архитектура Local-first V3 строится на положениях R7 и устраняет разрыв между «изолированным оффлайном без аккаунта/ИИ/синхронизации» (Android Offline Pilot) и «онлайн-центричным клиентом с фоновым поллингом» (текущий Web/TMA).

### D2.1. Базовые принципы (R7)

1. **Android — основной клиент, Web и Telegram Mini App — дополнительные клиенты:** единое ядро бизнес-логики (Dexie, SRS, Native V2, редактор карточек, локальная очередь), при этом нативные возможности Android (`getFilesDir()/lerne-offline-media`, SAF, стабильный WebView без 7-дневного ITP-вытеснения) обеспечивают гарантированную долговременную автономность.
2. **Dexie — первичное рабочее хранилище:**
   - Старт приложения, открытие папок/колод, обучение, оценивание SRS, создание/редактирование/удаление локальных карточек и воспроизведение загруженных медиа требуют **0 HTTP-запросов и 0 SQL-операций**.
   - Сервер не является обязательным участником учебного цикла.
3. **Строго ручная синхронизация по кнопке:**
   - Бесконтрольный фоновый опрос (`60s` sync в `useAppInitialization.js`, `60s` outbox scan в `knowledgeSyncOrchestrator.js`, `4s` presence polling в `useCollaborativePresence.js`, двойной sync в `api.js:120-134`) отключается по умолчанию.
   - Пользователь явно инициирует синхронизацию («Синхронизировать» / кнопка на колоде или в профиле) и получает предсказуемую квитанцию результата (отправлено карточек, оценок, медиа, получено обновлений, выявлены конфликты).
4. **Минимизация расходов на Vercel и Supabase (сохранение free-tier):**
   - Никаких периодических запросов в простое; минимум холодных стартов на старт экрана; отказ от `FOR UPDATE` при проверке токена на чтениях; дельта-pull вместо полного снимка; пакетный push карточек вместо `1+1+...`; передача медиа строго по отсутствующим SHA-256; отказ от принудительной выгрузки всех `global_readonly`-курсов каждому пользователю; вывод бинарных BLOB из `TMAMedia.content`.
5. **Секретные ключи ИИ исключительно на сервере:**
   - Никакие LLM-ключи (`GOOGLE_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`) никогда не попадают в APK, клиентский JS-бандл или `localStorage`. Android использует те же защищённые серверные эндпоинты по явному действию пользователя при наличии сети и аутентификации.
6. **Гарантированная сохранность будущих пользовательских данных:**
   - Обновление APK поверх установленной версии, эволюция схемы Dexie `v5 -> v6+`, миграция `LerneStandaloneDB_900001`, обрывы питания/сети, повторы запросов, работа на нескольких устройствах и восстановление JSON/ZIP-бэкапов не должны приводить к потере карточек, истории SRS или медиафайлов.

### D2.2. Целевая схема взаимодействия

```text
+-----------------------------------------------------------------------+
|  Клиенты (единое React + Dexie ядро: srsEngine, nativeV2, CardForm)   |
|                                                                       |
|  [Android APK - Primary]            [Web / Telegram Mini App]         |
|   - Dexie LerneLocalDB_<uid|guest>   - Dexie LerneLocalDB_<uid>       |
|   - Native FS: lerne-offline-media/  - SW Workbox + OPFS/IDB media    |
|   - SAF Export/Import (ZIP + JSON)   - storage.persist() / warnings   |
+-------------------+-------------------------------+-------------------+
                    | (ТОЛЬКО по кнопке / явному действию пользователя)
                    v                               v
     +--------------+-------------------------------+--------------+
     |  Vercel FastAPI (stateless HTTP boundary)                   |
     |  - Auth v2 (Bearer без FOR UPDATE на read-path)             |
     |  - /sync/v2/{status,pull(delta),push(batch)}                |
     |  - /cards/ai-* (ключи только на сервере, 0 обязательных PG) |
     |  - /media/synthesize-audio (чистый Edge-TTS -> MP3 bytes)   |
     |  - /media/check-missing + /media/* (Storage / signed URLs)  |
     +--------------+-------------------------------+--------------+
                    |                               |
                    v                               v
     +--------------+--------------+     +----------+--------------+
     | Supabase PostgreSQL         |     | Supabase Storage          |
     | - TMA_*, TMAProgress,       |     | - audio/audio_<sha256>  |
     |   TMAReviewHistory,         |     | - images/img_<sha256>   |
     |   TMAOfflineBatch (с TTL)   |     | (без автоудаления audio)|
     +--------------+--------------+     +-------------------------+
                    ^
                    | (изолированный локальный контур, без SRS)
     +--------------+--------------+
     | lerne-admin                 |
     | - Material Transfer (PG->PG)|
     | - cleanup_orphaned_images   |
     | - APK Builder (offline-pilot|
     |   + check signer_sha256)    |
     +-----------------------------+
```

---

## D3. Единая бизнес-логика

### D3.1. Что сохраняется как единый неделимый источник истины

Согласно принципу R7.6 запрещено создавать отдельные реализации для Android и Web следующих модулей:
1. **SRS (`app/src/utils/srsEngine.js` + `api/srs.py`):** единые константы, 4/8-балльные шкалы, `scheduled`/`forced`, банковское округление; регрессионный паритет между JS и Python продолжает проверяться перекрёстными тестами.
2. **Контракт и схема Native V2 (`app/src/utils/nativeV2Contract.js`, `nativeV2Schema.generated.js`):** единая валидация для 9 типов карточек без платформенных ответвлений.
3. **UI-редактор и просмотрщик (`@lerne/card-ui`: `NativeCardFormCore.jsx`, `NativeCardViewer.jsx`, `useLocalAudioPlayer.js` + `CardForm.jsx`):** единый компонент формы для Android, Web, TMA и `lerne-admin`; различия возможностей (например, отсутствие сети в данный момент или права `viewer`) передаются декларативными пропсами, а не форками компонентов.
4. **Локальная БД и локальный API-фасад (`localDb.js`, `offlineApi.js`):** единая схема Dexie и единая обработка локального обучения, навигации, поиска и редактирования.

### D3.2. Устранение текущего раздвоения мутаций и медиа

В текущей кодовой базе ([LOCAL_FIRST_V3_AUDIT_BASELINE.md §3.2](./LOCAL_FIRST_V3_AUDIT_BASELINE.md)) выявлены три точки структурного расхождения, которые необходимо устранить в V3:

1. **Раздвоение локальных мутаций карточек (`standaloneCardStorage.js` vs `apiCacheSync.js` + `cardOfflineQueue.js` + `cardOutboxSync.js`):**
   - Сейчас в одной и той же таблице `db.cards` контур Standalone пишет положительные ID `> 1_000_000`, `is_dirty: 0` и `standalone-card-op:*`, а контур Web/TMA — отрицательные временные ID (`getNextTempId`), `is_dirty: 1` и `card-create-v2:*` / `card-edit-v2:*`.
   - **Целевое правило V3:** единый локальный CRUD-пайплайн в `offlineApi.js` + `cardOfflineQueue.js`:
     - При создании карточки без сервера выдаётся временный локальный ID (либо отрицательный `getNextTempId`, либо выделенный локальный диапазон — см. **Блок 3 в D12**), записывается единая операция outbox (`card-create-v2:` / `card-edit-v2:` / `card-move-v2:` / `card-lifecycle-v2:`) и ставится `is_dirty: 1` (в неавторизованном офлайн-профиле без привязки к облаку outbox остаётся локальным журналом до подключения аккаунта или очистки после подтверждённого экспорта).
     - Удаляется дублирующая реализация валидации/нормализации/ревизии между `standaloneCardStorage.js` и `cardOfflineQueue.js`; остаётся один модуль локальных мутаций карточек.

2. **Раздвоение путей медиа (`OfflineMaterialArchivePlugin.java` vs `offlineMediaStore.js` vs `mediaCache.js`):**
   - Сейчас существуют 3 несогласованных хранилища: нативное файловое `lerne-offline-media/`, standalone-браузерный `offlineMediaStore.js` (с SHA-256) и онлайн-браузерный `mediaCache.js` (без SHA-256, без LRU, с утечкой `URL.createObjectURL`).
   - **Целевое правило V3:** единый интерфейс клиентского медиахранилища (`MediaStoreAdapter`) поверх канонических SHA-256 ключей:
     - **Android adapter:** нативный `OfflineMaterialArchivePlugin` (`getFilesDir()/lerne-offline-media/` + `Capacitor.convertFileSrc`).
     - **Web/TMA adapter:** OPFS или `database.media` в Dexie (см. **Блок 7 в D12**), но с единой проверкой SHA-256, метаданными размера/LRU и корректным освобождением `objectURL`.
     - Общий конвейер `useMediaUpload.js` и `cardMediaView.js` работает с локальными SHA-256 ссылками независимо от того, запущен ли код на Android или в Web.

3. **Хрупкий обход `onUploadLayoutImage={null}` (`CardForm.jsx:96` vs `StructuredCardFields.jsx:9-20`):**
   - В `StructuredCardFields.jsx` встроен скрытый `defaultUploadLayoutImage` с прямым `fetch('/api/media/upload-image')`, не срабатывающий на Android лишь потому, что `lockLayout={IS_STANDALONE}` скрывает `<CardImages>`.
   - **Целевое правило V3:** удалить скрытый `fetch`-fallback из UI-компонента `StructuredCardFields.jsx` — любая загрузка изображений (обложка и layout) должна идти исключительно через единый инъектированный обработчик (`useMediaUpload` -> `MediaStoreAdapter`). При отсутствии прав/возможности редактор явно блокирует загрузку, а при локальном редактировании layout-изображения сохраняются локально по тем же SHA-256 правилам, что и обложка.

---

## D4. Локальная ИИ-генерация через защищённое API

### D4.1. Принцип работы: Android + локальное хранение + серверные ключи

В V3 Android больше не блокирует ИИ-генерацию жёстким флагом `IS_STANDALONE`:
- **Когда пользователь офлайн или не авторизован:** локальное обучение, SRS и ручное создание/редактирование карточек работают полностью автономно (`0` запросов к серверу); кнопки облачного ИИ/TTS в интерфейсе показывают понятный статус «Доступно при входе в аккаунт и наличии сети» (без блокировки остальной работы).
- **Когда пользователь авторизован и нажимает кнопку ИИ-генерации:** клиент отправляет запрос на защищённый серверный API (через `networkApi`, с Bearer-токеном `auth_v2`), получает сгенерированный `content_v2` и **сохраняет карточку только в локальный Dexie** — без обязательной немедленной записи в PostgreSQL.

### D4.2. Переиспользование существующих эндпоинтов без записи в PostgreSQL

Согласно [LOCAL_FIRST_V3_AUDIT_BASELINE.md §4.1–4.4](./LOCAL_FIRST_V3_AUDIT_BASELINE.md):
1. **`POST /api/cards/ai-generate` (и `/api/ai/generate`):** уже не пишет ни в `TMA_Card`, ни в `TMA_Deck` (`api/routers/ai.py:267-279`) — выполняет только 2 коротких `run_db` SELECT (`TMASetting`, `TMACustomPrompt`) и возвращает `{ content_v2 }`.
2. **`POST /api/cards/ai-generate-batch` и `POST /api/cards/ai-enrich-batch`:** пишут в PostgreSQL **только при переданном `deck_id`** (`ai.py:255-256`). Вызов с `deck_id: null` возвращает массив черновиков `{ cards: [{ content_v2 }] }` без единой записи в PG, готовый к сохранению в Dexie.
3. **`POST /api/cards/classify-batch` и `POST /api/ai/evaluate-answer` (пробел для локальных карточек):**
   - `classify-batch` (`ai.py:290-302`) и `evaluate-answer` (`ai.py:21-51`, `card_id: int = Field(gt=0)`) сейчас жёстко читают карточку из PostgreSQL (`TMA_Card`). Для новой локальной карточки в Android (ещё не синхронизированной на сервер) строка в PG отсутствует.
   - **Решение V3:**
     - Для `classify-batch`: поддержать передачу списка `{ local_id, text/prompt, target_language }` без записи в PG (stateless CEFR-классификация с возвратом `{ local_id, level, cefr }`).
     - Для `evaluate-answer`: для синхронизированных карточек (`card_id > 0`) сохранить текущий безопасный путь через `load_answer_context` (эталон не передаётся на сервер с клиента и не утекает в ответ без админ-флага); для **несинхронизированных локальных карточек автора** (`local_card` / `id < 0`) предусмотреть либо (а) stateless-режим с передачей `content_v2` (строго для собственной несинхронизированной черновой карточки типа `free_text`), либо (б) предварительную синхронизацию колоды. При этом запрещено разрешать клиенту подменять эталон для чужих/опубликованных карточек (`card_id > 0` всегда берёт эталон из PG, сохраняя инвариант `api/routers/ai.py:41`).

### D4.3. Авторизация на Android, `X-Lerne-Generation` и защита от злоупотреблений

1. **Канал аутентификации Android (`auth_v2`):**
   - CORS в `api/main.py:86-97` уже разрешает `https://localhost`, `http://localhost` и `capacitor://localhost`.
   - Для входа с Android используется существующий `auth_v2`: Email/Password, PKCE Google OAuth (`POST /api/auth/v2/challenges` -> системный браузер/Custom Tabs -> deep link или polling `exchange`), либо Telegram bot challenge.
   - При наличии `offline_mode` или локального автономного профиля в `useAuthStore.js` должна быть явная возможность «Подключить аккаунт Lerne» без потери данных `LerneStandaloneDB_900001` (см. D11).
   - Токены `access_token` / `refresh_token` хранятся в изолированном хранилище Android-приложения (WebView `localStorage` при `allowBackup="false"`, либо безопасный нативный плагин/EncryptedSharedPreferences).
2. **Развязка `X-Lerne-Generation` для stateless ИИ/TTS:**
   - Сейчас `require_generation` в `api/dependencies/auth.py` навешивает 3 SQL `SELECT` (`SYNC_DATABASE_RESTORE`, `pg_class`, `SYNC_GENERATION_ANCHOR`) на каждый защищённый маршрут. Stateless-эндпоинты ИИ и синтеза TTS не изменяют пользовательские таблицы `TMA_Deck`/`TMA_Card`, поэтому их можно освободить от `require_generation` (оставляя только `get_authenticated_user_id`), экономя 3 SQL-запроса на каждый вызов ИИ/TTS.
3. **Защита от злоупотреблений и rate-limiting на free-tier:**
   - Так как ИИ-маршруты вызывают внешние LLM-провайдеры с квотами ключей (`ai_clients.py`), необходимо ввести per-user rate-limiting (например, скользящее окно/токен-бакет в `TMASetting`/памяти или счётчик квоты на пользователя в PG с минимальным оверхедом) и таймаут-бюджеты Vercel, чтобы ошибка одного пользователя или скрипт не исчерпали общий пул ключей (`GOOGLE_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY`).
   - Отказ от хранения промптов/ключей на клиенте сохраняется полностью (`_sanitize_error`, фильтрация `/api/init` и `/api/admin/settings`).

---

## D5. Edge-TTS и локальное аудио с опциональной публикацией и оценкой дедупликации

### D5.1. Разделение синтеза байтов и публикации в Storage (`tma/api/utils/audio.py`)

В [LOCAL_FIRST_V3_AUDIT_BASELINE.md §4.3](./LOCAL_FIRST_V3_AUDIT_BASELINE.md) зафиксирована жёсткая сцепка в `tma/api/utils/audio.py::generate_audio` (`L77-180`): после синтеза `edge_tts` функция безусловно требует `SUPABASE_URL`/`SUPABASE_KEY` и выполняет `_upload_to_supabase` (`L227-278`) с последующим верификационным `GET`. При этом в `lerne-admin/src/lerne_admin/routers/media.py:632-694` (`GET /api/admin/voice-preview`) уже реализован чистый in-memory стриминг `edge_tts` без обращения к Storage и БД.

**Целевой рефакторинг `tma/api/utils/audio.py`:**
1. Выделить внутреннюю функцию чистого синтеза:
   ```python
   async def synthesize_tts_bytes(
       text: str,
       voice: str | None = None,
       rate: str = "+0%",
       with_boundaries: bool = False,
   ) -> tuple[bytes, str, list[dict] | None]
   ```
   - Возвращает `(audio_bytes, "audio/mpeg", word_boundaries)`.
   - Собирает чанки `edge_tts.Communicate(clean_text, voice, rate=rate).stream()` непосредственно в памяти (с ограничением `MAX_AUDIO_BYTES`, без обязательного мусора в `/tmp/pending_audio` при `publish=False`, либо с опциональным кэшем в рамках жизни инстанса).
   - Устраняет необходимость `SUPABASE_URL`/`SUPABASE_KEY` для чистого синтеза.
2. Обернуть прежнюю функцию `generate_audio(...)`:
   - Вызывает `synthesize_tts_bytes(...)`, затем `_upload_to_supabase(audio_bytes, ...)`, сохраняя полную обратную совместимость для существующих онлайн-вызовов `POST /api/media/generate-audio` и `POST /api/media/generate-card-audio` (для уже опубликованных/совместных карточек).
3. **Stateless TTS-эндпоинт для Local-first клиентов** (например, `POST /api/media/synthesize-audio` или параметр `publish: bool = False` в `/api/media/generate-audio`):
   - Авторизация: `Depends(get_authenticated_user_id)` (1 SELECT `TMASetting` только если голос/скорость не переданы явно клиентом — если клиент передаёт `voice` и `rate` из кэша профиля, **0 SQL-запросов к таблицам данных**!).
   - Возвращает бинарный поток `audio/mpeg` (или JSON `{ audio_base64, sha256, mime, word_boundaries }` при `with_boundaries=true` + заголовок `X-Audio-SHA256`).
   - **0 записей в Supabase Storage, 0 записей в PostgreSQL.**

### D5.2. Локальное сохранение и опциональная публикация при Sync / Share

1. **Локальная фаза (Android / Web):**
   - Получив MP3-байты от `/api/media/synthesize-audio`, клиент (через единый `storeLocalMediaFile` в `localMediaWriter.js`) вычисляет SHA-256, проверяет аудиозаголовок (MP3 frame sync / ID3), сохраняет файл локально как `archive_<sha256>.mp3` (`getFilesDir()/lerne-offline-media/audio/` на Android) и прописывает в карточке `/api/media/audio/archive_<sha256>.mp3`.
   - Если карточка никогда не синхронизируется и не публикуется (используется только локально или экспортируется в `.zip` архив `lerne-materials`), аудиофайл **никогда не загружается в Supabase Storage** — экономится 100% Storage-места и исходящего трафика.
2. **Опциональная публикация (при нажатии Sync или Share):**
   - Только когда карточка со ссылкой `archive_<sha256>.mp3` отправляется на сервер (`sync` или `share`), клиент в фазе медиа-синхронизации (см. D8) проверяет по SHA-256, существует ли уже `audio_<sha256>.mp3` в облаке, загружает байты только при отсутствии объекта, а в серверной записи карточки ссылка нормализуется к каноническому облачному имени `audio_<sha256>.mp3` (или `img_<sha256>.<ext>` для изображений).
   - **Контракт согласованности `revision` и локального резолвера:** когда серверный `POST /api/cards/batch-sync` (или `sync`/`share`) нормализует локальную ссылку `archive_<sha256>.*` внутри `content_v2` или медиаполей в облачную `audio_<sha256>.*` / `img_<sha256>.*`, серверный **ACK обязан вернуть нормализованный `content_v2` и пересчитанный `revision`** (`api/services/structured_card_api.py:221`), чтобы клиент обновил Dexie и не получил `409 card_revision_conflict` при следующем редактировании; одновременно клиентский резолвер (`app/src/pilot/offlineMediaResolver.js:5,127` / `MediaStoreAdapter`) должен разрешать облачные имена `audio_<sha256>.*` и `img_<sha256>.*` напрямую в уже сохранённый локальный файл `archive_<sha256>.*` по 64-символьному SHA-256 без повторного скачивания.

### D5.3. Оценка SHA-256 дедупликации и инвариант запрета автоудаления

1. **Оценка дедупликации:**
   - В облаке (`api/utils/audio.py:250`) и локально (`OfflineMaterialArchivePlugin.java`, `materialArchive.js`) аудио уже именуется по SHA-256 содержимого (`audio_<sha256>.mp3` и `archive_<sha256>.mp3`).
   - Примечание по `edge_tts`: сервис Microsoft Edge TTS может возвращать слегка отличающиеся MP3-метаданные/фреймы при разных вызовах в разное время для одной и той же фразы, поэтому дедупликация по SHA-256 **не гарантирует 100% совпадение** при повторном синтезе с нуля, но даёт **100% точную дедупликацию** при клонировании колод, шаринге, экспорте/импорте ZIP-архивов, повторной загрузке одного файла и публикации локального `archive_<sha256>.mp3` -> `audio_<sha256>.mp3` (так как SHA-256 байтов совпадает посимвольно!).
   - Дополнительный плюс: при публикации из Android в Supabase Storage бакет `audio` принимает `x-upsert: false`, и если другой пользователь/колода ранее уже загрузили тот же `audio_<sha256>.mp3`, повторной перезаписи не происходит (см. также проверку существования в D8 для исключения лишнего `POST` байтов).
2. **Жёсткий архитектурный инвариант — ЗАПРЕТ автоудаления аудио при удалении карточки:**
   - Поскольку `audio_<sha256>.mp3` (в облаке) и `archive_<sha256>.mp3` (в архивах) являются контент-адресуемыми объектами без счётчика ссылок между всеми пользователями, клонами колод (`library_import`, `share/import`) и резервными копиями, **автоматическое удаление облачного аудиофайла при удалении/редактировании карточки запрещается** как на клиенте, так и на сервере.
   - Этот инвариант полностью согласован с `lerne-admin/src/lerne_admin/routers/media.py:47-150, 395-430` (`cleanup_orphaned_images`), который чистит исключительно записи `TMAMedia` для `images`, учитывает даже soft-deleted карточки и принципиально не трогает бакет `audio`.
   - Для локального диска Android допустим только безопасный mark-and-sweep GC **неактуальных локальных файлов** (см. D8.4), который удаляет `archive_<sha256>.*` только если на данный SHA-256 не ссылается ни одна активная, ни одна удалённая в корзину (Trash) карточка/колода, ни одна запись outbox/staging на данном устройстве.

---

## D6. Синхронизация материалов

### D6.1. Принцип: расширение `/sync/v2/*` вместо переписывания

Как подтверждено в [LOCAL_FIRST_V3_AUDIT_BASELINE.md §6.3](./LOCAL_FIRST_V3_AUDIT_BASELINE.md), существующий протокол `/sync/v2/*` (`offline_sync.py` + `syncService.js` + `cardOutboxSync.js` + `TMAOfflineBatch`) уже реализует критические гарантии целостности:
- порядок фаз (сначала дренирование outbox и создание ID-маппингов `aliases`, затем `pull`, при `unacknowledgedCreates > 0` pull блокируется);
- квитанции `TMAOfflineBatch` с проверкой `payload_hash`;
- CAS по `revision` для Native V2 карточек и `409 card_revision_conflict` с ручным разрешением (`resolveCardEdit`);
- карантин при смене `server_generation` (`X-Lerne-Generation`);
- защиту от затирания несинхронизированных локальных изменений (`keepLocalCard`, `is_dirty`).

Поэтому в V3 **не создаётся новый синхронизатор**: существующий `/sync/v2/*` точечно расширяется в четырёх направлениях (см. также **Блок 1 в D12**).

### D6.2. Снижение стоимости неизменённого `GET /api/sync/v2/pull` с 26 SQL SELECT до минимума

По данным локального замера C6 (таблица 1 в [LOCAL_FIRST_V3_AUDIT_BASELINE.md §7.2](./LOCAL_FIRST_V3_AUDIT_BASELINE.md)), каждый `unchanged`-запрос `/sync/v2/pull` сегодня тратит **26 SQL `SELECT` в 3 соединениях с 2 блокировками `FOR UPDATE`**. План оптимизации:

| Текущие запросы в `unchanged` `/sync/v2/pull` | Причина перерасхода в коде | Целевое исправление V3 | Ожидаемый эффект |
| --- | --- | --- | --- |
| **[1–4] Auth + `2× FOR UPDATE`** | `api/auth/service.py:254-264,293-296` вызывает `locked()` (`SELECT ... FOR UPDATE`) на `tma_auth_account` и `tma_auth_session` даже при чтении Bearer-токена | Для обычной проверки Bearer (`authenticate`) убрать `FOR UPDATE` (оставив `FOR UPDATE` только в `refresh`, `logout`, `revoke`, `link`). Выполнить одним JOIN-запросом `TMAAuthToken` + `TMAAuthSession` + `TMAAuthAccount` | `4 SELECT` + `2 FOR UPDATE` -> `1 SELECT`, **0 блокировок**, нет сериализации параллельных запросов |
| **[5–7] + [20–22] Двойной `generation_state()`** | `require_generation` (`api/dependencies/auth.py:14-16`) + повторный вызов в `offline_sync.py:390` | Передавать результат проверки из зависимости `require_generation` в контекст запроса (или кэшировать в рамках запроса) и объединить чтение `TMASetting` | `6 SELECT` -> `0–2 SELECT` (в одном транзакционном скоупе) |
| **[9] Глобальный скан `tma_folder`** | `get_folder_access_map()` (`collaborative_service.py:91-97`) загружает **все** активные папки всей БД | Выбирать только папки пользователя, папки из его `TMA_Collaborator` (рекурсивный CTE вниз/вверх по дереву) и только **подписанные** пользователем `global_readonly`-корни (см. D9) | Убирает $O(\text{все пользователи платформы})$ чтение на каждый pull |
| **[10–19] Полная выгрузка ACL, папок, колод и настроек обучения (`10 SELECT`)** | `offline_sync.py:340-363` безусловно грузит `tma_collaborator`, `tma_deck`, собственные `tma_folder`/`tma_deck`, batch-роли и `TMASetting` (`DECK_LEARNING_*`) **до** проверки `unchanged` | Вычислять лёгкий watermark (`user_sync_seq` / `MAX(updated_at)` + `acl_epoch`) и проверять условие `unchanged` **строго перед** выполнением запросов `[10–19]`, делая ранний возврат без материализации дерева и настроек | `10 SELECT` -> **`0 SELECT`** на пути `unchanged` (обязательно для выхода на `<= 6–8 SELECT`) |
| **[23–26] Полный `MD5(STRING_AGG)` и каталог** | `_deck_summary_versions` + `_row_versions` агрегируют все карточки и весь прогресс пользователя при каждом pull | Хранить лёгкую отметку изменений/монотонный `sync_seq` или агрегированный `MAX(updated_at)`/`COUNT(*)` (плюс tombstone-журнал) и кэшировать `catalogue_version` отдельно от pull | Быстрая проверка `unchanged` по индексам вместо сканирования всех строк `tma_card` и `tmaprogress` |

*Обязательное условие достижения цели E2 (`<= 6–8 SQL SELECT` на `unchanged`):* одной оптимизации auth (`[1–4]`), двойного `generation_state()` (`[5–7],[20–22]`) и глобального скана `tma_folder` (`[9]`) недостаточно — если запросы `[10–19]` (`tma_collaborator`, `tma_deck`, `tmasetting` и др.) продолжают выполняться до проверки `unchanged`, число запросов останется на уровне ~15–17 `SELECT`. Лёгкий gate по watermark / `acl_epoch` должен выполняться **перед** загрузкой `[10–19]` с немедленным возвратом `status: 'unchanged'`, а фаза проверки поколения и read-транзакция `REPEATABLE READ` объединяются в 1–2 открытия соединения `PooledPostgresqlDatabase` вместо 3.

### D6.3. Дельта-синхронизация (Cursor / `since`) вместо полного снимка

Сейчас любой сдвиг `content_version` (даже изменение 1 карточки) заставляет сервер вернуть **все** доступные папки, колоды, карточки и прогресс (`205 KB` на 275 карточек), а `applySnapshot` в `syncService.js:62` читает **100% строк** IndexedDB через `toArray()`.

**Протокол дельта-pull в `/sync/v2/pull`:**
1. Клиент передаёт `cursor` (серверную метку времени/монотонный `sync_seq` последнего подтверждённого снимка, `snapshot_version`, `content_version`, `acl_epoch`).
2. Если клиент впервые синхронизируется (`cursor` отсутствует), сменился `server_generation` (`restored=true`), изменился состав доступных общих/подписанных папок (`acl_epoch` не совпал) либо окно хранения tombstones истекло — сервер возвращает полный снимок (`mode: 'full'`) как сейчас.
3. Иначе сервер возвращает `mode: 'delta'` с:
   - изменившимися/добавленными папками, колодами и карточками (`updated_at >= cursor_ts` или `sync_seq > cursor`, включая `is_deleted=True` tombstones);
   - списком `revoked_deck_ids` / `revoked_folder_ids` / `hard_deleted_card_ids` (если физическое удаление разрешено вне Trash, хотя в TMA для пользовательских карточек основное удаление — мягкое через `is_deleted=True`);
   - новым `next_cursor`, `server_time`, `snapshot_version`, `content_version`.
4. На клиенте `applyDeltaSnapshot` использует `bulkGet` / индекс `by id` только для пришедших записей (не сканируя всю таблицу `db.cards.toArray()`), сохраняя существующую логику `reconcileCardEditLifecycle`, `keepLocalCard` и `is_dirty`.

### D6.4. Пакетный Push V2 карточек и заметок

Сейчас `cardOutboxSync.js:358-374` отправляет созданные (`POST /cards/save`) и отредактированные (`PATCH /cards/{id}`) карточки по **1 HTTP-запросу на карточку**, а `cardNotes.js` — по 1 `PUT` на заметку. При создании 50 карточек в офлайне это вызывает 50 последовательных Serverless-вызовов на Vercel.

**Расширение V3:**
- Ввести пакетный эндпоинт **`POST /api/cards/batch-sync`** (либо поддержать V2-массив `v2_card_ops` внутри `/api/sync/v2/push` с сохранением отклонения legacy `request.cards` кодом `legacy_queue_requires_recovery`).
- Пакет до `MAX_BATCH_CARDS = 100` операций (`create` с `client_request_id` и временным `local_id`, `edit` с `expected_revision`).
- Сервер в одной транзакции (или с per-item savepoint) переиспользует существующие `ContentV2.model_validate`, `_lock_decks` / `_lock_cards`, `_claim_receipt` (`TMAOfflineBatch`), `validate_new_audio_paths`, `touch_deck_and_parent_folders` и возвращает:
  - `mappings` (`local_id -> server_card_id`) для `aliases`;
  - нормализованный `content_v2` (при преобразовании локальных ссылок `archive_<sha256>.*` -> `audio_<sha256>.*` / `img_<sha256>.*`), актуальные `revision` (`structured_card_api.py:221`) и `updated_at` для каждой успешной карточки, чтобы последующие локальные правки не вызывали `409 card_revision_conflict`;
  - массив `conflicts` (`[{ op_id, card_id, code: 'card_revision_conflict', server_card }]`) — конфликт одной карточки не роняет остальные независимые карточки пакета, а переводит только конфликтную карточку в `offline_edit.status = 'conflict'` для ручного выбора пользователя (`resolveCardEdit`).
- Аналогично для `card-notes`: пакетный `PUT /api/card-notes/batch`.

### D6.5. Сохранение изоляции `lerne-admin` Material Transfer

`lerne-admin/src/lerne_admin/services/material_transfer.py` и `lerne-admin/src/lerne_admin/transfer_worker.py` остаются **полностью отделёнными** от пользовательского синхронизатора `/sync/v2/*`:
- Не смешивать админскую публикацию мастер-контента (PG -> PG) с пользовательским SRS (`FORBIDDEN` остаётся активным).
- Material Transfer продолжает вызывать `touch_deck_and_parent_folders` (`L1863`), благодаря чему инкрементальный дельта-pull пользователей автоматически подхватывает только обновлённые администратором колоды/карточки.

---

## D7. Синхронизация SRS

### D7.1. Строгое разделение материалов и SRS

Модель V3 строго разделяет три независимых контура данных карточки:
1. **Контент материала** (`TMA_Card.content_v2`, медиапути, `position`, `deck_id`, `is_deleted`): редактируется авторами/`editor`, защищён `revision` CAS и квитанциями `cards-v2:*`.
2. **События обучения SRS** (`review:<action_id>` -> `TMAReviewHistory` + пересчёт `TMAProgress` через `api/srs.py::review_card()`): append-only журнал оценок конкретного `user_id`, разрешён даже для `viewer` и в `global_readonly`-курсах.
3. **Пользовательские пометки** (`flag`, `want_to_learn`, `is_learning`, `card_notes`): раздельные поля с `flag_only=true` и отдельной таблицей `TMACardNote`.

Изменение контента карточки другим редактором (и даже `409 card_revision_conflict` по тексту карточки) **не блокирует и не откатывает** синхронизацию SRS-оценок пользователя, а синхронизация SRS никогда не перетирает контент карточки.

### D7.2. Идемпотентность по UUID `action_id` и защита от двойного применения оценок

Текущий контур уже имеет прочную основу (`offlineApi.js:379-428`, `api/services/study.py:26-52`, `api/services/offline_sync.py:257-268`), которую V3 формализует как обязательный контракт для всех клиентов (включая Android):

1. Каждое оценивание карточки в интерфейсе генерирует `action_id = crypto.randomUUID()` и сохраняет в одной Dexie-транзакции `[db.progress, db.syncState]`:
   - обновлённую локальную строку `db.progress` (вычисленную через единый `srsEngine.js`, чтобы пользователь сразу видел актуальное расписание);
   - квитанцию `grade:<action_id>` (с отпечатком `[card_id, grade, is_extended, context]`);
   - событие outbox `review:<action_id>` (`action_id, card_id, rating, is_extended, review_context, review_time, scheduled_interval`).
2. **Защита от повторов, обрыва сети и потери ответа (lost ACK):**
   - При повторной отправке пакета `POST /api/sync/v2/push` (из-за таймаута, обрыва связи после коммита на сервере, перезапуска приложения) сервер:
     1) проверяет квитанцию пакета `{user_id}:{request_id}` в `TMAOfflineBatch` (отдаёт сохранённый ответ без повторного исполнения);
     2) даже если клиент переупаковал то же событие в новый `request_id`, для каждого `review` проверяется квитанция `grade:{user_id}:{action_id}` в `TMAOfflineBatch` под транзакцией и `TMAProgress ... FOR UPDATE`.
   - Таким образом, **оценка с данным `action_id` физически не может быть применена дважды**, ни на одном устройстве и ни при каком числе ретраев.
3. **Удаление `review:*` из outbox клиента:** происходит **только** после получения HTTP 200 (или подтверждённого replay) от `/sync/v2/push` в рамках атомарной транзакции Dexie.

### D7.3. Почему наивный LWW (Last-Write-Wins) для SRS неприемлем без причинно-событийного доказательства

Рассмотрим сценарий на двух устройствах пользователя (Android в метро без сети + Web вечером дома) над одной карточкой $C$ с начальным состоянием `(interval=10d, reps=3, ease=2.5)`:
- **10:00 (Android, офлайн):** пользователь оценивает карточку $C$ на `Good (2)`. Локальный SRS вычисляет `(interval=25d, reps=4, last_reviewed=10:00)`.
- **18:00 (Web, онлайн):** не дождавшись синхронизации Android, пользователь снова видит $C$ как due и оценивает на `Again (0)` (забыл). Сервер фиксирует `(interval=0d, queue='relearn', lapses=1, last_reviewed=18:00)`.
- **20:00 (Android, синхронизация):**
  - При **наивном LWW по `updated_at` / порядку прихода**:
    - Если LWW по времени оценки (`18:00 > 10:00`), оценка в 10:00 бесследно исчезает из истории.
    - Если LWW по времени последнего `push` (20:00 > 18:00), локальный снимок Android `(interval=25d, reps=4)` **затирает** провал в 18:00 (`lapses=1` исчезает, карточка уходит на 25 дней вместо переучивания!).
    - При сбое системных часов на одном из устройств (clock skew) LWW вообще становится недетерминированным.
- **Вывод RFC:** Наивный LWW поверх итоговых полей `TMAProgress` (`interval`, `ease_factor`, `repetitions`, `lapses`, `next_review`) **категорически отвергается**.
- **Приемлемая модель V3:** **Event-sourced SRS replay с причинно-базовой проверкой**:
  - Клиент отправляет **события** `reviews[]` с уникальным `action_id` (и опциональным `base_progress_stamp` / `review_time`), а **не** сырой снимок SRS-полей.
  - Для `flag` и `want_to_learn` используется отдельный `flag_only: true` (для них LWW по явному действию допустим, но изолирован от SRS, как уже реализовано в `offline_sync.py:229-236`).
  - При синхронизации сервер применяет новые (не встречавшиеся по `action_id`) события к актуальному серверному состоянию `TMAProgress` под `FOR UPDATE` через `srs.review_card()` в хронологическом порядке и возвращает пересчитанную итоговую строку `TMAProgress` клиенту (см. подробнее сравнение вариантов в **Блоке 2 в D12**).

### D7.4. Многоустройственная реконсиляция SRS и порядок событий

1. **Проблема «устаревшего хвоста событий» (out-of-order replay):**
   - В текущем `offline_sync.py:257-265` события из одного пакета сортируются по `review_time`, но если устройство A 3 дня было офлайн, а устройство B уже продвинуло `TMAProgress` до `18:00`, при позднем приходе события `10:00` с устройства A простое добавление `review_card(state_18:00, rating_10:00)` применит старую оценку **поверх** более новой.
   - Для решения в **Блоке 2 (D12)** сравниваются: (A) последовательный append-on-sync с проверкой `review_time >= progress.last_reviewed` (иначе запись только в историю `TMAReviewHistory` / пересчёт всей цепочки), (B) полный детерминированный пересчёт `TMAProgress` по отсортированной истории `TMAReviewHistory` за последнее окно при обнаружении out-of-order события, и (C) гибрид: append при отсутствии конкурентного продвижения (`last_reviewed` совпадает или новее) + пересчёт цепочки из `TMAReviewHistory` только в редком случае реального offline-конфликта двух устройств на одной и той же карточке.
2. **Очистка `TMAOfflineBatch` и правила перехода `LerneStandaloneDB_900001`:**
   - **На сервере:** сейчас `TMAOfflineBatch` растёт бесконечно (`api/services/receipts.py`). В V3 требуется фоновая/админская очистка старых квитанций по TTL (например, старше 30–90 дней для батчей sync/cards-v2, при этом для защиты от сверхдолгих повторов SRS-событий `action_id` следует сохранять в `TMAReviewHistory.action_id` с уникальным индексом `(user_id, action_id)` — компактная запись без хранения тяжёлого JSON-ответа в `TMAOfflineBatch`).
   - **На клиенте (`LerneStandaloneDB_900001`):** в текущем `offlineApi.js:407-421` для standalone-БД при каждой оценке удаляются все `review:*` и сохраняются только 64 последних `grade:*`. В V3:
     - при включении нового локально-первого режима записи `review:*` **перестают удаляться**, пока не будут подтверждены сервером (либо для полностью автономного «гостевого» режима без аккаунта хранятся до явного подключения аккаунта, с разумным лимитом/архивацией);
     - уже существующий прогресс в `LerneStandaloneDB_900001`, накопленный до обновления на V3 (без ключей `review:*`), переносится при однократном связывании аккаунта через явную процедуру миграции (см. D11.2).

---

## D8. Синхронизация медиа

### D8.1. Единая контент-адресация (SHA-256) и устранение дублирования изображений

Текущее состояние ([LOCAL_FIRST_V3_AUDIT_BASELINE.md §5.2](./LOCAL_FIRST_V3_AUDIT_BASELINE.md)):
- Аудио в облаке и локально уже адресуется по SHA-256 (`audio_<sha256>.mp3` и `archive_<sha256>.mp3`).
- Изображения локально адресуются по SHA-256 (`archive_<sha256>.webp`/`.png`), а в облаке (`api/routers/media.py:162`) генерируется случайное имя `upload_<user_id>_<12hex>.webp` **без контентной дедупликации**.
- Видео/фоны всё ещё хранятся и раздаются как BLOB из столбца `TMAMedia.content` в PostgreSQL (`api/routers/media.py:636-656`).

**Целевая модель медиа V3:**
1. **Единое SHA-256 именование для всех новых/синхронизируемых ассетов:**
   - Локально: `archive_<sha256>.<ext>` (без изменений формата `OfflineMaterialArchivePlugin` и ZIP v4).
   - В облаке: `audio_<sha256>.<ext>` (bucket `audio`), `img_<sha256>.webp` (bucket `images`, после `optimize_image` на клиенте или сервере; старые `upload_<user_id>_<12hex>.webp` сохраняются для обратной совместимости чтения без принудительной перегенерации).
   - **Прямая выгода:** две одинаковые картинки или два клона колоды больше не плодят дубликаты в Supabase Storage и не скачиваются повторно под разными URL.
2. **Отказ от раздачи BLOB из PostgreSQL (`TMAMedia.content`):**
   - Новые видео/фоны/изображения загружаются только в Object Storage (либо остаются локально в `archive_<sha256>`), а для существующих записей в `TMAMedia.content` предусматривается постепенный перенос в Storage (за рамками критического пути V3, через `lerne-admin` / скрипт миграции) без траты egress БД через FastAPI.

### D8.2. Протокол передачи только отсутствующих файлов (Missing-Only Check-Before-Transfer)

Вместо безусловной загрузки файлов при создании карточки или скачивания всех медиа при каждом pull:
1. **Upload при синхронизации (`Push Media` до `Push Cards`):**
   - Клиент собирает уникальные локальные ссылки `archive_<sha256>.<ext>` из грязного outbox карточек (которые ещё не имеют облачного подтверждения в `syncState`).
   - Вызывает пакетный **`POST /api/media/check-missing`** с массивом `{ folder, sha256, ext, size }`.
   - Сервер одним запросом проверяет наличие соответствующих объектов (`audio_<sha256>.<ext>` / `img_<sha256>.<ext>`) в `TMAMedia` / `storage.objects` и возвращает только список **отсутствующих** SHA-256 (и при наличии — канонические URL уже существующих).
   - Клиент загружает **только** отсутствующие файлы (`POST /api/media/upload-asset` или прямой signed upload URL в Supabase Storage — см. **Блок 5 в D12**), после чего в outbox карточки записываются канонические облачные ссылки (`audio_<sha256>.<ext>` / `img_<sha256>.<ext>`) либо локальные `archive_<sha256>.<ext>` отправляются в `POST /api/cards/batch-sync`.
   - **Контракт ACK `batch-sync`:** при серверной нормализации локальных ссылок `archive_<sha256>.*` внутри `content_v2` или медиаполей карточки в облачные `audio_<sha256>.*` / `img_<sha256>.*`, ответ (ACK) `batch-sync` **возвращает нормализованный `content_v2` и пересчитанный `revision`** (`api/services/structured_card_api.py:221`), которые клиент сохраняет в Dexie — это исключает ложный `409 card_revision_conflict` при следующем редактировании той же карточки.
   - Валидатор сервера (`validate_new_audio_paths`, а также аналогичная проверка для изображений) гарантирует, что ни одна карточка в PG не сошлётся на незагруженный медиафайл.
2. **Download при синхронизации / открытии колоды (`Pull Media`):**
   - Клиент проверяет список SHA-256, требуемых для активных/выбранных для офлайна колод, против локального индекса (`offline-media:*` / OPFS / `database.media`).
   - **Разрешение облачных имён по локальному SHA-256:** `app/src/pilot/offlineMediaResolver.js` (`CANONICAL_ASSET_NAME_RE` на `L5` и `resolveOfflineMediaUrlSync` на `L127`, где сейчас допускается только `^archive_[a-f0-9]{64}\.[a-z0-9]{2,4}$`) и общий `MediaStoreAdapter` расширяются так, чтобы облачные имена `audio_<sha256>.*` и `img_<sha256>.*` разрешались в уже имеющийся локальный файл `archive_<sha256>.*` по SHA-256 без повторного скачивания из сети.
   - Скачиваются **только отсутствующие** хэши (при этом загрузка медиа может быть настроена пользователем: только для колод с флагом «Доступно офлайн» / «Мои колоды» или по требованию при открытии, чтобы не скачивать гигабайты ненужных курсов на слабом канале).

### D8.3. Гарантии целостности и закрытие окон сбоя

Из [ANDROID_UPGRADE_AND_DATA_SAFETY.md §3](./ANDROID_UPGRADE_AND_DATA_SAFETY.md) переносятся следующие обязательные меры:
1. **Сохранение атомарной записи на Android:** `OfflineMaterialArchivePlugin.java` продолжает писать в `.partial`, вызывать `fsync`, проверять длину, SHA-256 и бинарные заголовки (`BitmapFactory`, MP3/WAV/OGG/FLAC/M4A, MP4/WebM) и очищать зависшие `*.partial` и staging при старте.
2. **Закрытие окна сбоя `localMediaWriter.js:50-60`:**
   - Сейчас между `storeMediaAsset` (диск) и `database.syncState.put(metaRecord)` (IndexedDB) есть окно сбоя питания, при котором отсутствие записи `offline-media:*` ломает экспорт ZIP (`Отсутствуют метаданные локального медиафайла`).
   - **Решение V3:** при старте приложения (или перед экспортом архива при промахе ключа `offline-media:*`) `offlineMediaStore.js` вызывает метод инспекции нативного плагина (`listMediaAssets` / `statMediaAsset`) для проверки фактического файла `archive_<sha256>.<ext>` на диске и **автоматически восстанавливает** недостающую запись `offline-media:*` в `syncState` с перепроверкой SHA-256.
3. **Закрытие окна сбоя импорта ZIP (`materialArchive.js:1051`, `mediaInTransaction: false`):**
   - При откате Dexie-транзакции после `commitMedia` файлы остаются на диске как неопасный мусор; благодаря идемпотентности по SHA-256 повторный импорт проходит корректно, а лишние файлы убираются безопасным локальным сборщиком.

### D8.4. Безопасный локальный GC и сохранение облачного аудио

- **На клиенте (ручной или при простое, вне транзакций импорта/сохранения):**
  - Маркируются все SHA-256, на которые ссылаются: (1) активные карточки и колоды, (2) карточки и колоды в локальной корзине (`is_deleted: true`), (3) незавершённые операции `syncState` outbox.
  - Файлы `archive_<sha256>.*` (или строки `database.media` в Web), отсутствующие в маркированном множестве дольше контрольного окна, безопасно удаляются; в Web дополнительно вводится LRU-квота и `URL.revokeObjectURL`.
- **В облаке:** автоудаление объектов в бакете `audio` при удалении карточки **строго запрещено** (см. D5.3); серверная/админская очистка остаётся контролируемым инструментом в `lerne-admin`.

---

## D9. Библиотека и права доступа

Анализ опирается на [LOCAL_FIRST_V3_AUDIT_BASELINE.md §5.2, §6.4](./LOCAL_FIRST_V3_AUDIT_BASELINE.md) и код `api/services/collaborative_service.py`, `api/services/library_import.py`, `api/routers/share.py`, `api/routers/media.py`, `lerne-admin/src/lerne_admin/services/material_transfer.py`, `lerne-admin/src/lerne_admin/services/material_archive.py`.

### D9.1. Разделение `scope='library'` и `access_scope='global_readonly'` + `TMA_Collaborator`

В системе существуют два ортогональных механизма распространения материалов:

| Механизм | Модель данных и владельцы | Текущий поток работы | Выявленные проблемы в контексте V3 |
| --- | --- | --- | --- |
| **1. Каталог шаблонов (`scope='library'`)** | `TMA_Deck.scope='library'`, `user_id=NULL`, `folder_id=NULL`, `category_id -> library_category` (ограничение `tma_deck_scope_owner_check`, миграция 96) | Анонимное чтение каталога через `GET /decks/external` + клонирование в личную `scope='personal'` колоду (`POST /decks/external/import/{id}` -> `library_import.py`) | 1) Детекция обновлений (`get_library_update_sources`, `sync_deck_with_library`) сравнивает колоды по `TMA_Deck.name == local.name`, хотя `import_deck` сохраняет `metadata['source_library_id']`.<br>2) `lerne-admin/src/lerne_admin/services/material_transfer.py` не переносит `scope='library'` (поля `scope`, `category_id`, `is_default` исключены из `FIELDS['deck']`, а `get_effective_user_role` возвращает `None` для `scope != 'personal'`). |
| **2. Официальные/общие папки (`access_scope='global_readonly'` и `TMA_Collaborator`)** | `TMA_Folder.access_scope='global_readonly'` (всё поддерево); либо приватная папка/колода с таблицей `TMA_Collaborator` (`owner`/`editor`/`viewer`, `can_edit_audio`) | Карточки остаются `scope='personal'` у автора/админа. Каждый пользователь получает персональный `TMAProgress`, `TMASetting` (`DECK_LEARNING_*`), `TMACardNote`, `TMACardRating`, `flag`. | 1) `get_user_accessible_folder_ids` (`collaborative_service.py:1018`) **принудительно включает все `global_readonly` папки в `/sync/v2/pull` каждого пользователя**.<br>2) При росте числа официальных курсов каждый pull/изменение курса инвалидирует `content_version` всем пользователям платформы и выгружает мегабайты ненужных курсов. |

### D9.2. Предотвращение обязательной загрузки всех `global_readonly` в каждый `/sync/v2/pull`

**Целевое решение V3:**
1. **Явная подписка (opt-in) на официальные/глобальные папки:**
   - Вместо автоматической загрузки всех `global_readonly`-веток всем пользователям при каждом `/sync/v2/pull`:
     - Пользователь видит каталог официальных курсов (`GET /api/decks/external` или лёгкий список доступных `global_readonly` корневых папок/описаний без карточек).
     - В `/sync/v2/pull` включаются только: (а) личные папки/колоды пользователя, (б) папки/колоды из `TMA_Collaborator`, (в) `global_readonly` корни, на которые пользователь явно подписался («Добавить к себе / Скачать для изучения» — хранится в `TMASetting` или легковесной таблице подписок, плюс `default` стартовый набор при первом входе, если требуется).
   - **Эффект:** редактирование официального курса на 3 000 карточек затрагивает дельту только подписчиков этого курса, не раздувая базу Android/Web и egress для остальных пользователей (см. также **Блок 6 в D12**).
2. **Исправление связки с `scope='library'`:**
   - Сопоставлять обновления импортированных из библиотеки колод в первую очередь по `metadata.source_library_id` (с fallback по `name` только для legacy-импортов).
   - В `lerne-admin`: согласовать перенос `scope='library'` и `access_scope='global_readonly'` между `lerne-admin/src/lerne_admin/services/material_transfer.py` и `lerne-admin/src/lerne_admin/services/material_archive.py` (без автоматического смешивания с пользовательским SRS).

### D9.3. Устранение пробелов ACL, `share/import` и багов коллаборации

1. **`GET /api/media/*` и публичные бакеты Supabase Storage (`api/routers/media.py:484-656`):**
   - **Факт:** все 4 маршрута чтения (`/audio/*`, `/images/*`, `/videos/*`, `/backgrounds/*`) не имеют `Depends(get_user_id)` и не проверяют `get_effective_user_role`. Более того, `get_audio` и `get_image` отдают `307` Redirect на публичные URL Supabase `/storage/v1/object/public/...`, а Web-клиент (`getAudioUrl`) часто обращается к CDN напрямую.
   - **Архитектурный компромисс (анализируется в Блоке 5, D12):**
     - Необходимо различать *приватные пользовательские медиа* (которые не должны быть доступны по перечислению/утечке имени, особенно с учётом `upload_<user_id>_<12hex>`) и *публичные/общие медиа* (`global_readonly`, `scope='library'`, `share_id`).
     - При переходе на `sha256` имена (`audio_<64hex>`, `img_<64hex>`) перебор по ID пользователя исчезает (256-битная энтропия при знании точного контента), однако для полноценного ACL по закрытым колодам требуется либо: (а) аутентификация + проверка доступа на `GET /api/media/*` с выдачей короткоживущих **Supabase Signed URLs** (`createSignedUrl`) для приватных бакетов (минимальный egress через Vercel!), либо (б) сохранение публичного чтения только для `library`/`global_readonly`/`share` медиа с криптостойкими ключами. Оценка стоимости операций Supabase Storage для signed URLs дана в D12 Блок 5.
2. **`POST /api/share/import` и `GET /api/share/info/{share_id}` (`api/routers/share.py`):**
   - Работают по токену `share_id` (`d_...`/`f_...`) без предварительного членства в `TMA_Collaborator` — это ожидаемая механика публичной ссылки-приглашения. Необходимо явно документировать этот контракт (ссылка `share_id` = capability token на клонирование/просмотр), добавить rate-limit на `share/info` и гарантировать отзыв при сбросе/удалении `share_id`.
3. **Баг в `useCollaborativeStore.js:82`:**
   - Исправить URL с `/collaborative/folder/${folderId}/progress` на фактический серверный маршрут `/collaborative/folder/${folderId}/group-progress` (`api/routers/collaborative.py:164`).
4. **Согласованность `canEdit` в UI (`DeckIntro.jsx:71-73`):**
   - Убедиться, что UI-флаги на клиенте полностью совпадают с `_require_can_mutate` / `can_edit_audio` на сервере (включая `can_edit_audio` для `viewer`, которым разрешена только генерация аудио).

---

## D10. Web Offline

Согласно [LOCAL_FIRST_V3_AUDIT_BASELINE.md §5.1](./LOCAL_FIRST_V3_AUDIT_BASELINE.md) и исходному коду (`app/index.html:5-7`, `app/src/main.jsx:13-17`, `app/src/services/mediaCache.js`, `vercel.json:20-33`), текущий Web/TMA-клиент не имеет ни одного механизма устойчивой офлайн-загрузки и защиты от вытеснения данных.

### D10.1. Риски вытеснения (Eviction) в браузерах и Telegram WebView

| Среда выполнения | Механизм и порог вытеснения | Риски для Lerne Web / TMA |
| --- | --- | --- |
| **Safari / iOS WKWebView (в т.ч. Telegram iOS)** | WebKit ITP / Intelligent Tracking Prevention: очищает всю script-writable память (`IndexedDB`, `localStorage`, `CacheStorage`, `OPFS`) после **7 дней** без взаимодействия с сайтом как top-level документом (если приложение не установлено на экран «Домой» как PWA). В WebView внутри Telegram период очистки может быть ещё агрессивнее. | Потеря локальных несинхронизированных карточек, SRS-оценок `review:*` и кеша медиа, если пользователь заходил в Web/TMA реже раза в 7 дней до нажатия Sync. |
| **Chrome / Edge / Android WebView (в т.ч. Telegram Android)** | Best-effort origin LRU eviction: при нехватке места на устройстве (свободно < ~10–20% или превышение квоты origin) браузер молча удаляет весь origin целиком (включая IndexedDB) без предупреждения, если не получен `persisted` статус. | Молчаливый сброс `LerneLocalDB_<userId>` и несинхронизированных правок при переполнении диска или кеша медиа (`150 MB`). |
| **Telegram Mini App (оба ОС)** | WebView управляется клиентом Telegram и может иметь собственные лимиты кеша и политику очистки данных WebApp. | Невозможность гарантировать сохранность длительной офлайн-очереди наравне с нативным APK. |

### D10.2. Защита квоты и информирование пользователя (`persist()` + `estimate()`)

1. При инициализации Web-клиента (после авторизации/первого действия пользователя) вызывать `navigator.storage.persisted()` и запрашивать `navigator.storage.persist()` (для установленного PWA и Chrome это переводит origin в статус `persisted`, защищённый от LRU eviction).
2. Периодически (при открытии профиля / перед скачиванием колоды в офлайн) вызывать `navigator.storage.estimate()`:
   - отображать в настройках реальный статус защиты (`Persistent: Да / Нет (риск очистки браузером)`), занятый объём и квоту;
   - при наличии несинхронизированных записей в outbox (`review:*`, `card-*-v2:*`) и отсутствии `persisted=true` (особенно на Safari/iOS/Telegram) показывать явный ненавязчивый индикатор: **«Есть несинхронизированные изменения — нажмите Синхронизировать, чтобы не потерять данные при очистке браузера»** и предоставлять возможность скачать JSON/ZIP-бэкап прямо в Web.

### D10.3. Service Worker / Workbox и App Shell против `index.html` `no-cache` и `vite:preloadError`

Текущие препятствия в коде:
- `app/index.html:5-7` содержит `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />`;
- `app/src/main.jsx:13-17` при `vite:preloadError` вызывает `window.location.reload()`, что в офлайне приводит к белому экрану ошибки сети;
- `vercel.json:20-33` не настраивает заголовки кеширования и маршрутизацию SW/манифеста.

**Проектирование App Shell для Web/TMA:**
1. Подключить `vite-plugin-pwa` (Workbox `generateSW` или `injectManifest`) для генерации `sw.js` и `manifest.webmanifest` (иконки уже в `app/public/`).
2. **Стратегия кеширования:**
   - Версионированные ассеты сборки (`/assets/*.js`, `/assets/*.css`, локальные шрифты `app/public/fonts/*.woff2`) — `CacheFirst` / precache (именно они решают проблему офлайн-загрузки ленивых чанков и убирают цикл падения `vite:preloadError` при offline-навигации).
   - Навигационный документ `index.html` — `NetworkFirst` (с коротким таймаутом и fallback на кешированный App Shell из precache) вместо полного запрета кеширования, при этом `sw.js` отдаётся с `Cache-Control: no-cache` для быстрого обновления релизов на Vercel.
   - **API-запросы (`/api/*`) и авторизация (`/api/auth/*`):** **строго `NetworkOnly` в SW** — кэширование бизнес-данных целиком остаётся в Dexie, чтобы SW никогда не возвращал устаревшие/чужие ответы API при смене аккаунта или ревизии.
   - При наличии `vite:preloadError` в офлайне (`!navigator.onLine`) не перезагружать страницу в бесконечный цикл, а показывать корректный fallback или сообщение о необходимости обновления при появлении сети.
3. **Разделение сред:** Service Worker **не регистрируется** в Capacitor Android APK (`IS_STANDALONE` / `Capacitor.isNativePlatform()`), так как ассеты APK уже упакованы локально в `assets/public/`.

### D10.4. OPFS vs IndexedDB для медиа в Web и границы применимости Web Offline

- **Текущая проблема:** `mediaCache.js` складывает `Blob` в IndexedDB `database.media` (`150 MB` без LRU, полный обход `each()`, без SHA-256 и без `URL.revokeObjectURL`), а `offlineMediaStore.js` при `!IS_STANDALONE` отключён.
- **Выбор Web-хранилища медиа (см. Блок 7 в D12):**
  - **IndexedDB (`database.media`)** работает везде (включая старые WebView и Telegram iOS), но сериализация крупных `Blob` тормозит главный поток и раздувает транзакции Dexie.
  - **OPFS (`navigator.storage.getDirectory()`)** обеспечивает быструю файловую запись/чтение с минимальными накладными расходами памяти, но требует аккуратного fallback на IndexedDB в WebView/браузерах без OPFS или без `createSyncAccessHandle` в основном потоке (асинхронный `FileSystemFileHandle.createWritable()` поддерживается в современных Chrome/Safari, но в некоторых встроенных WebView ограничен).
- **Реалистичная граница Web/Telegram Offline:**
  - Web и Telegram Mini App в V3 получают **полноценный локальный SRS, редактирование карточек и App Shell для работы при кратковременном или плановом отсутствии сети** (поезд/самолёт), плюс контролируемый кэш медиа для выбранных/недавних колод с LRU-квотой.
  - Однако из-за архитектурных ограничений браузеров (ITP 7 дней на iOS, отсутствие прямого доступа к ФС устройства, лимиты WebView) **долговременным первичным офлайн-хранилищем для многосотенных медиаархивов (до 512 МБ+) остаётся Android APK**.

---

## D11. Миграции и совместимость

### D11.1. Миграции схемы Dexie (`v5 -> v6+`)

В `app/src/services/localDb.js:99-128` версии `v1`–`v5` объявлены только через `.stores(...)`, и в коде полностью отсутствуют `versionchange` / `blocked` обработчики.

**Обязательные правила эволюции схемы V3 (`v6+`):**
1. **Жизненный цикл соединения (`localDb.js`):**
   - Зарегистрировать `db.on('versionchange', () => { db.close(); ... })` (с уведомлением активных хранилищ/переоткрытием при необходимости) и `db.on('blocked', ...)` (логирование и предупреждение пользователя, если открыта вторая вкладка с устаревшей версией).
2. **Идемпотентные `.upgrade(tx => ...)`:**
   - Каждое добавление полей/таблиц (например, индексы синхронизации, таблица `media_meta` с SHA-256 и `last_accessed_at` для LRU, поля `client_origin_key` / `sync_status`) должно быть **идемпотентным** (безопасным при повторном запуске после прерванной миграции) и сохранять все существующие `cards`, `decks`, `folders`, `progress`, `card_notes`, `syncState`.
   - Никаких разрушительных `delete` таблиц без переноса данных.
3. **Запрет смены имени существующей БД без мигратора:**
   - Для Web/TMA сохраняется имя `LerneLocalDB_<userId>`.
   - Для Android APK при переходе со Standalone `900001` на привязанный аккаунт `<userId>` данные не теряются (см. D11.2).

### D11.2. Безопасная миграция `LerneStandaloneDB_900001` при подключении аккаунта V3

Согласно [ANDROID_UPGRADE_AND_DATA_SAFETY.md §3](./ANDROID_UPGRADE_AND_DATA_SAFETY.md), в текущем `LerneStandaloneDB_900001` накопленные локально карточки имеют `id > 1_000_000`, `is_dirty: 0`, флаг `standalone_local_edit`/`standalone_local_created`, а у оценок SRS удалены `review:*` и сохранено не более 64 `grade:*`.

**Контракт однократной управляемой миграции (подробнее варианты в Блоке 3, D12):**
1. **Пока пользователь не подключил облачный аккаунт на Android:** приложение продолжает работать в локальном профиле (под `LerneStandaloneDB_900001` или гостевом профиле) с **0** сетевых вызовов.
2. **При первом входе/подключении аккаунта `userId` на Android** запускается транзакционная однократная миграция (с созданием маркера `standalone_migrated_to:<userId>` и без удаления исходной БД до подтверждения переноса):
   - **Материалы (папки, колоды, карточки):**
     - Встроенный стартовый пак (`standaloneSeed`) сопоставляется по стабильному ключу (`standalone_deck_key` / `standalone_card_key`), а не перезаписывает изменения с `standalone_local_edit: true`.
     - Локально созданные и импортированные карточки (`id >= 1_000_000` или `standalone_local_created`) переносятся в `LerneLocalDB_<userId>` (или получают новый локальный статус `is_dirty: 1` + запись в outbox `card-create-v2:` / `card-edit-v2:` с сохранением `standalone_origin_key`), чтобы не столкнуться с серверными ID `> 0` других пользователей.
   - **Прогресс SRS (где `review:*` отсутствуют):**
     - Существующие строки `db.progress` для `900001` переносятся под новый `userId`.
     - **Обязательная перепривязка `card_id` перед отправкой `baseline_progress`:** строки `db.progress` встроенного стартового пака (`app/src/pilot/standalonePack.js:11-36,68`, где используются синтетические локальные ID `910101..910308` от `cardIdBase` `910100`/`910200`/`910300`, не совпадающие с серверными `TMA_Card.id`) и импортированных/локальных карточек (`id >= 1_000_000`) **никогда не отправляются с исходным локальным `card_id`**; перед формированием `baseline_progress` они перепривязываются по `standalone_card_key` (сопоставление с серверными карточками стартового/импортированного пака) или через `aliases` (из `mappings` после отправки `card-create-v2:`) к каноническому серверному `TMA_Card.id`.
     - Так как исторические `review:*` в standalone удалялись, при первом `push` в облако (уже после перепривязки `card_id`) разрешается однократный режим **инициализации базового прогресса** (`initial_import_progress` / `baseline_progress`, только если на сервере для данной карточки у этого пользователя ещё нет `TMAProgress` — иначе применяются правила разрешения конфликта с выбором пользователя «Объединить / Оставить локальный / Оставить облачный»).
   - **Медиа (`lerne-offline-media/`):** файлы `archive_<sha256>.*` контент-адресуемы и не привязаны к `user_id` в пути — они мгновенно переиспользуются без копирования; метаданные `offline-media:*` индексируются в новой БД.
   - **Настройки (`localStorage`):** `STUDY_STORAGE_MAP`, `AUTOPLAY_STORAGE_MAP` и `lerne:personal-design:v2:900001` копируются в пространство аккаунта `<userId>`.

### D11.3. Подпись Android APK, `versionCode`, `allowBackup` и преемственность WebView

Все требования из [ANDROID_UPGRADE_AND_DATA_SAFETY.md §2–3](./ANDROID_UPGRADE_AND_DATA_SAFETY.md) закрепляются как обязательные инварианты:
1. **Неизменные идентификаторы (R1/R3):**
   - `namespace = "com.lerne.app"`, Java `package com.lerne.app`, `applicationId = "com.lerne.offlinepilot"`, `capacitor.config.json:server.androidScheme = "https"` (origin `https://localhost`). Изменение любого из этих полей отрезает WebView от существующих IndexedDB и `localStorage`.
2. **Стабильная подпись (`signingConfigs`) и контроль в `lerne-admin`:**
   - В `tma/android/app/build.gradle` добавляется `signingConfigs` с чтением keystore/alias/паролей из переменных окружения или локального файла вне Git (`LERNE_KEYSTORE_PATH`, `LERNE_KEYSTORE_ALIAS`, `LERNE_KEYSTORE_STORE_PASS`, `LERNE_KEYSTORE_KEY_PASS`).
   - В `lerne-admin/src/lerne_admin/services/android_build.py` (`inspect_apk_file`, `L954-1032`) добавляется сверка публичного `signer_sha256` и монотонного `version_code` с предыдущим выпущенным артефактом и режим **fail-closed** (отказ собирать релизный/пользовательский APK случайным эфемерным ключом при отсутствии конфигурации подписи).
3. **Монотонный `versionCode`:**
   - Единый отслеживаемый файл `tma/android/version.properties` (`VERSION_CODE`, `VERSION_NAME`), устраняющий fallback `1` в `build.gradle:13` и упрощающий парсинг в `lerne-admin`.
4. **Android Auto Backup:**
   - В `tma/android/app/src/main/AndroidManifest.xml:6` заменить `android:allowBackup="true"` на `android:allowBackup="false"` (либо явные `dataExtractionRules` / `fullBackupContent`, полностью исключающие `app_webview/` и `lerne-offline-media/`), чтобы 25-МБ лимит Google Auto Backup никогда не восстанавливал `LerneStandaloneDB` / `LerneLocalDB` частично без медиафайлов или в устаревшую версию `syncState`.

### D11.4. Совместимость `STANDALONE_PACK_VERSION` и форматов JSON / ZIP

1. **Эволюция `standalonePack.js`:** запрещено изменять/удалять/переименовывать встроенные `card_id`/`cardKey` без увеличения `STANDALONE_PACK_VERSION` и таблицы совместимости старых ключей, чтобы прежние JSON-бэкапы не получали `PACK_MISMATCH` / `CARD_IDENTITY_MISMATCH`.
2. **Расширение форматов резервного копирования в V3:**
   - Сохраняется обратная совместимость импорта существующих `lerne-offline-progress-backup` (`schema_version=1`, `full-v1`, `full-v2`) и архивов `lerne-materials` версий `2, 3, 4`.
   - При добавлении в будущем в JSON-бэкап настроек (`STUDY_STORAGE_MAP`, `lerne:personal-design:v2:*`) и режима безопасного слияния прогресса вводится `schema_version = 2` (или `scope = 'full-v3'`) с сохранением чтения `schema_version = 1`.
   - Формат `archive_<sha256>.<ext>` и `manifest.sha256` в ZIP сохраняется полностью.

### D11.5. Матрица защиты будущих пользовательских данных по сценариям R3

| Сценарий сбоя (R3) | Целевой механизм защиты в V3 |
| --- | --- |
| **Обновление APK (`v1 -> v2`)** | Единый постоянный `signingConfig` + проверка `signer_sha256` в `lerne-admin` + монотонный `versionCode` + неизменные `applicationId`/`androidScheme` + `allowBackup="false"`. |
| **Миграции IndexedDB (`v5 -> v6+`)** | `versionchange` (`db.close()`), `blocked`, идемпотентные `.upgrade(tx)`, прогон тестов миграции с сохранением данных. |
| **Сбой записи / отключение питания** | `.partial` + `fsync` + `renameTo` (диск), атомарные Dexie-транзакции (БД), самовосстановление `offline-media:*` при старте по фактическим файлам (закрытие окна `localMediaWriter.js:50-60`). |
| **Прерывание синхронизации / повторы** | Порядок фаз outbox -> pull, `TMAOfflineBatch` квитанции по `request_id` и `action_id`, удержание `review:*` в outbox до подтверждения сервера, идемпотентный media check-missing. |
| **Несколько устройств** | Event-sourced SRS по `action_id` (без слепого LWW), CAS `revision` с `409` и ручным выбором при конфликте карточки, опциональный merge при импорте JSON-бэкапа. |
| **Восстановление бэкапов** | SHA-256 целостность ZIP/JSON, защита `standalone_local_edit` при реимпорте пака, обратная совместимость `full-v1`/`full-v2` и ZIP v2–v4, включение настроек в бэкап v2. |
| **Конфликты Android / Web** | Единая модель outbox и `revision` CAS, разделение потоков материалов и SRS, сохранение обеих версий карточки при `409` до решения пользователя. |

---

## D12. Анализ архитектурных вариантов

Ниже представлены **8 ключевых архитектурных блоков**. По каждому блоку рассмотрены **2–3 реалистичных варианта**, проведено сравнение по пяти критериям и сформулирована **неутверждённая рекомендация** для рассмотрения владельцем проекта в разделе D13.

---

### Блок 1. Транспорт и протокол синхронизации материалов (`/sync/v2/*` vs замена, дельта и батчинг)

- **Вариант 1A — Расширение `/sync/v2/*` (Cursor Delta Pull + Batch V2 Card Push + Оптимизация `unchanged`):**
  Добавление опционального `cursor` (`sync_seq`/`updated_at`) в `GET /api/sync/v2/pull` (с fallback на `full` при смене поколения/ACL), пакетной отправки V2-карточек (`POST /api/cards/batch-sync` или внутри `/sync/v2/push`) и оптимизация auth/folder_map/generation в `offline_sync.py`. Существующие инварианты (`TMAOfflineBatch`, `revision` CAS, `aliases`, `applySnapshot`) сохраняются.
- **Вариант 1B — Полная замена синхронизатора на новый универсальный протокол (например, CRDT / CouchDB-подобный репликатор или PowerSync/ElectricSQL):**
  Отказ от `/sync/v2/*`, внедрение новой внешней библиотеки/сервера репликации или переписывание всех клиентских очередей и серверных эндпоинтов на общий поток изменений.
- **Вариант 1C — Минимальный патч текущего `/sync/v2/*` (только отключение авто-таймеров и оптимизация 26 SQL `unchanged`, без дельта-pull и без батчинга карточек):**
  Оставляем полный снимок на любое изменение (`205 KB+`) и 1-by-1 `POST /cards/save` / `PATCH /cards/{id}`, меняя только ручной запуск и кэш/запросы на `unchanged`.

| Критерий | Вариант 1A (Расширение `/sync/v2`) | Вариант 1B (Замена / CRDT) | Вариант 1C (Только отключение поллинга) |
| --- | --- | --- | --- |
| **Сложность реализации** | Средняя (переиспользует 85%+ кода `offline_sync.py` и `syncService.js`) | Очень высокая (новая инфраструктура, риск регрессий) | Низкая |
| **Нагрузка на Vercel/Supabase free-tier** | **Минимальная** (дельта в КБ вместо полного снимка, 1 batch HTTP вместо N, ~4–6 SQL на `unchanged`) | Неопределённая / высокая (требует логической репликации PG или доп. сервисов) | Высокая при частых правках (полный дамп + N запросов при создании пачки карточек в офлайне) |
| **Сохранность данных и корректность** | Высокая (сохраняет проверенные `TMAOfflineBatch`, CAS `revision`, `aliases`) | Риск потери отлаженных гарантий ACL и `TMA_Card` CAS | Высокая, но N+1 запросы после офлайна чаще падают по таймауту |
| **UX и офлайн-готовность** | Быстрый ручной Sync за ~1–2 HTTP-запроса | Зависит от новой библиотеки | Медленный Sync на больших колодах и после пакетного создания карточек |
| **Обратимость** | Высокая (`cursor` опционален, полный pull сохраняется как fallback) | Низкая | Высокая |

**Рекомендация (на утверждение владельца — НЕ утверждена):** **Вариант 1A** — расширяет проверенный `/sync/v2/*` без риска переписывания, резко сокращает SQL, трафик и число вызовов Vercel Functions (особенно в паре с ручной синхронизацией).

---

### Блок 2. Модель синхронизации SRS и разрешение конфликтов

- **Вариант 2A — Event-sourced SRS с UUID `action_id` + сохранение событий до ACK + гибридный Causal/Replay:**
  Материалы и SRS синхронизируются раздельно. Клиент всегда шлёт `reviews[]` с `action_id` (не удаляя их до подтверждения сервера), сервер обеспечивает дедупликацию через `TMAOfflineBatch` + `TMAReviewHistory.action_id` (unique). При нормальном порядке (`review_time >= server.last_reviewed`) сервер применяет `srs.review_card()` поверх актуального состояния под `FOR UPDATE`; если обнаружено опоздавшее офлайн-событие с другого устройства (`review_time < server.last_reviewed`), сервер пересчитывает цепочку `TMAProgress` данной карточки из отсортированной по `review_time` истории `TMAReviewHistory` (от базового снимка/окна). `flag`/`want_to_learn` идут отдельно с `flag_only: true`.
- **Вариант 2B — Только текущий Append-on-Arrival с `action_id` (без пересчёта при out-of-order между устройствами):**
  Оставить текущую логику `offline_sync.py:257-266` как есть (дедупликация `action_id`, сортировка только внутри одного батча, а опоздавшие события другого устройства применяются поверх текущего `TMAProgress` в порядке прихода на сервер). Добавить лишь сохранение `review:*` на Android до ACK и очистку `TMAOfflineBatch`.
- **Вариант 2C — Наивный LWW (Last-Write-Wins) по `updated_at` / `last_reviewed` снимка `TMAProgress`:**
  Сравнивать `progress.last_reviewed` клиента и сервера, перезаписывая поля `interval`/`ease_factor`/`repetitions` более поздним снимком.

| Критерий | Вариант 2A (UUID `action_id` + гибридный Replay) | Вариант 2B (Append-on-Arrival с `action_id`) | Вариант 2C (Наивный LWW по снимку) |
| --- | --- | --- | --- |
| **Сложность реализации** | Средняя (добавляется редкая ветка пересчёта одной карточки при `review_time < last_reviewed`) | Низкая (уже почти реализовано) | Низкая |
| **Нагрузка на Vercel/Supabase free-tier** | Низкая (пересчёт срабатывает только при реальном конкурентном офлайн-изучении 1 карточки на 2 устройствах) | Минимальная | Минимальная |
| **Сохранность данных и корректность** | **Максимальная**: ни одна оценка не теряется, порядок повторений на 2 устройствах детерминирован и честен | Хорошая, но при долгом офлайне устройства A оценка из прошлого применится после провала на устройстве B | **Недопустима**: молчаливо теряет оценки при работе с двух устройств и уязвима к сбою часов |
| **UX и офлайн-готовность** | Предсказуемые интервалы на всех устройствах | Редкое искажение интервала при кросс-офлайне одной карточки | Риск отката прогресса |
| **Обратимость** | Высокая (обратно совместимо с `TMAReviewHistory` и `TMAOfflineBatch`) | Высокая | Высокая, но цена — потеря истории |

**Рекомендация (на утверждение владельца — НЕ утверждена):** **Вариант 2A** — сохраняет существующую инфраструктуру `action_id` и `TMAOfflineBatch`, полностью исключает потерю оценок и даёт корректный порядок интервалов даже при параллельной офлайн-учёбе на Android и Web. Вариант 2C категорически не рекомендуется.

---

### Блок 3. Унификация локальных ID, модели мутаций и миграция `LerneStandaloneDB_900001`

- **Вариант 3A — Единый локальный движок мутаций (отрицательные временные ID + `is_dirty` + единый outbox) + однократный мигратор `900001 -> userId`:**
  Устранить дублирование `standaloneCardStorage.js` и `cardOfflineQueue.js`, оставив одну модель локального создания/редактирования в `offlineApi.js` (как в `cardOfflineQueue.js` с временными отрицательными ID, но работающую и без аккаунта в локальном профиле). В `LerneStandaloneDB_900001` старые карточки с `id >= 1_000_000` сохраняют рабочий доступ до входа в аккаунт, а при первом связывании аккаунта однократно мигрируют: созданные пользователем (`standalone_local_created` / `id >= 1_000_000`) получают локальные `tempId < 0` + outbox `card-create-v2:`, встроенные сопоставляются по `standalone_card_key`, а `progress` без `review:*` переносится в `baseline_progress` (с выбором пользователя при конфликте с облачным прогрессом).
- **Вариант 3B — UUIDv4 / глобальные клиентские ID карточек на клиенте и в PostgreSQL:**
  Отказаться от `SERIAL` `id` и отрицательных `tempId`, переведя `TMA_Card`, `TMA_Deck`, `TMA_Folder`, `TMAProgress` на строковые UUID во всей системе.
- **Вариант 3C — Сохранение двух отдельных движков и двух БД (Standalone навсегда без автомиграции; перенос только через ручной ZIP/JSON экспорт-импорт):**
  Не связывать `LerneStandaloneDB_900001` с облачным аккаунтом напрямую; при появлении синхронизации на Android требовать от пользователя ручного экспорта ZIP+JSON и импорта в новый аккаунт.

| Критерий | Вариант 3A (Единый движок + однократный мигратор `900001`) | Вариант 3B (Переход всей БД на UUID) | Вариант 3C (Ручной ZIP/JSON мост без слияния) |
| --- | --- | --- | --- |
| **Сложность реализации** | Средняя | Очень высокая (миграция всех FK в PG, API, admin, Dexie, архивов) | Низкая |
| **Нагрузка на Vercel/Supabase free-tier** | Низкая | Хуже (больше размер индексов PG и JSON-пакетов) | Низкая |
| **Сохранность данных и корректность** | Высокая (бесшовный переход без потери локальных карточек и SRS) | Риск поломки обратной совместимости API и `lerne-admin` | Средняя (риск ошибок пользователя и потери настроек, не входящих в ZIP/JSON) |
| **UX и офлайн-готовность** | Пользователь просто «входит в аккаунт» на Android и продолжает учиться | Не отличается от 3A, но долгий путь к релизу | Плохой UX (ручные файлы при первом входе, дубликаты при ошибках) |
| **Обратимость** | Высокая (исходная `LerneStandaloneDB_900001` не удаляется до подтверждения миграции) | Крайне низкая | Высокая |

**Рекомендация (на утверждение владельца — НЕ утверждена):** **Вариант 3A** — ликвидирует дублирование `standaloneCardStorage.js` и `cardOfflineQueue.js`, не ломает схему PostgreSQL и `lerne-admin`, и обеспечивает безопасный автоматизированный переход для пользователей Android.

---

### Блок 4. Аутентификация Android, локальная ИИ-генерация и TTS

- **Вариант 4A — Переиспользование `auth_v2` + stateless `/cards/ai-*` (без PG-записи) + разделённый `synthesize_tts_bytes` (`publish=false` по умолчанию для Android):**
  Android использует стандартный `auth_v2` (Email/Password или внешний OAuth/Telegram challenge с возвратом в приложение), вызывает существующие `/cards/ai-generate` и `*-batch` (без `deck_id`), а для TTS — рефакторинг `audio.py` с новым/флаговым stateless-маршрутом, отдающим сырые MP3-байты для сохранения в `archive_<sha256>.mp3` локально. Публикация аудио в Storage откладывается до Sync/Share. Для `evaluate-answer` и `classify-batch` на несинхронизированных карточках добавляется явный stateless-режим по `content_v2` (только для локальных черновиков) либо подсказка синхронизировать колоду.
- **Вариант 4B — Гибридный «анонимный/device-token» доступ к ИИ и TTS без аккаунта:**
  Выдавать APK анонимные токены устройства для вызова ИИ/TTS без входа в `auth_v2`.
- **Вариант 4C — Обязательное сохранение ИИ-карточек и TTS в PG/Storage на сервере с последующим pull на Android:**
  Сохранить жёсткую сцепку `generate_audio` с Supabase Storage и требовать создания серверной колоды/карточки перед ИИ-генерацией или TTS.

| Критерий | Вариант 4A (`auth_v2` + stateless ИИ/TTS + локальное сохранение) | Вариант 4B (Анонимный device-token) | Вариант 4C (Обязательная запись в PG/Storage) |
| --- | --- | --- | --- |
| **Сложность реализации** | Низкая–средняя (переиспользует 90% существующего кода `ai.py`, `auth_v2.py` и образец `voice-preview` в `lerne-admin`) | Средняя (нужна защита от накрутки ботами/эмуляторами) | Низкая |
| **Нагрузка на Vercel/Supabase free-tier** | **Минимальная** (0 PG-записей и 0 Storage-записей для черновиков и локального TTS; снятие `require_generation` экономит 3 SQL на запрос) | Высокий риск исчерпания квот LLM анонимными запросами | Высокая (каждая проба TTS мусорит в Supabase Storage и требует проверки `TMA_Card`) |
| **Сохранность данных и корректность** | Высокая (ключи ИИ только на сервере, локальный результат сразу в Dexie и `lerne-offline-media/`) | Средняя (сложнее привязать лимиты и аудит к пользователю) | Противоречит R7.2 (требует сервер для локального создания карточки) |
| **UX и офлайн-готовность** | Работает сразу на локальных колодах без предварительного полного sync | Удобно без логина, но опасно для квот | Плохой UX (нельзя сгенерировать карточку/озвучку в несинхронизированной локальной колоде) |
| **Обратимость** | Высокая (существующие эндпоинты для Web сохраняют совместимость) | Средняя | Высокая |

**Рекомендация (на утверждение владельца — НЕ утверждена):** **Вариант 4A** — строго соответствует R7.2, R7.4 и R7.5: ключи на сервере, zero mandatory PG/Storage writes на ИИ/TTS, защита квот авторизованным аккаунтом `auth_v2`.

---

### Блок 5. Синхронизация медиа, SHA-256 дедупликация, egress и ACL (`GET /api/media/*`)

- **Вариант 5A — Единая SHA-256 адресация (`img_<sha256>.webp`, `audio_<sha256>.mp3`) + пакетный `check-missing` + разделение ACL (Signed URLs для приватных колод / CDN для официальных) + запрет автоудаления аудио:**
  При синхронизации клиент сначала проверяет отсутствующие SHA-256 через `POST /api/media/check-missing`, загружает только новые файлы напрямую в Storage (через signed upload URL) или через `/api/media/upload-asset`, а затем ссылается на них в `batch-sync`. Для защиты приватных пользовательских медиа `GET /api/media/*` требует `Depends(get_user_id)` и выдаёт короткоживущий `Signed URL` в закрытом бакете (либо публичный кэшируемый URL только для официальных/расшаренных материалов). Автоудаление облачного аудио при удалении карточки запрещено.
- **Вариант 5B — SHA-256 адресация + `check-missing`, но сохранение публичных бакетов Supabase с криптостойкими `sha256`-именами (без Signed URLs на чтение):**
  Все новые файлы именуются по SHA-256 (`img_<sha256>.webp`, `audio_<sha256>.mp3`), что исключает перебор по `user_id` (`upload_<user_id>_...`), при этом клиенты продолжают скачивать медиа напрямую с CDN Supabase (с `Cache-Control: immutable`) без вызовов API `/storage/v1/object/sign/...`. `GET /api/media/*` на FastAPI проверяет `get_user_id` и перенаправляет только если путь валиден.
- **Вариант 5C — Проксирование всех байтов медиа через FastAPI (Vercel Functions) для строгого per-card ACL на каждый GET:**
  Закрыть бакеты Supabase и отдавать все изображения/аудио байтами через FastAPI с проверкой `get_effective_user_role` в PG.

| Критерий | Вариант 5A (SHA-256 + `check-missing` + Signed URLs для приватного) | Вариант 5B (SHA-256 + `check-missing` + публичный CDN по 256-бит хэшу) | Вариант 5C (Прокси через FastAPI/Vercel) |
| --- | --- | --- | --- |
| **Сложность реализации** | Средняя–высокая (нужно разделение публичных/приватных бакетов и кеширование signed URLs на клиенте) | **Низкая–средняя** (использует существующие бакеты `audio`/`images` и CDN) | Высокая |
| **Нагрузка на Vercel/Supabase free-tier** | Средняя (вызовы `createSignedUrl` к Storage API; ломает долгое HTTP-кеширование на клиенте из-за меняющихся token-query в URL) | **Минимальная** (0 вызовов Vercel на раздачу медиа, `Cache-Control: immutable` в CDN и на клиенте) | **Катастрофическая** (100% медиа-трафика сжигает лимиты Vercel Functions bandwidth и SQL-пул PG на каждый тег `<img>`/`<audio>`) |
| **Сохранность данных и корректность** | Строгий ACL (приватные картинки недоступны даже при утечке ссылки) | Де-факто capability-доступ по 256-битному SHA-256 (достаточно от перебора, но при утечке ссылки доступ нельзя отозвать без смены имени; `upload_<uid>_*` нужно дозакрыть или мигрировать) | Строгий ACL, но падает под нагрузкой |
| **UX и офлайн-готовность** | Требует обновления истёкших signed URLs при переходе между онлайн/офлайн кэшем | Отличная: канонический неизменный URL совпадает с локальным SHA-256 кешем | Медленная загрузка аудио/картинок |
| **Обратимость** | Средняя (требует разделения бакетов) | Высокая (переход на 5A возможен позже без смены SHA-256 имён) | Низкая |

**Рекомендация (на утверждение владельца — НЕ утверждена):** **Вариант 5B** как прагматичный первый шаг для free-tier (единый SHA-256 и `check-missing` + закрытие `upload_<user_id>` для новых загрузок + удаление раздачи BLOB из PG), с опцией последующего усиления приватности по **Варианту 5A** (Signed URLs только для приватных медиа вне `library`/`global_readonly`), если для пользовательских фото потребуется формальный отзыв доступа по ACL. Вариант 5C категорически не рекомендуется из-за квот Vercel/PG.

---

### Блок 6. Библиотека (`scope='library'`) и офлайн-дистрибуция официальных курсов (`global_readonly`)

- **Вариант 6A — Разделение «Каталога» и «Подписок/локальной библиотеки» (Opt-in `global_readonly` в `/sync/v2/pull` + фикс `source_library_id`):**
  `/sync/v2/pull` синхронизирует только: (а) личные папки/колоды, (б) `TMA_Collaborator` колоды, и (в) `global_readonly` папки, на которые пользователь явно подписался (кнопка «Добавить курс / Скачать»). Просмотр витрины официальных курсов и `scope='library'` идёт по требованию через лёгкий кешируемый каталог (`GET /api/decks/external` + список опубликованных корней). Обновление `scope='library'` сопоставляется по `source_library_id`.
- **Вариант 6B — Оставить текущее принудительное включение всех `global_readonly` в `/sync/v2/pull`, но с дельта-курсором:**
  Каждый пользователь всё равно получает в свой Dexie все официальные папки и карточки платформы, но порциями через дельту.
- **Вариант 6C — Отказ от `global_readonly` в пользу полного клонирования `scope='library'` для всех официальных курсов:**
  Любой официальный курс при добавлении копируется в `scope='personal'` (дублируя строки `TMA_Card` и `TMAProgress` на каждого пользователя).

| Критерий | Вариант 6A (Opt-in подписка на `global_readonly` + `source_library_id`) | Вариант 6B (Все `global_readonly` в каждый клиент) | Вариант 6C (Полное клонирование) |
| --- | --- | --- | --- |
| **Сложность реализации** | Средняя (небольшая таблица/настройка подписок + UI кнопки «Добавить курс») | Низкая | Средняя (ломает экономию памяти PG и централизованные правки ошибок в карточках) |
| **Нагрузка на Vercel/Supabase free-tier** | **Минимальная**: пользователи хранят и синхронизируют только нужные им курсы; `tma_folder` не сканируется глобально | Высокая (холодный старт и память телефона забиваются всеми курсами платформы) | Очень высокая (взрывной рост строк `tma_card` в PG пропорционально `users × cards`) |
| **Сохранность данных и корректность** | Высокая (персональный SRS и заметки остаются независимыми; отписка не удаляет `TMAProgress` на сервере) | Высокая, но раздувает IndexedDB на мобильных устройствах | Сложность накатывания правок опечаток от автора к ученикам |
| **UX и офлайн-готовность** | Быстрый старт, пользователь сам выбирает, какие официальные курсы нужны ему офлайн | Пользователь ждёт скачивания лишних языков/уровней | Дубликаты колод при повторных импортах |
| **Обратимость** | Высокая | Высокая | Низкая |

**Рекомендация (на утверждение владельца — НЕ утверждена):** **Вариант 6A** — устраняет лавинообразный рост `/sync/v2/pull` и глобальное сканирование `tma_folder` при сохранении общей модели `global_readonly` и минимального объёма строк в PostgreSQL.

---

### Блок 7. Web Offline (Service Worker / Workbox, OPFS vs IndexedDB, защита от eviction)

- **Вариант 7A — `vite-plugin-pwa` (App Shell precache + `NetworkOnly` для `/api/*`) + `storage.persist()`/`estimate()` с предупреждениями + улучшенный IndexedDB `database.media` (SHA-256, LRU, `revokeObjectURL`):**
  Добавляем SW только для статики/шрифтов (отключён в APK), заменяем `no-cache` блокировку App Shell, запрашиваем `persist()`, показываем статус квоты и несинхронизированного хвоста, а в `mediaCache.js`/`offlineMediaStore.js` дорабатываем единую модель на базе IndexedDB (добавив SHA-256, LRU-вытеснение по квоте и очистку `objectURL`).
- **Вариант 7B — То же, что 7A, но с использованием OPFS (`navigator.storage.getDirectory()`) для медиафайлов с автоматическим fallback на IndexedDB:**
  Для браузеров с поддержкой OPFS медиабайты пишутся в файлы OPFS (разгружая IndexedDB и JSON-транзакции Dexie), а на старых/ограниченных WebView срабатывает fallback в `database.media`.
- **Вариант 7C — Не внедрять SW и OPFS в Web (оставить Web полностью онлайн-зависимым, офлайн только в Android APK):**
  Отказаться от поддержки загрузки Web без сети, ограничив V3 для Web только ручной синхронизацией и локальным кешем открытой вкладки.

| Критерий | Вариант 7A (SW App Shell + `persist()` + улучшенный IDB) | Вариант 7B (SW App Shell + `persist()` + OPFS с IDB fallback) | Вариант 7C (Без SW/Web Offline) |
| --- | --- | --- | --- |
| **Сложность реализации** | Низкая–средняя (одно хранилище Dexie, предсказуемо во всех WebView) | Средняя–высокая (два бэкенда хранения в Web, тестирование Safari/Chrome/TG WebView) | Минимальная |
| **Нагрузка на Vercel/Supabase free-tier** | Низкая (App Shell и шрифты не перекачиваются, меньше 404/reload при обрывах) | Низкая | Выше (частые перезагрузки `index.html` и бандлов) |
| **Сохранность данных и корректность** | Средняя–высокая (ограничена политиками браузера/ITP, но явно предупреждает пользователя и даёт экспорт бэкапа) | Средняя–высокая (аналогично подвержена 7-дневному ITP Safari) | Риск потери незавершённой сессии при потере сети и перезагрузке вкладки |
| **UX и офлайн-готовность** | Вкладка открывается и работает офлайн в поездке; единый адаптер с тестовым контуром | Быстрее на тяжёлых аудио/видео в десктопном Chrome, но сложнее в Telegram WebView | Невозможно открыть Web-клиент без сети |
| **Обратимость** | Высокая (SW легко обновить/деактивировать, Dexie уже используется) | Средняя | Высокая |

**Рекомендация (на утверждение владельца — НЕ утверждена):** **Вариант 7A** для первой очереди Web Offline (минимальная сложность и 100% совместимость с Telegram WebView и `fake-indexeddb`, при этом закрывает ключевые риски: App Shell, `persist()`, предупреждения ITP, SHA-256 и LRU в `database.media`). Переход медиаслоя на OPFS (7B) целесообразен только как последующая оптимизация при росте объёмов медиа в Web.

---

### Блок 8. Подпись Android APK, `versionCode` и Android Auto Backup

- **Вариант 8A — Явный `signingConfigs` из env/локального хранилища (fail-closed для релизов) + `android/version.properties` + проверка `signer_sha256` в `lerne-admin` + `android:allowBackup="false"`:**
  Постоянный релизный keystore вне Git, строгая проверка отпечатка сертификата и монотонности `versionCode` в `lerne-admin/src/lerne_admin/services/android_build.py`, отключение непредсказуемого 25-МБ Google Auto Backup в пользу проверяемых JSON/ZIP-бэкапов и ручной V3-синхронизации.
- **Вариант 8B — То же, что 8A, но `android:allowBackup="true"` с кастомными `dataExtractionRules`/`fullBackupContent` (бекапить только настройки/SQLite, исключая `lerne-offline-media/`):**
  Попытаться оставить системный облачный бэкап Android только для `app_webview/Default/`.
- **Вариант 8C — Продолжать использовать локальный `debug.keystore` и `allowBackup="true"` без контроля `signer_sha256`:**
  Оставить текущее поведение сборки.

| Критерий | Вариант 8A (Fail-closed `signingConfigs` + `version.properties` + `allowBackup="false"`) | Вариант 8B (Частичный `dataExtractionRules`) | Вариант 8C (Как сейчас) |
| --- | --- | --- | --- |
| **Сложность реализации** | Низкая | Средняя (зависит от внутренних путей Chromium WebView на разных версиях Android OEM) | Нулевая |
| **Нагрузка на Vercel/Supabase free-tier** | Нулевая | Нулевая | Нулевая |
| **Сохранность данных и корректность** | **Максимальная**: гарантирует `install -r` без `INSTALL_FAILED_UPDATE_INCOMPATIBLE` и исключает рассинхрон WebView с `lerne-offline-media/` | Опасна: частичное восстановление `app_webview` без `lerne-offline-media/` оставляет «битые» ссылки в карточках; лимит 25 МБ ненадёжен | **Критически низкая**: смена машины/CI делает обновление невозможным без `uninstall` (полная потеря данных) |
| **UX и офлайн-готовность** | Предсказуемое обновление APK + прозрачные бэкапы JSON/ZIP и Sync | Скрытый риск битых медиа после смены телефона | Высокий риск потери данных при обновлении |
| **Обратимость** | Высокая (кроме необратимости уже выбранного релизного ключа — ключ хранится вечно с офлайн-бэкапом!) | Средняя | Низкая (нельзя сменить ключ у пользователей без переустановки) |

**Рекомендация (на утверждение владельца — НЕ утверждена):** **Вариант 8A** — единственный надёжный промышленный стандарт для сохранности пользовательских данных при обновлении APK.

---

## D13. Предварительный план реализации, критерии приёмки и сводка на утверждение (РУБЕЖ ОСТАНОВКИ)

> **Статус выполнения:** Этап A в `C:\121\Lerne_projekt\lerne-admin` завершён и зафиксирован локальным коммитом `af39d18531bdf1a41d0b3ad878f2abc448988f7e` (`refactor(android-build): remove deprecated standard APK mode and harden config migration`); Этап B и Этап C завершены в установленных границах; на Этапе D подготовлен данный RFC. **Дальнейшая реализация (Этапы E–F) НЕ НАЧАТА** и ждёт явного утверждения выбранных вариантов владельцем проекта.

### D13.1. Граф зависимостей и поэтапный план реализации (Этапы E–F)

```text
[E1: Фундамент APK, Dexie Lifecycle & Безопасность данных]
   |-- Подпись signingConfigs + version.properties + allowBackup="false" + проверка в lerne-admin
   |-- Dexie versionchange/blocked + самовосстановление offline-media:* (localMediaWriter)
   v
[E2: Отключение авто-поллинга & Серверная экономия SQL / TTL]
   |-- Отключение 60s/4s/двойного sync -> строго ручной Sync
   |-- Убрать FOR UPDATE на auth read, дубль generation_state, скан tma_folder;
   |   ранний gate watermark/acl_epoch до [10-19] (tma_collaborator/tma_deck/tmasetting); TTL TMAOfflineBatch
   v
[E3: Единый локальный движок + SRS-реконсиляция + Delta/Batch Sync v2]
   |-- Унификация standaloneCardStorage + cardOfflineQueue (Блок 3A)
   |-- Дельта-pull + batch-sync V2 + фикс collab group-progress (Блоки 1A, 2A)
   |-- Мигратор LerneStandaloneDB_900001 -> userId + opt-in global_readonly (Блок 6A)
   v
[E4: Медиа SHA-256, check-missing, локальный GC & Декупленный TTS / ИИ на Android]
   |-- Разделение audio.py (synthesize_tts_bytes) + ИИ без PG-записи + auth_v2 на Android (Блок 4A)
   |-- img_<sha256>, POST /media/check-missing, безопасный локальный GC (Блок 5B)
   v
[E5: Web Offline (SW / Workbox, persist/estimate, IDB LRU) & Валидация lerne-admin]
   |-- vite-plugin-pwa App Shell + storage.persist()/estimate() + LRU/SHA-256 в mediaCache (Блок 7A)
   |-- Согласование scope='library' в material_transfer + фикс --background-sync-browser
   v
[F1: Сквозная приёмка (в т.ч. live Android-эмулятор при наличии adb/AVD) и релиз]
```

#### Детализация фаз, рисков, критериев приёмки и точек возврата

| Фаза | Основные задачи | Ключевые риски | Критерии приёмки (вкл. автотесты защиты данных) | Точка возврата (Rollback) |
| --- | --- | --- | --- | --- |
| **E1** | `signingConfigs`, `version.properties`, `allowBackup="false"`, сверка `signer_sha256` в `lerne-admin`; `versionchange`/`blocked` в `localDb.js`; самовосстановление `offline-media:*` при старте; запрет автоудаления аудио. | Ошибка в Gradle/конфиге подписи; пропуск legacy-ключа `standalonePack`. | 1) Сборка пары `v1`/`v2` и проверка `aapt2`/`apksigner` (совпадение SHA-256, `v2 > v1`).<br>2) Unit/Playwright-тест **обрыва записи `localMediaWriter`** (файл на диске без записи `syncState` восстанавливается автоматически и успешно экспортируется в ZIP).<br>3) Тест миграции **Dexie `v5 -> v6`** (с активным вторым контекстом `versionchange`/`blocked` и сохранностью всех строк). | Отдельный локальный коммит; откат изменений `build.gradle` / `AndroidManifest.xml` / `localDb.js` без затрагивания серверной БД. |
| **E2** | Отключение фоновых 60с/4с таймеров и двойного sync в `offline_mode`; кнопка ручного Sync с отчётом; снятие `FOR UPDATE` на read-auth, фикс двойного `generation_state`, отказ от глобального скана `tma_folder`, перенос gate watermark/`acl_epoch` **до** запросов `[10–19]` (`tma_collaborator`, `tma_deck`, `tmasetting`), TTL/очистка `TMAOfflineBatch` (+ `TMAReviewHistory.action_id`). | Гонка при параллельном `refresh` и чтении токена (проверить, что `refresh` сохраняет `FOR UPDATE`); ложные 409 при ранней очистке `TMAOfflineBatch`. | 1) Инструментированный baseline PostgreSQL 17.11: **`unchanged` `/sync/v2/pull` <= 6–8 SQL `SELECT`** (против 26), `0 FOR UPDATE` на чтении, `0` фоновых запросов в простое за 120с.<br>2) Автотесты на **прерванный sync и повторные отправки (retries/lost ACK)** с проверкой отсутствия двойного применения оценки SRS (`action_id`). | Фича-флаг/откат коммита; миграция индекса `TMAReviewHistory.action_id` обратима и не ломает старых клиентов. |
| **E3** | Единый локальный CRUD (без `standaloneCardStorage` дубля); `cursor` delta-pull в `/sync/v2/pull`; `POST /api/cards/batch-sync` с per-item CAS `revision` / `409`; event-sourced гибридный SRS-replay; однократный мигратор `LerneStandaloneDB_900001 -> userId`; opt-in `global_readonly` и фикс `source_library_id` / `group-progress`. | Рассинхрон `aliases` при частичном `409` в батче; edge-case при слиянии `LerneStandaloneDB_900001` с существующим облачным аккаунтом; out-of-order SRS. | 1) Автотесты **конфликтов Android/Web** (одновременное редактирование карточки -> `409` только на конфликтную карточку, сохранение обеих версий до выбора; конкурентный SRS на 2 устройствах -> корректный пересчёт без потери оценок).<br>2) Тест **миграции `LerneStandaloneDB_900001`**: локальные карточки `>= 1_000_000`, `progress` без `review:*`, `localStorage` настройки сохраняются 100%.<br>3) Тесты **восстановления JSON (`full-v1`/`full-v2`) и ZIP v2–v4**. | Старый режим полного `pull` (`cursor=null`) и `1-by-1` маршруты `/cards/save` сохраняются до конца фазы; `LerneStandaloneDB_900001` не удаляется при миграции до финального подтверждения. |
| **E4** | Подключение `auth_v2` на Android; включение `/cards/ai-generate`, `*-batch`, stateless `classify-batch` и `evaluate-answer` для локальных черновиков; выделение `synthesize_tts_bytes` (`audio.py`) и stateless TTS; `img_<sha256>.webp`, `POST /media/check-missing`, безопасный локальный GC медиа. | Превышение таймаутов Vercel при batch-ИИ или TTS; случайная утечка квот LLM. | 1) Контрактные тесты: генерация ИИ-карточки и Edge-TTS на Android-профиле **выполняют 0 записей в PG и 0 записей в Storage**, сохраняя `archive_<sha256>.mp3` локально.<br>2) Тест **missing-only media sync**: повторный sync при уже имеющемся SHA-256 загружает 0 байт.<br>3) Тест **локального GC**: не удаляет медиа из Trash и активного outbox; облачное аудио при удалении карточки не удаляется. | Старые `POST /media/generate-audio` и `generate-card-audio` сохраняют обратную совместимость; `upload_<uid>_*` продолжает читаться. |
| **E5** | `vite-plugin-pwa` (SW только для App Shell/шрифтов, `/api/*` `NetworkOnly`), `storage.persist()`/`estimate()`, предупреждения пользователю и JSON/ZIP бэкап в Web, LRU + SHA-256 в `mediaCache.js`; выравнивание `scope='library'` в `lerne-admin`; починка и повторный прогон `--background-sync-browser`. | Кеширование устаревшего HTML при релизе на Vercel; ошибки в Telegram WebView. | 1) Playwright-тест **Web Offline**: загрузка App Shell при отключённой сети после первичного визита, прохождение SRS и создание карточки в офлайне, ручной Sync при возврате сети.<br>2) Юнит-тесты `lerne-admin` (`material_transfer`) и прогон `--background-sync-browser` (PG + Chromium). | `unregister()` для SW в `main.jsx` при откате; старые пользователи продолжают работать онлайн без SW. |
| **F1** | При наличии `adb` + AVD (или согласованного стенда): полный **live-тест обновления APK `v1 -> v2`** по процедуре [ANDROID_UPGRADE_AND_DATA_SAFETY.md §4.2](./ANDROID_UPGRADE_AND_DATA_SAFETY.md), итоговый сквозной прогон R6 (ревизия 8.1–8.6), финализация документации. | Отсутствие эмулятора в локальной среде (должен быть доустановлен или выполнен на стенде владельца перед массовым распространением APK). | 100% прохождение всех unit, backend PG, Playwright и emulator `install -r` проверок; независимая ревизия 8.1–8.6 без открытых критических дефектов. | Финальный тег/коммит отката до публикации APK пользователям. |

---

### D13.2. Сводка для владельца проекта (Gate на утверждение перед Этапами E–F)

#### 1. Что уже работает
- **Автономный Android Offline Pilot (`com.lerne.offlinepilot`):** локальное обучение, SRS, создание/редактирование Native V2 карточек, хранение медиа на диске (`getFilesDir()/lerne-offline-media/archive_<sha256>.*` с `.partial`+`fsync`+проверкой заголовков), экспорт/импорт ZIP v4 и JSON прогресса `full-v2` через SAF работают с **0 HTTP и 0 SQL** (`24/24` тестов PASS).
- **Единое бизнес-ядро:** `srsEngine.js` (с паритетом `api/srs.py`), `nativeV2Contract.js`, `@lerne/card-ui` (`NativeCardFormCore.jsx`) и `offlineApi.js` уже общие для всех клиентов (`410/410` frontend-тестов PASS).
- **Безопасность ключей ИИ и квитанции синхронизации:** ключи LLM хранятся строго на сервере; в `/sync/v2/*` уже реализованы и покрыты тестами `TMAOfflineBatch` (идемпотентность `request_id` и `action_id`), CAS `revision`, `409` конфликты, карантин `X-Lerne-Generation` (`13/13` и `11/11` backend-тестов PASS).
- **Очистка в `lerne-admin`:** на Этапе A (коммит `af39d18531bdf1a41d0b3ad878f2abc448988f7e`) из APK Builder удалён устаревший режим `standard` (оставлен только `offline-pilot`); `Material Transfer` строго изолирован от пользовательского SRS (`FORBIDDEN`); `cleanup_orphaned_images` защищает soft-deleted карточки и не трогает `audio`.

#### 2. Что требует изменений
- **Подпись и обновление APK:** добавить явный `signingConfigs` (fail-closed для релизов), `android/version.properties`, `android:allowBackup="false"` и проверку `signer_sha256` в `lerne-admin`.
- **Dexie и целостность локальных записей:** добавить `versionchange`/`blocked` в `localDb.js`, самовосстановление `offline-media:*` при сбое между диском и `syncState` (`localMediaWriter.js:50-60`), однократную миграцию `LerneStandaloneDB_900001`.
- **Отказ от бесконтрольного поллинга:** отключить `60s` (`useAppInitialization.js`, `knowledgeSyncOrchestrator.js`), `4s` (`useCollaborativePresence.js`) и двойной sync в `offline_mode`, оставив строго ручной запуск по кнопке.
- **TTS и ИИ на Android:** разделить `api/utils/audio.py::generate_audio` на чистый синтез байтов и облачную публикацию; разрешить Android-клиенту вызывать защищённый API ИИ и stateless TTS без обязательной записи в PG/Storage; закрыть пробел локальных карточек для `classify-batch`/`evaluate-answer`.
- **Оптимизация и расширение `/sync/v2/*`:** сократить `unchanged` `/sync/v2/pull` с 26 SQL, внедрить дельта-pull, пакетный push V2-карточек, очистку `TMAOfflineBatch` с сохранением уникальности `action_id`, opt-in подписку на `global_readonly`, исправить `useCollaborativeStore.js:82` (`/group-progress`).
- **Медиа и Web Offline:** унифицировать SHA-256 для изображений (`img_<sha256>.webp`), добавить `POST /media/check-missing`, безопасный локальный GC, App Shell SW и `storage.persist()`/`estimate()` для Web.

#### 3. Где есть дублирование
- **Две модели локальных мутаций карточек в одной таблице `cards`:** `standaloneCardStorage.js` (`id > 1_000_000`, `is_dirty: 0`, `standalone-card-op:*`) дублирует `apiCacheSync.js` + `cardOfflineQueue.js` (`id < 0`, `is_dirty`, `card-*-v2:*`).
- **Три несвязанных контура локальных медиа:** `OfflineMaterialArchivePlugin.java` vs `offlineMediaStore.js` vs `mediaCache.js` (в последнем нет SHA-256, нет LRU и утекают `objectURL`), плюс скрытый `fetch` fallback в `StructuredCardFields.jsx`.
- **Дублирование `generation_state()`:** вызывается дважды за один `GET /api/sync/v2/pull` (`6 SELECT` вместо `0–2`).
- **Несогласованность `lerne-admin`:** `lerne-admin/src/lerne_admin/services/material_transfer.py` работает с `global_readonly`, но игнорирует `scope='library'`, а `lerne-admin/src/lerne_admin/services/material_archive.py` — наоборот.

#### 4. Где расходуются ресурсы (Vercel / Supabase / клиент)
- **Фоновые поллинги:** `60s` `/sync/v2/pull` (даже при `offline_mode=true`) и `4s` `/presence` (26 SQL SELECT за один вызов, 150 HTTP / 3 900 SQL за 10 мин на одного пользователя в общей колоде).
- **Стоимость `unchanged` `/sync/v2/pull`:** **26 SQL SELECT** в 3 соединениях с **2 блокировками `FOR UPDATE`** на `tma_auth_account`/`tma_auth_session`, полным сканированием всех папок платформы `tma_folder` и пересчётом `MD5(STRING_AGG)` по всем карточкам и прогрессу.
- **Амплификация снимка и глобальных курсов:** полный `pull` возвращает `205 KB` уже на 275 карточках, а обязательное включение всех `global_readonly` в каждый аккаунт инвалидирует `content_version` сразу для всех пользователей при любой правке официального курса.
- **Холодный старт Web/TMA:** каскад из `/auth/v2/refresh` + `/api/init` (`40 SQL`, `474.74 ms`) + `/auth/sync` + `/sync/v2/status` (`7 SQL`) + `/sync/v2/pull` (`28 SQL`, `205 KB`) + `/user/settings`.
- **N+1 при отправке оффлайна и рост БД:** 1-by-1 `POST /cards/save` / `PATCH /cards/{id}` / `PUT /card-notes`, неограниченный рост `TMAOfflineBatch`, отсутствие дедупликации облачных изображений (`upload_<uid>_*`) и раздача BLOB `videos`/`backgrounds` из `TMAMedia.content` в PostgreSQL.

#### 5. Сгруппированные архитектурные блоки, варианты и предварительные рекомендации

| Блок | Рассмотренные варианты | Предварительная рекомендация (НЕ утверждена) | Краткое обоснование |
| --- | --- | --- | --- |
| **1. Синхронизация материалов** | **1A** Расширение `/sync/v2` (delta + batch + SQL-оптимизация)<br>**1B** Полная замена / CRDT<br>**1C** Только отключение таймеров | **1A** | Сохраняет отлаженные `TMAOfflineBatch`, `aliases`, CAS `revision`, при минимальном трафике и числе SQL/HTTP. |
| **2. Синхронизация SRS** | **2A** UUID `action_id` + сохранение до ACK + гибридный Causal/Replay<br>**2B** Текущий append-on-arrival<br>**2C** Наивный LWW по снимку | **2A** (строго против 2C) | Защищает от двойного применения, потерь оценок и рассинхрона интервалов на двух устройствах. |
| **3. Локальные ID и миграция `900001`** | **3A** Единый движок мутаций + однократный мигратор `900001 -> userId`<br>**3B** Перевод всей БД на UUID<br>**3C** Ручной ZIP/JSON мост | **3A** | Удаляет дубль `standaloneCardStorage`, не требует ломки PK в PostgreSQL, бесшовно переносит Android-данные. |
| **4. ИИ и TTS на Android** | **4A** `auth_v2` + stateless ИИ/TTS (`synthesize_tts_bytes`) + локальное сохранение<br>**4B** Анонимные device-токены<br>**4C** Обязательная запись в PG/Storage | **4A** | Ключи только на сервере, 0 лишних записей в PG/Storage, защита квот аккаунтом. |
| **5. Медиа, SHA-256 и ACL** | **5A** SHA-256 + `check-missing` + Signed URLs (приватное)<br>**5B** SHA-256 + `check-missing` + CDN по 256-бит хэшу<br>**5C** Прокси через Vercel | **5B** (с опцией усиления до **5A** для приватных фото) | Убирает дубли, не передаёт лишние байты, сохраняет 0 egress Vercel; исключает автоудаление аудио. |
| **6. Библиотека и `global_readonly`** | **6A** Opt-in подписка на `global_readonly` + `source_library_id`<br>**6B** Все `global_readonly` в каждый клиент<br>**6C** Полное клонирование | **6A** | Исключает загрузку ненужных курсов и глобальный скан `tma_folder` при сохранении общей базы. |
| **7. Web Offline** | **7A** SW App Shell + `persist()`/`estimate()` + IDB (SHA-256, LRU)<br>**7B** То же + OPFS с fallback<br>**7C** Без SW/Web Offline | **7A** (OPFS — как будущая фаза при росте объёма) | Минимальная сложность, предсказуемость в Safari/Telegram WebView, защита от незаметного вытеснения. |
| **8. Подпись APK и Auto Backup** | **8A** Fail-closed `signingConfigs` + `version.properties` + `allowBackup="false"`<br>**8B** Частичные `dataExtractionRules`<br>**8C** Текущий `debug.keystore` | **8A** | Гарантирует безопасное обновление `v1 -> v2` и исключает 25-МБ рассинхрон WebView с медиафайлами. |

#### 6. Какие риски и ограничения остаются (подтверждено честно)
1. **Live-тест обновления APK на Android-эмуляторе не выполнен:** в текущей локальной среде отсутствуют `platform-tools` (`adb`), `emulator`, `cmdline-tools` и AVD. Работоспособность реального `install -r` поверх WebView `app_webview/Default/` подтверждена только анализом кода и остаётся к проверке на стенде с эмулятором (Этап F1).
2. **Браузерный стенд `--background-sync-browser` не выдал метрик:** команда завершилась ошибкой `TimeoutError: 30000ms exceeded` на историческом варианте `before` (`30737439`) до записи JSON-метрик (`requests`, `bytes`, `X-Sync-SQL`, `X-Sync-Decodes`). Реальные браузерные метрики необходимо снять после починки стенда на этапе E5.
3. **Production-заголовки Vercel и политики бакетов Supabase Storage не проверялись напрямую** (ввиду строгого запрета доступа к production). Перед внедрением Блока 5 необходимо сверить фактические CORS/Cache-Control/RLS настройки бакетов `audio` и `images` владельцем проекта.
4. **Ограничения Web/Telegram Offline:** даже при внедрении Service Worker и `navigator.storage.persist()` политика WebKit ITP (7 дней в Safari/iOS WebView) и квоты Telegram WebView остаются внешним ограничением платформы — гарантированным долговременным офлайн-клиентом остаётся Android APK.
5. **Хранение и сохранность релизного keystore (для Блока 8):** потеря релизного keystore или смена `applicationId`/`androidScheme` делают обновление существующих APK невозможным без удаления приложения.

#### 7. Явный запрос на утверждение владельцем проекта

Просим владельца проекта рассмотреть блоки **1–8** (разделы D12 и D13.2) и подтвердить:
1. Утверждаемые варианты по каждому из **8 архитектурных блоков** (`1A/1B/1C`, `2A/2B/2C`, `3A/3B/3C`, `4A/4B/4C`, `5A/5B/5C`, `6A/6B/6C`, `7A/7B/7C`, `8A/8B/8C`) либо корректировки к ним.
2. Позицию по приватности медиа (Блок 5: достаточна ли на первом шаге схема **5B** с 256-битными SHA-256 именами и закрытием `upload_<user_id>_*`, или сразу требуется **5A** со Signed URLs для приватных пользовательских изображений).
3. Разрешение на переход к **Этапу E** (реализация в коде) по утверждённой конфигурации и с оговоркой по проверке live-обновления APK на эмуляторе/тестовом устройстве.

**До получения явного ответа владельца реализация Этапов E–F остановлена.**
