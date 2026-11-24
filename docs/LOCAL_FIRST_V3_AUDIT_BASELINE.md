# Аудит фактической архитектуры (C1–C6) и воспроизводимый локальный baseline производительности Lerne (этап перехода к Local-first V3)

**Статус документа:** исследовательский аудит (Этап C, направления C1–C6). Код и схемы БД не изменялись.  
**Репозитории в контуре аудита:**
- Основной (`tma`): `C:\121\Lerne_projekt\tma` (React/Vite PWA-подобный веб-клиент + Telegram Mini App + Capacitor Android Offline Pilot + FastAPI backend).
- Админ-консоль (`lerne-admin`): `C:\121\Lerne_projekt\lerne-admin` (локальная панель администратора, Material Transfer, медиа-очистка, APK Builder).

---

## 1. Введение и методика аудита

### 1.1. Границы безопасности и среда проверки
Аудит выполнен **строго по фактическому исходному коду** обоих репозиториев, существующим изолированным тестам и локальным синтетическим замерам без единого обращения к внешней инфраструктуре:
- **0 обращений к production:** production Supabase (PostgreSQL и Storage), production Vercel, реальные пользовательские БД/снимки и реальные мобильные устройства не запрашивались и не модифицировались.
- **Изолированный контур тестирования:**
  - Frontend: `npm --prefix app test` (Node 24 `--experimental-test-module-mocks` с `scripts/tests/no-network.mjs`, блокирующим сокеты и `fetch`, и `fake-indexeddb`).
  - Backend: `venv\Scripts\python.exe scripts/test_backend.py ...` (устанавливает `VERCEL=1`, блокирует `PostgresqlDatabase.connect`, `socket.connect` и `dotenv.load_dotenv`).
  - Локальный baseline C6: одноразовый локальный кластер PostgreSQL 17.11 (`C:\121\Lerne_projekt\tools\pgsql\bin\postgres.exe`) и SQLite in-memory на синтетическом фикстуре через FastAPI `TestClient(app)` с инструментированием `db.execute_sql` и курсоров.

### 1.2. Разделение статусов утверждений
Чтобы не смешивать измеренные факты с предположениями, в документе последовательно разделяются:
1. **Подтверждённые факты и замеры (`[Подтверждено кодом]` / `[Подтверждено замером]`):** пути файлов, точные номера строк, имена символов, схемы таблиц, проверенные SQL-счётчики, HTTP-размеры и результаты прогонов локальных тестов/инструментированного `TestClient`.
2. **Обоснованные гипотезы и открытые вопросы (`[Гипотеза по коду]` / `[Открытый вопрос]`):** экстраполяция на production-объёмы, влияние удалённого сетевого RTT и холодных стартов Vercel, реальный egress Supabase Storage (не замерявшийся ввиду запрета доступа к production), а также вопросы UX/авторизации, требующие решения в RFC (Этап D).
3. **Ограничения замеров:** локальный `total_ms` включает только loopback `TestClient` + локальный PG 17.11 (без TLS, холодного старта Serverless-функций, накладных расходов `pg8000` и трансатлантического RTT); браузерный прогон `--background-sync-browser` завершился ошибкой на `before`-базе и не выдал метрик (подробно зафиксировано в разделе 7.3).

---

## 2. C1. Локальные данные (`tma`)

### 2.1. Базы данных Dexie / IndexedDB и миграции (v1–v5)
**[Подтверждено кодом]** Выбор и инициализация клиентской IndexedDB централизованы в `app/src/services/localDb.js:10-53` и `app/src/utils/standaloneMode.js:4-14`:

- **Именование БД на аккаунт (`${prefix}_${userId}`):**
  - `IS_STANDALONE === true` (`VITE_LERNE_STANDALONE === '1'`): `LerneStandaloneDB_900001` (`STANDALONE_DB_PREFIX = 'LerneStandaloneDB'`, синтетический `STANDALONE_USER_ID = 900001`, `app/src/utils/auth.js:130-132`).
  - `IS_LOCAL === true`: `LerneTestDB_<userId>`.
  - Штатный Web и Telegram Mini App: `LerneLocalDB_<userId>`.
- **Миграция со старой неразделённой БД (`migrateLegacy`, `localDb.js:55-88`):**
  - Пропускается при `IS_LOCAL || IS_STANDALONE` (`localDb.js:56`).
  - Для Web/Telegram: если `syncState.get('legacyImported')` отсутствует и существует старая БД `LerneLocalDB`, переносит таблицы `folders`, `decks`, `cards`, `progress` с фильтрацией по `user_id` (если `localStorage` `lerne_db_owner` / `lerne_last_sync_user_id` не указывает на совпадение владельца), после чего ставит маркер `legacyImported`.

**Схема версий Dexie (`configureDatabase`, `localDb.js:99-128`):**

| Версия Dexie | Добавленные / изменённые таблицы | Индексы (первичный ключ указан первым) |
| --- | --- | --- |
| **v1** (`L103-107`) | `decks` | `id, user_id, name, is_deleted, is_dirty` |
| | `cards` | `id, deck_id, front_text, is_deleted, is_dirty` |
| | `progress` | `[card_id+user_id], user_id, card_id, next_review, is_dirty` |
| **v2** (`L109-114`) | `folders` | `id, user_id, name, is_deleted, is_dirty` |
| | `decks` (обновлена) | `id, user_id, folder_id, name, is_deleted, is_dirty` |
| **v3** (`L116-119`) | `syncState` | `key` |
| | `media` | `url` |
| **v4** (`L121-126`) | `knowledge_items` | `id, language, category` |
| | `card_knowledge_items` | `[card_id+knowledge_item_id], card_id, knowledge_item_id, role` |
| | `knowledge_attempt_outbox` | `client_event_id, user_id, knowledge_item_id, sync_status, created_locally_at` |
| | `user_knowledge_state` | `[user_id+knowledge_item_id], user_id, knowledge_item_id` |
| **v5** (`L127`) | `card_notes` | `id, card_id, is_dirty` |

### 2.2. Семейства ключей в `syncState`
**[Подтверждено кодом]** Таблица `syncState` служит универсальным KV-журналом состояния, очередей и квитанций для двух контуров:

1. **Контур Web / Telegram (`Cloud/Offline Sync v2`):**
   - `legacyImported` (`localDb.js:57,87`) — маркер переноса старой `LerneLocalDB`.
   - `lastSync` — версии снимков (`snapshotVersion`, `contentVersion`, `deckSummaryVersion`, `catalogueVersion`, `progressTime`, `progressCounts`).
   - `aliases` (`localDb.js:150`) — таблица переназначения временных отрицательных ID в серверные `{ mappings: { folders, decks, cards } }`.
   - `pending` — устаревший/переходный пакет сущностей `entityBatchSync.js`.
   - `deck-cards:<deckId>` — признак полноты кеша колоды (`complete: boolean`).
   - `serverGeneration` и `serverGenerationConflict` (`serverGeneration.js:19-24`) — хэш поколения БД и флаг карантина при восстановлении серверной БД.
   - `auth-v2-refresh-lease` (`networkApi.js:136`) — межвкладочная аренда (fallback при отсутствии `navigator.locks`) для обновления токена.
   - Очередь Native V2 карточек (`localDb.js:130-133`): `card-create-v2:<request_id>`, `card-edit-v2:<card_id>`, `card-move-v2:<card_id|request_id>`, `card-lifecycle-v2:<card_id|request_id>`.
   - SRS-оценки и квитанции (`offlineApi.js:423-426`): `grade:<action_id>` (идемпотентный отпечаток и результат) и `review:<action_id>` (событие повторения для отправки в `/sync/v2/push`).
   - `deck-text-update:<id>` / `folder-text-update:<id>` — отложенные обновления текстовых метаданных.

2. **Контур Standalone Offline Pilot (`IS_STANDALONE=1`):**
   - `standalone_seed_manifest` (`standaloneSeed.js:7`) — версия/состав встроенного стартового пака.
   - `standalone-card-op:<request_id>` (`STANDALONE_CARD_OP_PREFIX`, `standaloneCardStorage.js:14-15,82-96`) — квитанции локальных CRUD-операций (ротация/обрезка до `STANDALONE_MAX_CARD_OP_RECEIPTS = 64`).
   - `grade:<action_id>` (`offlineApi.js:398-421`) — квитанции SRS-оценок с обрезкой до `STANDALONE_MAX_GRADE_RECEIPTS = 64` (ключи `review:*` удаляются немедленно).
   - `offline-media:<folder>/<filename>` (`OFFLINE_MEDIA_KEY_PREFIX`, `offlineMediaResolver.js:3`, `localMediaWriter.js:38`) — реестр сохранённых локальных медиафайлов.
   - `standalone_material_export_source`, `standalone_id_counters` (`IMPORTED_ID_START = 1_000_000`, `materialArchiveIdentity.js` / `standaloneCardStorage.js:8-9`), `standalone_import_registry` (`materialArchive.js:29`), `standalone_last_progress_backup`, `standalone_last_progress_restore` (`progressBackup.js:15-16`).

### 2.3. Репозитории, транспорт и сервисы данных
**[Подтверждено кодом]**
- **`app/src/services/api.js:12-176`:** ES `Proxy` вокруг `networkApi` (экземпляр Axios в `networkApi.js`).
  - При `IS_STANDALONE === true` (`api.js:31-49`): к `offlineApi.handle(...)` допускаются только префиксы `/decks`, `/folders`, `/cards`, `/study`, `/trash`, `/init`, `/card-notes`; любой другой URL немедленно выбрасывает `ERR_STANDALONE_OFFLINE`. Вдобавок перехватчик `networkApi.js:80-84` жёстко блокирует любые сетевые запросы при `IS_STANDALONE`.
  - При `!IS_STANDALONE` (`api.js:50-165`):
    - Мутации из `handleLocalFirstRequest` (`apiCacheSync.js:15-83`) перехватываются **до HTTP**: `/card-notes/*`, `PATCH /cards/{id}` с `{ offlineCardEdit: true }`, `/cards/batch-move`, `/cards/batch-copy`, `/cards/reorder`, `/cards/batch-delete`, `/trash/card/{id}/restore`, а также `POST /cards/save` через `tryLocalFirstNativeCreate` (`apiCacheSync.js:85-109`), если целевая колода кеширована.
    - При `isOfflineMode()` (`IS_STANDALONE || Capacitor.isNativePlatform() || localStorage.offline_mode === 'true'`, `localDb.js:144-147`) или `!navigator.onLine` поддерживаемые маршруты читаются/пишутся через `offlineApi`. При сетевом сбое (`ERR_NETWORK` / `!networkErr.response`) срабатывает автоматический фоллбэк в `offlineApi.handle(...)` (`api.js:139-163`).
    - **Важная особенность `offline_mode=true`:** при выполнении онлайн-мутации на офлайн-маршруте (`needsRefresh`, `api.js:120-134`) клиент запускает полный `syncService.sync()` **до** HTTP-запроса и **повторно после** него.
- **`app/src/services/offlineApi.js`:** локальный эмулятор REST API поверх Dexie (`/init`, `/decks`, `/folders`, `/cards/search`, `/decks/:id/cards`, `/decks/:id/next`, `/cards/:id`, `/study/card/:id`, `/study/grade`, `/study/duplicates/grade`, `/cards/save`, `/cards/batch-*`, `/cards/reorder`, `/trash`, `/study/stats`, `/card-notes/*`).
- **`app/src/services/cardOfflineQueue.js`:** управляет не-standalone очередью (`saveNativeCard`, `queueCardMove`, `queueCardLifecycle`, `queueCardSelection`, `saveNativeEdit`, `resolveCardEdit`). Функция `isContentReadOnly(owner, db)` (`cardOfflineQueue.js:23-25`) возвращает `true` для `isStandaloneDb(db)`, `role === 'viewer'` и `is_global_readonly` (кроме `owner`/`editor`).
- **`app/src/pilot/standaloneCardStorage.js`:** отдельный локальный движок CRUD для Android Standalone (`createStandaloneCard` L117-247, `updateStandaloneCard` L249-356, `deleteStandaloneCard` L358-418). Выдаёт положительные локальные ID `> 1_000_000` (`IMPORTED_ID_START`), хранит `is_dirty: 0`, проставляет флаги `standalone_local_created: true` / `standalone_local_edit: true` и `standalone_card_key`, проверяет `revision` (формирует 409-подобный `card_revision_conflict`).
- **`app/src/services/cardSave.js`:** общий конвейер сохранения для создания и редактирования карточек (`CardCreator`/`CardEditor`). Разбирает `content_v2_source` (L59), валидирует через `api.js` -> `validateNativeV2Content`, генерирует `request_id = crypto.randomUUID()`, отправляет `PATCH /cards/:id` или `POST /cards/save`. При `IS_STANDALONE` передаёт `standaloneFlag: data.flag` (L113), пропускает `syncService.sync`, авто-TTS `/media/generate-card-audio`, отдельный `/cards/:id/flag` и обновление `draftImageHeight` (L130-194).

### 2.4. Контракт Native V2 и редактор карточек
**[Подтверждено кодом]**
- **Валидатор Native JSON V2:** `app/src/utils/nativeV2Contract.js:1-198` исполняет сгенерированную JSON-схему `app/src/utils/nativeV2Schema.generated.js` (`schema_version = 2`), единую для 9 типов карточек (`standard`, `theory`, `trainer`, `quiz`, `match`, `puzzle`, `word_bank`, `free_text`, `editable_text`) с правилами `x-rules` (`unique`, `count`, `references`, `distinct_text`, `visible_text`, `reserved_keys`, `json_bytes`).
- **Общий UI-пакет `@lerne/card-ui`:** `app/src/card-ui/package.json:1-11` (`version: 0.2.0`) экспортирует `NativeCardFormCore.jsx`, `NativeCardViewer.jsx`, `useLocalAudioPlayer.js` и `CardUiScoped.css`. Этот же пакет упакован в `lerne-admin/src/lerne_admin/core/card_ui.json` (`lerne-card-ui-0.2.0.tgz`).
- **Обёртка `app/src/components/common/CardForm.jsx:50-105` -> `app/src/card-ui/NativeCardFormCore.jsx:54-329`:**
  Все ограничения `IS_STANDALONE` прокидываются через пропсы без форка компонента формы (`CardForm.jsx:86-101`):
  - `enableDictation={!IS_STANDALONE && isCreator}` (`L86`) — скрывает голосовой ввод `PromptDictation`.
  - `lockLayout={IS_STANDALONE}` (`L87`):
    - в `app/src/components/common/StructuredCardFields.jsx:152-167` заменяет редактор изображений макета `CardImages` на заблокированную панель (`data-testid="standalone-layout-images-locked"`);
    - в `NativeCardFormCore.jsx:174-178` выводит предупреждение в режиме исходного JSON (`data-testid="standalone-json-layout-note"`);
    - в `NativeCardFormCore.jsx:317-325` и `app/src/hooks/useMediaUpload.js:95-103` удаляет `card.image` из `content_v2.card` при замене/очистке обложки;
    - в `standaloneCardStorage.js:123-125, 293-297` запрещает создание или изменение `card.layout`.
  - `allowOfflineAudioUpload={IS_STANDALONE}` (`L88`) — разрешает прикрепление локального аудиофайла без `navigator.onLine` в `CardAudioAttachments.jsx`.
  - `hideCoverHeightSlider={IS_STANDALONE}` (`L89`) — скрывает ползунок высоты обложки уровня колоды.
  - `onUploadCoverImage={uploadCreatorImage}` (`L95`) и `onUploadAudio={uploadAudioFile}` (`L97`) — оба обработчика ветвятся внутри `useMediaUpload.js:22-27, 37-39` на локальное сохранение через `storeLocalMediaFile` при `IS_STANDALONE`.
  - `onUploadLayoutImage={IS_STANDALONE ? null : uploadLayoutImageViaNetworkApi}` (`L96`). **Важный нюанс защиты:** внутри `app/src/components/common/StructuredCardFields.jsx:9-20, 42` компонент `CardImages` имеет fallback `defaultUploadLayoutImage`, делающий `fetch('/api/media/upload-image')`, если `uploadLayoutImage` не передан (`null`). В standalone этот сетевой вызов не происходит только потому, что `lockLayout={IS_STANDALONE}` не рендерит `<CardImages>` (`StructuredCardFields.jsx:152-167`).
  - `onGenerateAudio={IS_STANDALONE ? null : ...}` (`L99`) — скрывает кнопку облачного TTS в `CardFormMedia.jsx`.
  - `onAiGenerate={IS_STANDALONE ? null : handleAiGenerate}` (`L100`) и `onStopGeneration={IS_STANDALONE ? null : stopAiGeneration}` (`L101`) — скрывают ИИ-действия в `CardFormActions`.

### 2.5. Локальный SRS, очереди, резервное копирование и настройки
**[Подтверждено кодом]**
- **Локальный SRS (`app/src/utils/srsEngine.js:1-266`):** прямой JS-порт серверного `api/srs.py` с идентичными константами (`INITIAL_EASE_FACTOR = 2.5`, `MINIMUM_EASE_FACTOR = 1.3`, `MAXIMUM_EASE_FACTOR = 3.0`, `LEARNING_STEPS = [5, 10]`, `RELEARN_STEPS = [5]`, `GRADUATING_INTERVAL_GOOD = 1`, `GRADUATING_INTERVAL_EASY = 3`, `HARD_MULTIPLIER = 1.15`, `EASY_MULTIPLIER = 1.3`, `LEECH_LAPSE_THRESHOLD = 5`) и банковским округлением Python (`round-to-even` на `.5`, L20-22). Поддерживает 4- и 8-балльную шкалу и режимы `scheduled` / `forced`.
- **Запись оценки (`offlineApi.js:368-439`):** выполняется в атомарной Dexie-транзакции `[db.progress, db.syncState]`. В не-standalone-БД пишет `progress` (`is_dirty: 1`, `sync_base`, `flag_only: true` для V2-карточек) + `grade:<actionId>` + `review:<actionId>`. В standalone-БД (`isStandaloneDb(db)`, L398-421) удаляет `review:*` и ограничивает число `grade:*` 64 последними записями.
- **Прочие очереди:**
  - `syncService.js:263-279`: native card outbox (`card-create-v2:`, `card-edit-v2:`, `card-move-v2:`, `card-lifecycle-v2:`), пакет сущностей (`pending`, `decks`/`folders`/`progress` с `is_dirty`), `decks.learning_dirty`, `card_notes.is_dirty`.
  - `knowledgeSyncService.js` / `knowledgeSyncOrchestrator.js`: таблица `knowledge_attempt_outbox` (Dexie v4).
- **Резервное копирование JSON и ZIP:**
  - **Прогресс JSON** (`app/src/pilot/progressBackup.js:11-60`, `OfflineBackupFilePlugin.java:28-56`): формат `lerne-offline-progress-backup`, `schema_version = 1`, хэш `sha256` по каноническому JSON, области `full-v1` и `full-v2` (с `imported_records` и `imported_deck_preferences` по стабильным ключам `standalone_card_key`/`standalone_deck_key`/`material_key`). На Android работает через системный SAF (`ACTION_CREATE_DOCUMENT`/`ACTION_OPEN_DOCUMENT`), лимит чтения `MAX_BACKUP_BYTES = 5 MB`. Восстановление (`applyProgressBackup`) идёт в одной Dexie-транзакции, не затирает несовпавшие локальные карточки, сбрасывает `learning_dirty = 0`, очищает `grade:*`/`review:*`.
  - **Материалы ZIP** (`app/src/pilot/materialArchive.js:21-59`, `OfflineMaterialArchivePlugin.java:58-80`): формат `lerne-materials` версии `4` (поддерживает импорт v2, v3, v4). Потоковая работа с диском в Java-плагине. Лимиты: `MAX_ARCHIVE_BYTES = 512 MiB`, `MAX_MANIFEST_BYTES = 64 MiB`, `MAX_ASSET_BYTES = 20 MiB`, `MAX_ASSETS = 10000`, `folder: 10000`, `deck: 20000`, `card: 100000`. Структура: `manifest.json` (строгий парсер без дубликатов ключей `parseJsonStrictNoDuplicates`), `manifest.sha256`, ассеты `media/<sha256>.<ext>` с токенами `archive://<sha256>`. Локально созданные/отредактированные карточки (`standalone_local_edit` / `standalone_local_created`) защищены от перезаписи при повторном импорте пака.
- **Локальные настройки (`app/src/store/useSettingsStore.js:64-101, 155-168`):**
  - 18+ ключей `STUDY_STORAGE_MAP` и `AUTOPLAY_STORAGE_MAP` в `localStorage` (с префиксом `lerne_local:` при `IS_LOCAL`).
  - При `IS_STANDALONE === true` сетевые методы сохранения/загрузки (`debouncedSaveSettings`, `saveCurrentSettingsToServer`, `fetchUserSettingsFromServer`, `syncUserSettingsIfNeeded`) отключены как no-op (`useSettingsStore.js:156`).
  - Personal Design V2 хранится отдельно по аккаунту в `localStorage` под ключом `lerne:personal-design:v2:<userId>`, кэш глобального дизайна — `lerne:published-design:v2`. Standalone-профиль и счётчик временных ID используют ключи `lerne_standalone_profile_name`, `lerne_target_language`, `lerne_has_selected_language`, `native_language_selected`, `lerne_temp_id_counter`.

---

## 3. C2. Сквозная матрица Android / Web / Telegram

### 3.1. Сравнительная таблица 9 ключевых операций
**[Подтверждено кодом]**

| # | Действие | Android (`IS_STANDALONE=1`) | Web (`IS_STANDALONE=0`) | Telegram Mini App (`IS_STANDALONE=0`) |
|---|---|---|---|---|
| **1** | **Startup / Auth** | `useAppInitialization.js:26-28` -> `runStandaloneBootstrap()` (`standaloneBootstrap.js`): синтетический `STANDALONE_USER_ID=900001` (`auth.js:130`), `ensureStandaloneSeed()`, `initOfflineMediaStore(db)`, `offlineApi.handle('get','/init')`. **Сервер: не нужен. 0 HTTP, 0 SQL.** | `useAppInitialization.js:64-116` -> `restoreSession()` -> `GET /auth/v2/me` (1 SQL `TMAUser` + auth SELECTs) + `GET /init` (`main.py:146-220`: `decks`, `folders`, `TMASetting`, `TMACustomPrompt`, `TMAUser`, `user_settings`, `GLOBAL_DESIGN_V2`) + `POST /auth/sync` + `syncService.sync({background:true})` + `GET /user/settings`. **Сервер: обязателен (холодный старт).** | То же, что Web, плюс `cloudStorage` (`Telegram.WebApp.CloudStorage`, `auth.js:146-161`) для языков. При отсутствии сессии `restoreSession()` вызывает `POST /auth/v2/telegram/mini-app` (`auth_v2.py:159-169`: HMAC-проверка `initData`, выпуск `TMAAuthSession`/`TMAAuthToken`). Тактильный отклик: `Telegram.WebApp.HapticFeedback` vs Capacitor `Haptics` на Android / `navigator.vibrate` на Web. |
| **2** | **Open Deck / Cards** | `fetchDeckCards` -> `api.get('/decks/:id/cards')` -> `offlineApi.js:328-336` -> `readDeckStudyData` (Dexie `'r'` tx на `folders, decks, cards, progress`) + `cardMediaView`. **0 HTTP, 0 SQL.** | При наличии флага `fromPull` читает `readPulledDeckCards` из Dexie; иначе `GET /decks/{id}/cards` (`decks.py:113` -> `cards.py:164-241`: ACL `get_effective_user_role`, `TMA_Card`, `TMAProgress` чанками по 500, `TMAUser` creators, `TMAMedia` exists map; 13 SQL SELECT в baseline) -> `reconcileOnlineResponse` пишет в Dexie + `deck-cards:<id>` (`complete:true`). | Идентично Web. |
| **3** | **Study & Submit SRS Review** | `offlineApi.nextCard` -> `submitGrade` (`useStudySession.js:217-293`, `advanceBeforeSave` отключён до записи) -> `offlineApi.js:368-439` (`calculateCardReview` -> Dexie `'rw'` `[progress, syncState]` пишет `progress` + `grade:<actionId>`, удаляет `review:*`). **0 HTTP, 0 SQL.** | Старт: `GET /decks/{id}/next` (`study.py:256`). Оценка: при `localNext` переключает карточку оптимистично (`return_next: false, include_progress: true`), шлёт `POST /study/grade` (`study.py:315` -> `api/services/study.py:26-52`: `_claim_receipt` в `TMAOfflineBatch`, `TMAProgress` SELECT/INSERT/`FOR UPDATE` + UPDATE, `TMAReviewHistory` INSERT, `finish_receipt`). При сбое сети фоллбэк пишет `progress` + `grade:` + `review:` в Dexie. | Идентично Web (+ `HapticFeedback`). |
| **4** | **Create / Edit / Delete Card** | `cardSave.js` -> `offlineApi.js` -> `standaloneCardStorage.js` (`createStandaloneCard` / `updateStandaloneCard` / `deleteStandaloneCard`) в Dexie tx `[folders, decks, cards, progress, syncState]` (`id > 1_000_000`, `is_dirty: 0`, `standalone_local_edit`, квитанция `standalone-card-op:` макс. 64). **0 HTTP, 0 SQL.** | Для кешированной колоды (`apiCacheSync.js:15-109`): local-first запись в Dexie (`id < 0` при создании) + `syncState` (`card-create-v2:`, `card-edit-v2:`, `card-lifecycle-v2:`), затем `syncService.sync({pendingNativeOnly: true, skipPull: true})` -> `POST /cards/save` / `PATCH /cards/{id}` / `POST /cards/batch-delete` (`structured_card_api.py`: `_lock_decks`/`_lock_cards`, `_claim_receipt` `TMAOfflineBatch`, `TMA_Card`, `audio_write_scope` `storage.objects`, `TMAMedia`, `touch_deck_and_parent_folders`). | Идентично Web. |
| **5** | **Generate AI Card** | Отключено (`CardForm.jsx:100-101`, `api.js:46`, `networkApi.js:80`). **0 HTTP, 0 SQL.** | `useAiActions` -> `POST /cards/ai-generate` (`ai.py:268-279`) -> `ai_service.generate_card_fields`. **1 app HTTP (+ 1 внешний LLM HTTP), 2 коротких `run_db` SELECT (`TMASetting`, `TMACustomPrompt`), 0 SQL-записей.** | Идентично Web. |
| **6** | **Generate TTS Audio** | Отключено (`CardForm.jsx:99`, `cardSave.js:130`). **0 HTTP, 0 SQL.** | `POST /media/generate-audio` (`media.py:250`: 1 `run_db` SELECT `TMASetting`) или `POST /media/generate-card-audio` (`media.py:338`: 2 `run_db` скоупа SELECT card/ACL/settings + атомарный `TMA_Card` UPDATE) + Edge-TTS WS + Supabase Storage POST + GET-верификация. | Идентично Web. |
| **7** | **Upload / View Image & Audio** | Загрузка: `useMediaUpload.js:22-39` -> `storeLocalMediaFile` (`localMediaWriter.js:23-86`) -> `OfflineMaterialArchivePlugin.storeMediaAsset` (`getFilesDir()/lerne-offline-media/<folder>/archive_<sha256>.<ext>`) + `offline-media:*` в `syncState`. Просмотр: `Capacitor.convertFileSrc(...)` (`/_capacitor_file_/...`). **0 HTTP, 0 SQL.** | Загрузка: `POST /media/upload-image` (`media.py:138`: WebP + Storage POST + `TMAMedia` INSERT) или `POST /media/upload-audio` (`media.py:380`: проверка MP3/WAV + Storage POST + GET SHA-256). Просмотр: `mediaCache.js` (Dexie `media` 15/150 MiB, `URL.createObjectURL`) и `getAudioUrl` (`media.js:5,13-33` — прямой CDN Supabase `/storage/v1/object/public/audio/...` или `307` через `/api/media/*`). | Идентично Web. |
| **8** | **Export / Import Backup** | `ProfileTab.jsx:94-98` (`IS_STANDALONE`): `StandaloneBackupSection` (`progressBackup.js` + `OfflineBackupFilePlugin.java`, SAF, макс. 5 MB JSON) и `StandaloneMaterialsSection` (`materialArchive.js` + `OfflineMaterialArchivePlugin.java`, SAF, макс. 512 MB ZIP). **0 HTTP, 0 SQL.** | Компоненты `StandaloneBackupSection`/`StandaloneMaterialsSection` скрыты (`ProfileTab.jsx:94`). Доступен только текстовый экспорт колод (`cardTextExport.js`); ZIP-архивы материалов недоступны в UI. | Идентично Web. |
| **9** | **Manual / Auto Sync** | Отключено (`syncService.js:206`, `standaloneBootstrap.js`). **0 HTTP, 0 SQL.** | Авто (`useAppInitialization.js:118-199`): старт, `visibilitychange`, `online`, `setInterval` 60с под Web Lock `'lerne-offline-sync'`. Ручная: кнопка в `ProfileTab.jsx:345-367`. HTTP: `GET /sync/v2/status` + опц. push (`POST /sync/v2/push`, `POST /cards/*`, `PUT /card-notes/*`) + `GET /sync/v2/pull`. | Идентично Web. |

### 3.2. Общая бизнес-логика vs дублирование и платформенные расхождения
**[Подтверждено кодом]**
1. **Единое общее ядро:** все три клиента собираются из одного React-проекта `app/src/` и используют общий `NativeCardFormCore.jsx`, `CardForm.jsx`, `nativeV2Contract.js`, `srsEngine.js` (порт `api/srs.py`), `localDb.js` и `offlineApi.js`. Разница между Web и Telegram минимальна и изолирована в `auth.js` (`cloudStorage`), `useAuthStore.js` (`telegram/mini-app`) и `platform.js` (haptics).
2. **Ключевое раздвоение контуров (дублирование/расхождение):**
   - **Две разные модели локальных мутаций в одной таблице `cards`:** в standalone работает `standaloneCardStorage.js` с локальными положительными ID `> 1_000_000`, `is_dirty: 0`, ключами `standalone-card-op:*` и флагами `standalone_local_edit`; в Web/Telegram — `apiCacheSync.js` + `cardOfflineQueue.js` + `syncService.js` с временными отрицательными ID (`getNextTempId`), флагами `offline_edit`/`offline_create_status` и ключами `card-create-v2:` / `card-edit-v2:`.
   - **Две реализации локального медиахранилища:** Capacitor-плагин `OfflineMaterialArchivePlugin.java` (`getFilesDir()/lerne-offline-media/...`) на Android vs `offlineMediaStore.js` (таблица Dexie `media`) при браузерном запуске standalone.
   - **Отдельное несоответствие в клиентском ACL/collab-вызове (`useCollaborativeStore.js:82` vs `api/routers/collaborative.py:164`):** клиентский store запрашивает `/collaborative/folder/${folderId}/progress`, тогда как серверный роутер определяет `/collaborative/folder/{folder_id}/group-progress` (ошибка глушится в `CollaboratorsModal.jsx`).

---

## 4. C3. ИИ и TTS: эндпоинты, ключи, переиспользование для Android

### 4.1. ИИ-эндпоинты и воркеры в `tma` и `lerne-admin`
**[Подтверждено кодом]**
- **В `tma/api/routers/ai.py`:**
  - `POST /cards/ai-generate` (алиас `/ai/generate`, `L267-279`) -> `_generate_draft` -> `ai_service.generate_card_fields`: генерирует/редактирует поля черновика. Выполняет только 2 коротких `run_db` SELECT (`TMASetting`, `TMACustomPrompt`), **0 SQL-записей**.
  - `POST /cards/ai-generate-batch` (`/ai/generate-batch`, `L283-287`) и `POST /cards/ai-enrich-batch` (`/ai/enrich-batch`, `L260-264`): пакетная генерация и обогащение; **пишут в БД только если передан `deck_id`** (`L255-256` -> `save_ai_batch_result`).
  - `POST /ai/evaluate-answer` (`L35-51`): семантическая проверка ответа для `free_text`; жёстко требует `card_id > 0` в PostgreSQL (`load_answer_context`).
  - `POST /cards/classify-batch` (`L298-302`): пакетная CEFR-классификация карточек по ID.
  - `GET /admin/models/{provider}` (`L133-140`), `POST /admin/test-ai`: админская диагностика.
- **В `lerne-admin/src/lerne_admin/local_media_ai_worker.py` (`L1-248`):** локальный изолированный subprocess-воркер (в паре с `services/regen_worker.py`), использующий `sys.addaudithook` и явный allowlist хостов (`generativelanguage.googleapis.com`, `api.groq.com`, `openrouter.ai`, `speech.platform.bing.com`) без доступа к Supabase DB/Storage.

### 4.2. Безопасность ИИ-ключей
**[Подтверждено кодом]**
- Ключи (`GOOGLE_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`) читаются на сервере из `TMASetting` либо из переменных окружения (`tma/api/ai_service.py:38-52`).
- В `tma/api/ai_clients.py:70-89, 151-157` реализованы ротация пула ключей и `_sanitize_error`, вырезающая все известные ключи провайдера (подставляя `mask_api_key`) перед возвратом или логированием ошибок.
- Публичный `GET /api/init` (`tma/api/main.py:154-164`) отфильтровывает любые настройки с подстроками `KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `PASSWD`, `CREDENTIAL` и персональные префиксы.
- Админский `GET /api/admin/settings` (`tma/api/routers/settings.py:303-335`) отдаёт только `AI_KEYS_STATUS` с полями `id` (`key_fingerprint`) и `masked` (`mask_api_key`), никогда не раскрывая открытые ключи.
- Клиентский бандл и APK не содержат никаких ключей ИИ-провайдеров (соответствует целевому положению R7.5).

### 4.3. TTS-генераторы и жёсткая сцепка синтеза с публикацией в Storage
**[Подтверждено кодом]**
- Маршруты в `tma/api/routers/media.py`:
  - `POST /media/generate-audio` (`L250-335`): 1 `run_db` SELECT `TMASetting`, затем `audio.generate_audio(...)`. Требует, чтобы возвращённый путь начинался с `http` (иначе HTTP 503 `Audio was not saved to permanent Storage`, `L321-328`).
  - `POST /media/generate-card-audio` (`L338-376`): 2 `run_db` скоупа (`_prepare_card_audio_request` проверяет карточку в `TMA_Card` и `can_edit_audio`; `_persist_card_audio` атомарно обновляет `TMA_Card` и `revision`) + `generate_audio(...)`.
- **Локализация проблемы в `tma/api/utils/audio.py` (`L77-180, 227-278`):**
  Функция `generate_audio` объединяет в себе две неразрывные фазы:
  1. Проверка `if is_local(): raise RuntimeError('TTS is unavailable in LOCAL')` (`L87-89`) и синтез речи через `edge_tts.Communicate` (`L124-162`) во временный файл (`/tmp/pending_audio/edge_audio_<md5>.mp3` на Vercel).
  2. Обязательная публикация `_upload_to_supabase(...)` (`L170-180, 227-278`) в бакет `audio` под именем `audio_<sha256>.mp3`/`.wav` (`x-upsert: false`) с последующей GET-верификацией SHA-256.
- **Эталон разделения уже существует в `lerne-admin`:** `GET /api/admin/voice-preview` (`lerne-admin/src/lerne_admin/routers/media.py:632-694`) стримит `edge_tts` напрямую в память и возвращает `Response(content=audio_bytes, media_type="audio/mpeg")` **без записи в Supabase Storage и без записи в PostgreSQL**.

### 4.4. Вывод по переиспользованию ИИ и TTS для Android
**[Подтверждено кодом]**
1. **ИИ-генерация (`POST /cards/ai-generate`, `/cards/ai-generate-batch`, `/cards/ai-enrich-batch` без `deck_id`) полностью stateless по отношению к `TMA_Card`:** при наличии серверной аутентификации Android может вызывать те же эндпоинты через API без переноса ключей/промптов на клиент и без создания второй серверной логики, сохраняя полученный `content_v2` сразу в локальный Dexie. Исключения — `POST /ai/evaluate-answer` и `POST /media/generate-card-audio`, которые требуют существующего `card_id` в `TMA_Card` (неприменимы для несинхронизированных локальных карточек с `id > 1_000_000` без передачи payload или предварительной синхронизации).
2. **TTS без обязательной облачной публикации:** выделение внутренней функции чистого синтеза в `tma/api/utils/audio.py` (например, `synthesize_tts_bytes(...) -> (bytes, boundaries)` по образцу `voice-preview`) позволяет:
   - сохранить прежнее поведение `POST /media/generate-audio` и `POST /media/generate-card-audio` (синтез + загрузка в Storage + обновление БД);
   - отдавать сырые MP3-байты через защищённый stateless-эндпоинт для Android, где клиент сохранит их как `archive_<sha256>.mp3` локально через `storeLocalMediaFile` без лишних записей в Supabase Storage и PostgreSQL.

---

## 5. C4. Медиа: локальное/облачное хранение, целостность, дедупликация и очистка

### 5.1. Локальное хранение и форматы путей
**[Подтверждено кодом]**
- **Android (Capacitor `OfflineMaterialArchivePlugin.java:58-80`, `localMediaWriter.js:50-69`):**
  - Путь хранения: `getFilesDir()/lerne-offline-media/<folder>/archive_<sha256>.<ext>` (допустимые `<folder>`: `images`, `audio`, `videos`, `backgrounds`; паттерн имени `^archive_[a-f0-9]{64}\.[a-z0-9]{2,4}$`). Staging-каталог при ZIP-распаковке: `getCacheDir()/lerne-archive-staging`.
  - Атомарная запись: временный `.partial`-файл + `fsync` + `renameTo` (защита от обрыва записи/питания).
  - Бинарная валидация: изображения декодируются через `BitmapFactory` (лимит `MAX_IMAGE_PIXELS = 25_000_000`), аудио — проверка заголовков MP3 frame sync/ID3, WAV (`RIFF`+`fmt `+`data`), OGG, FLAC, M4A, видео — MP4/WebM.
  - Отображение в WebView: `resolveOfflineMediaUrlSync` -> `Capacitor.convertFileSrc(...)` (`/_capacitor_file_/...`).
- **Браузерный Standalone (`offlineMediaStore.js:71-120`):** при отсутствии нативного плагина ассеты хранятся в таблице `media` Dexie с проверкой SHA-256/размера (`storeWebMediaAssets`) и раздачей через `URL.createObjectURL`.
- **Web и Telegram (онлайн, `app/src/services/mediaCache.js:5-78`):**
  - Кеш `database.media` в Dexie: `MAX_FILE_BYTES = 15 MiB`, суммарный бюджет `MAX_CACHE_BYTES = 150 MiB`, таймаут скачивания `10s`, до `4` одновременных загрузок. При превышении 150 MiB (сумма считается полным обходом `database.media.each` внутри `rw`-транзакции, `L54-56`) новые файлы просто не кешируются (LRU-вытеснения и проверки SHA-256 нет). Созданные `URL.createObjectURL` хранятся в модульном `Map` `objectUrls` без явного `revokeObjectURL`.
  - Аудио в онлайне резолвится через `getAudioUrl` (`app/src/utils/media.js:5, 13-33`) напрямую на публичный CDN Supabase `https://wdopyuulhiykrextyvnt.supabase.co/storage/v1/object/public/audio/...` (с перенаправлением устаревшего бакета `tma-audio` на `audio`).
- **Web Offline (контекст D10, `[Подтверждено кодом]`):** в `app/` полностью отсутствуют Service Worker, Workbox, Web App Manifest, `CacheStorage`, OPFS (`getDirectory`), `navigator.storage.persist()` и `navigator.storage.estimate()`, а `app/index.html:5-7` отдаёт `Cache-Control: no-cache, no-store, must-revalidate`. Вследствие этого Web/Telegram-клиент не может загрузиться офлайн без открытой вкладки, а кеш IndexedDB подвержен политике вытеснения браузера (включая 7-дневное ограничение Safari/WebKit ITP).

### 5.2. Облачное хранение, дедупликация и пробелы ACL
**[Подтверждено кодом]**

| Категория медиа | Именование и дедупликация | Где хранится | Поведение `GET /api/media/*` |
|---|---|---|---|
| **Локальные медиа (Android/ZIP)** | `archive_<sha256>.<ext>` — **SHA-256 дедупликация** | ФС приложения (`lerne-offline-media`) или Dexie `media` | `Capacitor.convertFileSrc` / `blob:` |
| **Облачное `audio`** | `audio_<sha256>.mp3`/`.wav` (`api/utils/audio.py:250`) — **SHA-256 дедупликация**, `x-upsert: false` + GET-верификация SHA-256 (`L261-274`). Проверка существования в `storage.objects` при записи карточки (`validate_new_audio_paths`, `api/services/media.py:93`). | Supabase Storage bucket `audio` (или legacy `TMAMedia`) | `GET /api/media/audio/{filename}` (`api/routers/media.py:484-507`) -> `pending_audio` на диске или **`307` Redirect** на публичный URL Supabase Storage. |
| **Облачное `images`** | `upload_<user_id>_<12hex>.webp` (`api/routers/media.py:162`) после `optimize_image` (WebP) — **контентной дедупликации нет** (каждая загрузка создаёт уникальный файл), `x-upsert: true`. Не-ASCII имена маппятся в `legacy-<sha256>.<ext>` (`storage_object_path`). | Supabase Storage bucket `images` + метаданные (или fallback `content` для старых записей) в `TMAMedia` | `GET /api/media/images/{filename}` (`api/routers/media.py:516-562`) -> `MediaMemoryCache` (64 MiB) -> `TMAMedia.content` (с распаковкой zstd при необходимости) -> иначе **`307` Redirect** на Supabase Storage. |
| **Облачное `videos` / `backgrounds`** | `vid_*` / `bg_<user_id>_<12hex>.mp4` | `TMAMedia.content` в PostgreSQL | `GET /api/media/videos/{filename}` и `/backgrounds/{filename}` (`media.py:636-656`) читают BLOB целиком из PostgreSQL и отдают через FastAPI (`get_range_response` с `206 Partial Content`). |

- **Пробел ACL на чтении медиа (`[Подтверждено кодом]`):** все четыре GET-маршрута в `api/routers/media.py:484-656` не имеют зависимости `Depends(get_user_id)` и не проверяют права доступа к колоде/карточке; публичные бакеты Supabase Storage также доступны по прямому URL любому знающему имя файла. Напротив, запись через `POST /api/media/generate-card-audio` (`L351`) проверяет `can_edit_audio(user_id, 'deck', card.deck_id)`.

### 5.3. Обработка отсутствующих/битых файлов, ZIP-архивы и админская очистка
**[Подтверждено кодом]**
- **ZIP импорт/экспорт (`materialArchive.js:880-922`):** строгая политика fail-fast — при расхождении состава ZIP с `manifest.json`, битой контрольной сумме `manifest.sha256` или отсутствии/повреждении любого медиафайла импорт или экспорт прерывается с явной ошибкой без частичного повреждения БД.
- **Воспроизведение и отображение в UI:**
  - `app/src/components/study/StudyCardImage.jsx:56-77`: при ошибке загрузки изображения выполняет до **2 автоматических повторов** (через `800 ms` и `1800 ms`), затем переходит в состояние `error` с кнопкой ручного повтора.
  - `app/src/hooks/useAudio.js:270-292`: при ошибке загрузки/декодирования аудио выполняет **1 автоматический повтор** (через `500 ms`), после чего передаёт ошибку в callback `onPlaybackError`.
- **Бэкапы и восстановление Storage:** скрипты `tma/tools/backup_supabase_storage.py` и сервисы `lerne-admin` (`services/backup_service.py`, `services/material_archive.py`).
- **Админская очистка медиа (`lerne-admin/src/lerne_admin/routers/media.py:47-150, 395-430`):**
  - `_get_images_catalog` и `POST /api/admin/media/cleanup-orphaned` (`cleanup_orphaned_images`) анализируют и удаляют **исключительно строки `TMAMedia` с `folder == "images"`**.
  - При сборе активных ссылок (`_native_image_references`, `L47-57`) намеренно учитываются даже **soft-deleted карточки**, чтобы восстановление из корзины не потеряло иллюстрации.
  - Очистка **не удаляет** файлы из бакетов Supabase Storage и **не затрагивает бакет `audio`**.
- **Зафиксированный архитектурный инвариант для V3:** автоудаление аудиофайлов при удалении карточки (на клиенте или бэкенде) **не предлагается и не должно внедряться**, поскольку облачные и локальные аудиофайлы контент-адресуемы (`audio_<sha256>` / `archive_<sha256>`) и могут разделяться между несколькими карточками, копиями колод и архивами; очистка неиспользуемых ресурсов остаётся прерогативой контролируемых админских инструментов.

---

## 6. C5. Существующая синхронизация (`/sync/v2/*`) и Material Transfer Admin

### 6.1. Клиентская оркестрация и транспорт `syncService.js`
**[Подтверждено кодом]**
- **Блокировка и точка входа (`app/src/services/syncService.js:204-225`):**
  - `syncService.sync(options)` отклоняет запуск при `IS_STANDALONE`, `!navigator.onLine` или отсутствии `accessToken`/`userId`/`sessionIdentity`.
  - Берёт межвкладочный Web Lock `'lerne-offline-sync'` с `{ ifAvailable: true }` (`L216`). При занятом локе возвращает `'Already syncing'`.
- **Строгая последовательность фаз `runSync()` (`syncService.js:227-416`):**
  1. `prepareLocalDb()` (`L257`) — открывает БД текущего аккаунта (`LerneLocalDB_<userId>`).
  2. Проверка поколения сервера (`L259-262`): если `!background` (или если `background && hasWork`), вызывает `GET /sync/v2/status` -> `observeServerGeneration`.
  3. **Native V2 Card Outbox** (`deliverCardOutbox`, `L290`, реализован в `app/src/services/cardOutboxSync.js:358-374`): последовательно дренирует `card-create-v2:`, `card-edit-v2:`, `card-move-v2:`, `card-lifecycle-v2:`.
     - Создания (`POST /cards/save`) и редактирования (`PATCH /cards/{id}`) отправляются по **1 HTTP-запросу на карточку**; перемещения, копирования, массовое удаление и смена порядка отправляются пакетами (до `MAX_DOCUMENT_CARDS = 1000` на запрос).
  4. **Entity/SRS Batch** (`deliverEntityBatch`, `L295`, реализован в `app/src/services/entityBatchSync.js:142-198`): собирает `syncState.pending`, грязные `folders`/`decks`/`progress` и события `review:*` и отправляет в `POST /sync/v2/push` (или `/sync/v2/push-legacy` при наличии `guarded`-сущностей, `L177`).
  5. **Флаги обучения колод** (`syncLearningPreferences`, `L302`, `entityBatchSync.js:129-140`): по 1 `POST /decks/{id}/toggle-learning` на каждую колоду с `learning_dirty`.
  6. **Личные заметки** (`syncCardNotes`, `L305`, `app/src/services/cardNotes.js:10-44`): под отдельным Web Lock `lerne-card-notes-${db.name}` отправляет по 1 `PUT /card-notes/{resolvedId}/{row.id}` (пропуская временные отрицательные `card_id`, пока не появятся `aliases`).
  7. **Pull снимка** (`L309-360`): блокируется, если остались неподтверждённые создания (`unacknowledgedCreates > 0`, `L309-310`), чтобы не создать дубликат до ремапа временного ID. Иначе вызывает `GET /sync/v2/pull?card_schema=2&snapshot_version=...&content_version=...` (`L318-320`).
  8. **Финальная сверка cutover** (`L378-380`, только при ручной синхронизации).
- **Отдельные параллельные потоки синхронизации:**
  - `knowledgeSyncOrchestrator.js` + `knowledgeSyncService.js`: таблица `knowledge_attempt_outbox` -> `POST /knowledge/attempts/sync` батчами `BATCH_SIZE = 100`, до `MAX_BATCHES_PER_RUN = 5`.
  - `useSettingsStore.js`: `POST /user/settings` / `GET /user/settings` (персональные настройки и Design V2).
- **Перехватчик `networkApi.js:104-196`:** автоматически прикрепляет заголовок `X-Lerne-Generation`, добавляет `_t=${Date.now()}` ко всем `GET` (обход кеширования), дедуплицирует `GET /sync/v2/status` в полёте (`refreshFlights`), и при `401` сериализует refresh через Web Lock `'lerne-auth-v2-refresh'` или аренду `auth-v2-refresh-lease` в Dexie (`100ms` polling).

### 6.2. Серверные контракты, CAS, ответы 409, идемпотентность и tombstones
**[Подтверждено кодом]**

| Механизм | Реализация в коде | Поведение и защита данных |
|---|---|---|
| **`POST /api/sync/v2/push`** (`/v2/push-legacy`) | `api/routers/sync.py:18-133`, `api/services/offline_sync.py:57-290` | Принимает `request_id: UUID`, `folders`, `decks`, `cards`, `progress`, `reviews` (`action_id: UUID`, `rating 0..7`, `review_context`, `review_time`), `drain_bases`. **Любой непустой `cards` отклоняется с HTTP 409 `legacy_queue_requires_recovery`** (`L108-110`), так как V2-карточки идут через `/cards/*`. События `reviews` применяют серверный `srs.review_card()` под `TMAProgress ... FOR UPDATE` (`study.py:43-45`) с сохранением `review_time`, а снимок `progress` для той же карточки очищается от SRS-полей (сохраняются только `flag` / `want_to_learn`). При `flag_only=True` обновляется только `flag`. |
| **`GET /api/sync/v2/pull`** | `api/routers/sync.py:135-141`, `api/services/offline_sync.py:293-417` | Изоляция `REPEATABLE READ` на PostgreSQL (`L305`). Возвращает `protocol: 2`, `server_generation`, `restored`, `card_schema: 2`, `server_time`, `snapshot_version`, `content_version`, `deck_summary_version`, `catalogue_version`. Статусы: **`unchanged`** (опускает массивы данных), **`progress_only`** (возвращает только `progress`), **`success`** (полный снимок всех доступных `folders`, `decks`, `cards` и `progress`). |
| **`GET /api/sync/v2/status`** | `api/routers/sync.py:144-148`, `api/services/sync_generation.py:20-41` | Освобождён от проверки `X-Lerne-Generation`. Вычисляет SHA-256 `server_generation` по `TMASetting('SYNC_DATABASE_RESTORE')` и `pg_class` OID таблиц `tma_card`, `tma_deck`, `tmasetting`. |
| **`GET /api/sync/collab-pull`** | `api/routers/sync.py:157-165`, `api/services/sync_service.py:20-35` | Быстрая проверка `has_changes` по `updated_at > since` в доступных папках/колодах/карточках + `access_version` (`TMA_Collaborator` count + max id). |
| **Квитанции идемпотентности (`TMAOfflineBatch`)** | `api/services/receipts.py:27-35`, `offline_sync.py:70`, `study.py:32`, `structured_card_api.py:266` | Префиксы ключей: `{user_id}:{request_id}`, `grade:{user_id}:{action_id}`, `cards-v2:{op}:{user_id}:{request_id}`, `classify:{user_id}:{op_id}`, `ai:{user_id}:{import_id}`. При повторном запросе с тем же `payload_hash` отдаёт сохранённый ответ; при другом `payload_hash` возвращает **HTTP 409**. **Важно:** в `TMA` отсутствует TTL или очистка `TMAOfflineBatch` — таблица растёт неограниченно (включая полные JSON-ответы `response`). |
| **CAS и ответы HTTP 409** | `structured_card_api.py:221,390,456+`, `sync_generation.py:44-48`, `offline_sync.py:75-89,191-194` | 1) **Generation CAS:** несовпадение `X-Lerne-Generation` -> `409 database_generation_conflict`; клиент переводит БД в карантин (`serverGenerationConflict`).<br>2) **Card Revision CAS:** `revision = sha256_canonical([id, deck_id, position, updated_at, content_v2_raw, *media])`. При несовпадении -> `409 card_revision_conflict`. В `cardOutboxSync.js:151-179` карточка помечается `offline_edit.status = 'conflict'`, прекращает повторные `PATCH` и ждёт ручного выбора пользователя (`resolveCardEdit`).<br>3) **Progress/Legacy CAS:** `drain_bases` -> `409 legacy_revision_conflict` / `legacy_base_unknown` (`422 legacy_invalid_base`).<br>4) **Deck metadata / Personal Design V2 CAS:** `409` при расхождении `metadata` или `revision`. |
| **Tombstones** | `offline_sync.py:343-349`, `syncService.js:100-109` | Мягкое удаление (`is_deleted = True`) собственных папок/колод/карточек явно включается в `/sync/v2/pull`. Полное удаление из БД или отзыв прав `TMA_Collaborator` определяются на клиенте по разности множеств в `applySnapshot` (только если `!item.is_dirty && !keepLocalCard(...)`). |

### 6.3. Обоснование безопасного расширения `/sync/v2` вместо замены синхронизатора
**[Подтверждено кодом и замером]**
Замена `/sync/v2` новым протоколом несёт высокий риск регрессий, поскольку в существующем контуре уже отлажены критические инварианты сохранности данных: транзакционные квитанции `TMAOfflineBatch` (защита от двойного применения оценок при потере ACK), строгий порядок фаз (блокировка pull при неподтверждённых `creates`), `aliases` для каскадного ремапа `card_notes` и `knowledge_attempt_outbox`, приоритет UUID `reviews` перед `flag_only`-снимком `progress`, карантин `X-Lerne-Generation` и CAS по `revision`/`drain_bases`.

**Низкорисковые точки расширения внутри `/sync/v2`:**
1. **Инкрементальный дельта-режим для `/sync/v2/pull`:** добавление опционального курсора (`since` / `cursor`) с возвратом только изменившихся/удалённых строк и флагом `full_sync_required` при изменении ACL/поколения. Клиентский `applySnapshot` (`syncService.js:83-110`) уже умеет выполнять merge по ID.
2. **Удешевление проверки `unchanged` и отказ от обязательной доставки всех `global_readonly`-колод в каждый pull:** устранение глобального сканирования `tma_folder` и двойного вызова `generation_state()`.
3. **Пакетная отправка native V2 мутаций:** добавление батч-обработки `creates`/`edits` (или поддержка `content_v2` в `/sync/v2/push` через существующие валидаторы `structured_card_api.py` и квитанции `TMAOfflineBatch`) для сокращения N+1 HTTP-запросов после работы в офлайне.
4. **Переход к ручной синхронизации (согласно R7.3):** отключение или гейтирование 60-секундных интервалов в `useAppInitialization.js` и `knowledgeSyncOrchestrator.js` и 4-секундного поллинга `useCollaborativePresence.js` без ломки самого протокола `/sync/v2`.

### 6.4. Material Transfer в `lerne-admin`
**[Подтверждено кодом]**
Реализован в `lerne-admin/src/lerne_admin/transfer_worker.py` (`L63-158`) и `lerne-admin/src/lerne_admin/services/material_transfer.py` (`L1-1897`), полностью изолирован от пользовательского обучения:
- **Периметр запуска (`transfer_worker.py`):** отдельный короткоживущий subprocess с `PYTHON_DOTENV_DISABLED=1`, `LERNE_SKIP_SCHEMA_INIT=1`, `RUN_MIGRATIONS=false`, внешними конфигами (`config/local.json`, `config/transfer.json`) и эксклюзивной блокировкой PostgreSQL `pg_try_advisory_lock(734102022)` (`L83`) на локальной БД при `preview`/`apply`.
- **3-уровневое Discovery (`material_transfer.py:867-1462`):**
  1. Level 1: вычисляет дайджесты колод в LOCAL средствами PostgreSQL (`md5(string_agg(md5(ROW(...)::text), ',' ORDER BY id))`, `L220-254`) и ревизии медиа; неизменённые сопоставленные колоды пропускаются без выгрузки карточек (`L1143-1148`).
  2. Level 2: загружает карточки только для изменённых колод (`L1152`).
  3. Level 3: открывает `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY` (`L44-56, 1315`) на Supabase **только** по изменённым/удалённым ID и именам `TMAMedia` (0 HTTP-запросов к Storage на этапе discover).
- **Контроль целостности при `preview`/`apply` (`L1494-1897`):** лимиты пакета (`200` папок, `1000` колод, `2000` карточек, `500` медиа); проверка привязки баз (`pg_database` OID + `pg_control_system()`); совместимость схем; двойное подтверждение удалений (`allow_deletions` + `confirm_deletions`); квитанции `TMAOfflineBatch` (`transfer-apply:{namespace}:{job_id}`, `transfer-map:{namespace}:...`); метки времени берутся с целевой БД (`SELECT LOCALTIMESTAMP`, `L1802`).
- **Строгая изоляция от пользовательского SRS (`L25-40, 59-78`):**
  - `FIELDS` включает только поля материалов (`folder`: `name, color, target_language, position, is_deleted, parent_id`; `deck`: `name, level, topic, target_language, position, is_deleted, folder_id, metadata`; `card`: `content_v2, image_path, audio_path, audio_back_path, video_front_path, video_back_path, difficulty, source, position, is_deleted, deck_id`).
  - `FORBIDDEN` (`L35-40`) рекурсивно блокирует любые ключи `metadata`, содержащие `progress`, `srs`, `review_history`, `history`, `user_progress`, `next_review`, `last_reviewed`, `ease_factor`, `repetitions`, `lapses`, `review_count`, либо секреты/токены (`material_metadata`, `L59-78`).
  - Таблицы `TMAProgress`, `TMAReviewHistory`, `TMAKnowledgeAttempt`, `TMAUserKnowledgeState`, `TMACardNote`, `TMA_Collaborator`, `TMASetting` не читаются и не изменяются; вызывается только `touch_deck_and_parent_folders` (`L1863`), чтобы пользовательский `/sync/v2/pull` увидел обновление контента.
- **Ограничение относительно `scope='library'` и `global_readonly` (контекст D9):**
  - При `direction == 'publish'` для папки и `is_admin(target.user_id)` опция `public_original` (`L1586-1592, 1623-1630`) выставляет `access_scope = 'global_readonly'` на корневой папке.
  - Однако колоды каталога `scope='library'` (`user_id IS NULL`) `material_transfer.py` переносить не умеет (`FIELDS['deck']` не включает `scope`, `category_id`, `is_default`, а `get_effective_user_role` возвращает `None` для `scope != 'personal'`). Напротив, `lerne-admin/src/lerne_admin/services/material_archive.py` экспортирует/импортирует `scope='library'`, но сбрасывает `global_readonly` в `'private'`.

---

## 7. C6. Воспроизводимый локальный baseline производительности и источники нагрузки

### 7.1. Инвентаризация фоновых таймеров и поллингов
**[Подтверждено кодом]**

| Компонент и источник | Интервал / триггер | Вызываемые эндпоинты | Условия срабатывания |
|---|---|---|---|
| `useAppInitialization.js` (`L17-19, 105, 118-200`) | `setInterval` **60 000 ms** (`SYNC_INTERVAL_MS`), `visibilitychange` (окно `1500 ms`), `online`, запуск приложения | `GET /sync/v2/pull` (+ `GET /sync/v2/status` при dirty/ручном запуске; + `/decks`, `/decks/{id}/cards` при неполном кеше) | `!IS_STANDALONE && navigator.onLine` **(работает даже при `offline_mode=true`, если браузер онлайн!)** |
| `useCollaborativePresence.js` (`L6, 12, 27, 41, 80-81`) | `setInterval` **4 000 ms** (`POLL_INTERVAL_MS`) + немедленно при монтировании / возврате на вкладку / `online` | `GET /collaborative/{type}/{id}/presence` (+ `fetchDeckCards` / `fetchDecks` при смене `updated_at`) | Открыта общая/совместная колода или папка, вкладка видима, `navigator.onLine` |
| `knowledgeSyncOrchestrator.js` (`L5, 24-75`) | `setInterval` **60 000 ms** (`SYNC_INTERVAL_MS`), `online`, `visibilitychange`, запуск | Сканирование Dexie `knowledge_attempt_outbox`; `POST /knowledge/attempts/sync` (если есть накопленные попытки) | `!IS_STANDALONE && userId && VITE_KNOWLEDGE_LAYER_ENABLED !== 'false'` |
| `useAuthStore.js` (`L471-474`) | `setInterval` **2 000 ms** (`beginPolling`) | `POST /auth/v2/challenges/{id}/exchange` | Только пока ожидается завершение OAuth/Telegram challenge |
| `useSettingsStore.js` (`L103, 155-168`) | Debounce **1 000 ms** (`debouncedSaveSettings`) + проверка на `visibilitychange`/`online` при устаревании `> 60 000 ms` (`SETTINGS_RECHECK_MS`) | `POST /user/settings`, `GET /user/settings` | `!IS_STANDALONE` при изменении настроек или истечении 60с |

### 7.2. Подтверждённые результаты локальных прогонов и baseline-замеров

#### A. Изолированные автотесты (подтверждены непосредственным запуском в контуре аудита)
- **`npm --prefix app test`:** **410 тестов в 9 наборах — 410 PASS, 0 FAIL** (`8126.35 ms`, повторный запуск в том же состоянии без изменений кода; в предыдущем прогоне `8.75s`).
- **`venv\Scripts\python.exe scripts/test_backend.py scripts/tests/test_sync_read_queries.py`:** **13 тестов — 13 PASS (OK)** (`1.671s`).
- **`venv\Scripts\python.exe scripts/test_backend.py scripts/tests/test_offline_sync.py`:** **11 тестов — 11 PASS (OK)** (`0.311s`).

#### B. Инструментированный baseline 9 ключевых операций на одноразовом PostgreSQL 17.11 и SQLite in-memory
**[Подтверждено замером]**  
**Синтетический фикстур (0 доступа к production):** 2 пользователя (`User 1`, `User 2`), 5 личных папок + 1 общая папка (`User 1 = editor`), 10 личных колод + 1 общая колода, **275 карточек Native V2** (по 25 в колоде, в каждой объяснение из 10× `'Context '`), **150 строк `TMAProgress`** у `User 1`. Запросы выполнялись через `TestClient(app)` с реальной Bearer-сессией (`auth_v2`) и заголовком `X-Lerne-Generation`, с обёрткой `db.execute_sql` и методов выборки курсора.

**Таблица 1. Одноразовый PostgreSQL 17.11 (`postgres=True`, реальный SQL-путь production):**

| Операция | HTTP статус | HTTP байты | Время, ms (loopback) | SQL всего | SQL SELECT | SQL Write | Строк из SQL | Байт из SQL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `GET /api/sync/v2/status` | 200 | 105 | 257.30 | 7 | 7 | 0 | 7 | 484 |
| `GET /api/sync/v2/pull` (холодный полный, 275 карточек) | 200 | 205,031 | 238.97 | 28 | 28 | 0 | 499 | 100,662 |
| **`GET /api/sync/v2/pull` (`unchanged`)** | **200** | **552** | **287.57** | **26** | **26** | **0** | **74** | **1,798** |
| `GET /api/sync/v2/pull` (`progress_only`, 150 строк) | 200 | 37,962 | 174.00 | 27 | 27 | 0 | 224 | 9,041 |
| `POST /api/sync/v2/push` (1 `flag_only` + 1 UUID review) | 200 | 134 | 264.63 | 27 | 18 | 7 | 18 | 1,008 |
| `GET /api/init` | 200 | 6,329 | 474.74 | 40 | 36 | 2* | 104 | 3,100 |
| `GET /api/decks` | 200 | 4,748 | 287.85 | 21 | 21 | 0 | 64 | 1,831 |
| `GET /api/decks/1/cards` (25 карточек) | 200 | 20,757 | 285.43 | 13 | 13 | 0 | 61 | 8,624 |
| `GET /api/collaborative/deck/11/presence` | 200 | 465 | 147.82 | 26 | 26 | 0 | 23 | 891 |

*\*Примечание: `GET /api/init` выполнил 2 записи на первом запуске, так как `ensure_inbox_folder`/`ensure_inbox_deck` создали папку и колоду «Входящие» при первичной инициализации пользователя.*

**Таблица 2. SQLite in-memory (`postgres=False`, тот же синтетический фикстур):**

| Операция | HTTP статус | HTTP байты | Время, ms | SQL всего | SELECT | Write | Tx | Строк из SQL | Байт из SQL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `GET /api/sync/v2/status` | 200 | 105 | 13.30 | 7 | 6 | 0 | 1 | 4 | 443 |
| `GET /api/sync/v2/pull` (полный) | 200 | 205,031 | 99.72 | 26 | 24 | 0 | 2 | 491 | 98,633 |
| **`GET /api/sync/v2/pull` (`unchanged`)** | **200** | **552** | **100.84** | **26** | **24** | **0** | **2** | **491** | **98,633** |
| `GET /api/sync/v2/pull` (`progress_only`) | 200 | 37,962 | 94.63 | 26 | 24 | 0 | 2 | 491 | 98,634 |
| `POST /api/sync/v2/push` | 200 | 134 | 18.06 | 27 | 16 | 7 | 4 | 14 | 868 |
| `GET /api/init` | 200 | 6,329 | 32.62 | 40 | 34 | 2 | 4 | 101 | 2,637 |
| `GET /api/decks` | 200 | 4,748 | 19.87 | 21 | 20 | 0 | 1 | 61 | 1,562 |
| `GET /api/decks/1/cards` | 200 | 20,757 | 16.90 | 13 | 12 | 0 | 1 | 58 | 8,471 |
| `GET /api/collaborative/deck/11/presence` | 200 | 465 | 15.51 | 26 | 25 | 0 | 1 | 20 | 772 |

*(В SQLite-ветке `offline_sync.py:400` даже на `unchanged` вызывает `read_study_rows()`, считывая и сериализуя все 491 строку / 98,633 B перед сравнением хэшей, тогда как в PostgreSQL работает MVCC-хэширование `_row_versions`.)*

#### C. Точная разбивка 26 SQL `SELECT` неизменённого `GET /api/sync/v2/pull` на PostgreSQL 17.11
**[Подтверждено замером и кодом]**
Даже когда ни одна строка на сервере не изменилась (`status == "unchanged"`), один вызов `GET /api/sync/v2/pull` открывает 3 отдельных скоупа работы с БД и выполняет **26 SQL `SELECT` запросов**:
1. **Запросы [1–4] — аутентификация (`api/auth/service.py:242-296`, `transactions.py:29-31`):** 4 `SELECT`, включая **2 строковые блокировки `FOR UPDATE`**: `tma_auth_token`, `tma_auth_session`, `tma_auth_account ... FOR UPDATE`, `tma_auth_session ... FOR UPDATE`.
2. **Запросы [5–7] — проверка поколения БД (`api/dependencies/auth.py:14-16` -> `sync_generation.py:20-48`):** 3 `SELECT` (`TMASetting` `SYNC_DATABASE_RESTORE`, `pg_class` OIDs для `tma_card`/`tma_deck`/`tmasetting`, `TMASetting` `SYNC_GENERATION_ANCHOR`).
3. **Запрос [8] — проверка флага пользователя (`offline_sync.py:295`):** 1 `SELECT` `TMAUser.default_decks_initialized`.
4. **Запросы [9–19] — сбор области видимости, ACL и настроек обучения (`offline_sync.py:339-363`):** 11 `SELECT`:
   - `tma_folder` **полное сканирование всех активных папок всей платформы** (`get_folder_access_map()`, `collaborative_service.py:91-97`);
   - `tma_collaborator` (права на папки), `tma_deck` (свои активные), `tma_collaborator` (права на колоды), `tma_deck` (активные в доступных папках);
   - `tma_folder` и `tma_deck` собственные (включая `is_deleted`, для доставки tombstones);
   - полная загрузка строк `tma_folder` и `tma_deck` по `id IN (...)`;
   - пакетный расчёт ролей `tma_collaborator` и загрузка `TMASetting` (`DECK_LEARNING_*`).
5. **Запросы [20–22] — дублирующий вызов `generation_state()` (`offline_sync.py:390`):** **3 повторных `SELECT`**, полностью идентичных шагам [5–7].
6. **Запросы [23–24] — `_deck_summary_versions` (`offline_sync.py:316-331, 394`):** 2 `SELECT` (библиотечные колоды `scope='library'` + агрегация `due` в `TMAProgress JOIN TMA_Card GROUP BY deck_id`).
7. **Запросы [25–26] — `_row_versions` (`offline_sync.py:309-313, 397`):** 2 `SELECT`, вычисляющие `MD5(STRING_AGG(CONCAT_WS(':', id, xmin::text, ctid::text, updated_at), ',' ORDER BY id))` по всем доступным пользователю строкам `tma_card` и `tmaprogress`.

Аналогично, один запрос **`GET /api/collaborative/deck/{id}/presence`** на PostgreSQL 17.11 выполняет **26 SQL `SELECT`**: 4 на аутентификацию + 3 на `generation_state` + рекурсивный обход родительских папок в `get_effective_user_role` + цикл предков в `record_and_get_presence` + N+1 запросы `TMAUser` и `get_effective_user_role` для каждого участника в `get_collaborators`. При этом само состояние присутствия `_active_presence_map` (`collaborative_service.py:1032`) хранится в памяти процесса Python (`dict`), а не в БД.

### 7.3. Результаты запуска браузерного бенчмарка `--background-sync-browser`
**[Подтверждено замером]**
- Запущенная команда (в `C:\121\Lerne_projekt\tma`):
  ```powershell
  venv\Scripts\python.exe scripts\tests\structured_cards_postgres.py --bin-dir C:\121\Lerne_projekt\tools\pgsql\bin --background-sync-browser
  ```
- **Фактический результат:** одноразовый PostgreSQL 17.11, Vite dev server и Chromium запустились успешно, однако выполнение завершилось **с кодом выхода 1** на этапе `before` (подстановка `CLIENT_FILES` из исторического коммита `30737439fe3ad77f4ab2cdc307941a4934de78ad` поверх текущего `app/`):
  ```text
  locator.waitFor: Timeout 30000ms exceeded.
  Call log:
    - waiting for locator('.deck-main-action').filter({ hasText: 'Sync benchmark deck' }) to be visible
      at C:\121\Lerne_projekt\tma\scripts\tests\background_sync_browser.cjs:122:22
  ```
- **Техническая причина:** в `background_sync_postgres.py:133-157` прогон `variant='before'` (в фазе `cold`) не дождался отрисовки `.deck-main-action` за 30 секунд на фоне холодной оптимизации зависимостей Vite (`before-vite.log`: `scanning dependencies...` / `bundling dependencies...`) и/или несовместимости подменённых клиентских файлов от `30737439` с текущими модулями `HEAD`. Поскольку `subprocess.run(..., check=True)` прервался на `before`, файлы `before.json` и `after.json` не были созданы, а `variant='after'` не запускался.
- **Соблюдение честности метрик:** значения браузерных HTTP-счётчиков, байтов, `X-Sync-SQL` и `X-Sync-Decodes` из данного прогона **не получены и не приводятся**.

### 7.4. Воспроизводимая инструкция запуска baseline локально
1. **Изолированные клиентские и серверные тесты (без БД и сети):**
   ```powershell
   cd C:\121\Lerne_projekt\tma
   npm --prefix app test
   venv\Scripts\python.exe scripts/test_backend.py scripts/tests/test_sync_read_queries.py
   venv\Scripts\python.exe scripts/test_backend.py scripts/tests/test_offline_sync.py
   ```
2. **Одноразовый PostgreSQL 17.11 для SQL/HTTP baseline (строго локально, без `.env` и production):**
   - Убедиться в наличии бинарников PostgreSQL 17.11 в `C:\121\Lerne_projekt\tools\pgsql\bin\`.
   - Инициализировать и поднять временный кластер в игнорируемом каталоге (`local/test-data/...`) на свободном loopback-порту через `initdb.exe` и `pg_ctl.exe` с `PYTHON_DOTENV_DISABLED=1`, `RUN_MIGRATIONS=false`.
   - Инициализировать таблицы `models.tma_db` и `models.lerne_db`, засеять синтетический фикстур (2 пользователя, папки/колоды, 275 Native V2 карточек, 150 `TMAProgress`, `TMAAuthAccount` + `_create_session()`).
   - Обернуть `db.execute_sql` и методы курсора для подсчёта запросов/строк/байт и прогнать 9 операций через `TestClient(app)` с заголовками `Authorization: Bearer <token>` и `X-Lerne-Generation: <hash>` (как в таблице 1 выше).
3. **Повторный запуск браузерного стенда (при необходимости доработки `background_sync_postgres.py`):**
   ```powershell
   venv\Scripts\python.exe scripts\tests\structured_cards_postgres.py --bin-dir C:\121\Lerne_projekt\tools\pgsql\bin --background-sync-browser
   ```

---

## 8. Ранжированный список 8 наиболее значимых источников нагрузки (Vercel, Supabase, клиент)

Ниже приведены 8 приоритетных источников нагрузки с чётким отделением подтверждённых фактов/замеров от обоснованных гипотез масштабирования.

1. **Фоновый поллинг `GET /sync/v2/pull` каждые 60 секунд на всех открытых клиентах**
   - **[Подтверждено замером и кодом]** `useAppInitialization.js:17, 194-199` запускает `syncService.sync({ background: true })` каждые 60 с (+ при `visibilitychange` и `online`), причём **даже при `offline_mode=true`**, если `navigator.onLine === true`. На PG 17.11 даже полностью неизменённый `pull` (`unchanged`) выполняет **26 SQL `SELECT`** в **3 подключениях**, берёт **2 блокировки `FOR UPDATE`**, сканирует всю таблицу `tma_folder` и пересчитывает `MD5(STRING_AGG(...))` по всем карточкам и прогрессу.
   - **[Гипотеза по коду]** При $N$ одновременно открытых вкладках/WebView в состоянии простоя платформа получает порядка $N$ вызовов Vercel/мин и $26N$ SQL-запросов/мин без полезной работы, а также риск регулярного пробуждения и холодных стартов Serverless-функций.

2. **Амплификация полного снимка `/sync/v2/pull` и `applySnapshot` при любом изменении контента**
   - **[Подтверждено замером и кодом]** Для 275 карточек один полный `GET /api/sync/v2/pull` возвращает **205 031 HTTP-байт** (499 SQL-строк / 100 662 SQL-байт, `offline_sync.py:357-417`). На клиенте `applySnapshot` (`syncService.js:58-119`) загружает в память **100% таблиц** `folders`, `decks`, `cards`, `progress` через `toArray()` внутри одной `rw`-транзакции Dexie и поэлементно сравнивает каждую строку (`sameSnapshotRecord`).
   - **[Гипотеза по коду]** Так как `get_user_accessible_folder_ids` (`collaborative_service.py:1018`) безусловно включает все `global_readonly` папки в снимок **каждого** пользователя, одна правка официального курса или колоды с 2000–5000 карточек инвалидирует `content_version` сразу для всех онлайн-клиентов, провоцируя многомегабайтный egress Supabase/Vercel, нагрузку CPU на JSON-сериализацию (`decode_v2_content`) и задержки IndexedDB на мобильных устройствах.

3. **4-секундный поллинг присутствия `GET /api/collaborative/{type}/{id}/presence`**
   - **[Подтверждено замером и кодом]** `useCollaborativePresence.js:6, 80-81` опрашивает сервер каждые **4 000 ms**, пока открыта общая колода/папка. Один вызов на PG 17.11 стоит **26 SQL `SELECT`** (аутентификация, `generation`, рекурсия предков и N+1 по списку участников), тогда как сам кэш присутствия `_active_presence_map` (`collaborative_service.py:1032`) хранится в локальном `dict` процесса.
   - **[Гипотеза по коду]** Один пользователь за 10 минут просмотра общей колоды создаёт **150 HTTP-вызовов на Vercel и 3 900 SQL-запросов к Supabase**, при этом на многопроцессном/serverless Vercel статус онлайн неконсистентен между инстансами.

4. **Накладные расходы аутентификации и `require_generation` на каждый HTTP-запрос**
   - **[Подтверждено замером и кодом]** Каждый защищённый маршрут (`api/dependencies/auth.py:13-16`) открывает `auth_transaction()` (**4 `SELECT` с 2 блокировками `FOR UPDATE`** на `tma_auth_account` и `tma_auth_session`), закрывает соединение, затем `require_generation()` делает ещё **3 `SELECT`** (`TMASetting` ×2 + `pg_class`), и только затем `@db_worker` открывает третье соединение для бизнес-логики. В результате даже `GET /api/sync/v2/status` требует **7 SQL `SELECT`** ради 105 байт ответа.
   - **[Гипотеза по коду]** При параллельных запросах одного пользователя (`/init` + `/sync/v2/pull` + `/user/settings` + `/knowledge`) строковые блокировки `FOR UPDATE` на `tma_auth_account`/`tma_auth_session` сериализуют параллельные запросы на уровне PostgreSQL и в 3 раза увеличивают оборот соединений на `PooledPostgresqlDatabase` (`max_connections=20`).

5. **Глобальное сканирование `tma_folder` и принудительное включение всех `global_readonly` в ACL**
   - **[Подтверждено замером и кодом]** `get_folder_access_map()` (`collaborative_service.py:91-97`) выбирает **все не удалённые строки `tma_folder` по всем пользователям системы** в каждом вызове `/sync/v2/pull`, `/api/init`, `/api/decks` и `/api/study/stats`.
   - **[Гипотеза по коду]** По мере роста числа пользователей и личных папок в БД время и объём чтения каждого `/init`, `/decks` и `/sync/v2/pull` деградируют пропорционально **общему числу папок на платформе**, а не размеру библиотеки конкретного пользователя.

6. **Тяжёлый каскад старта приложения и двойная синхронизация в `offline_mode=true`**
   - **[Подтверждено замером и кодом]** Холодный старт Web/Telegram (`useAppInitialization.js:64-115`) запускает каскад `/auth/v2/refresh` (при необходимости) + `GET /api/init` (**40 SQL-операций, 36 `SELECT`, 474.74 ms на локальном PG**) + `POST /auth/sync` + `GET /sync/v2/status` (7 SQL) + `GET /sync/v2/pull` (28 SQL, 205 KB) + `GET /user/settings`, а при `offline_mode=true` любая онлайн-мутация в `api.js:120-134` вызывает `syncService.sync()` дважды (до и после запроса).
   - **[Гипотеза по коду]** Один вход пользователя порождает 5–8 вызовов Serverless-функций и ~100+ SQL-операций, что при холодных стартах Vercel повышает риск таймаутов 504 и каскадных повторов (`requestWithRetry` ×3).

7. **Медиа-egress Supabase Storage / Vercel и чтение BLOB из `TMAMedia.content`**
   - **[Подтверждено кодом]** `mediaCache.js:27-57` фоново предзагружает до 4 медиа-URL на карточку в пер-аккаунтный Dexie-кеш (лимит 150 MiB с полным перебором `database.media.each` при каждой записи и без LRU). На бэкенде `/api/media/images/{filename}` проверяет `TMAMedia.content` до выдачи `307` на Storage, а `/api/media/videos/*` и `/backgrounds/*` (`api/routers/media.py:636-656`) до сих пор отдают бинарные BLOB из PostgreSQL напрямую через FastAPI/Vercel.
   - **[Гипотеза по коду]** Немигрированные изображения/видео в `TMAMedia.content` расходуют egress БД Supabase и память/трафик Vercel Functions, а привязка кеша `media` к `LerneLocalDB_<userId>` и отсутствие дедупликации изображений (`upload_<user_id>_<12hex>.webp`) приводят к повторным скачиваниям одних и тех же файлов из Storage.

8. **Неограниченный рост `TMAOfflineBatch` и последовательная отправка карточек/заметок (`1+1+...`)**
   - **[Подтверждено кодом]** `TMAOfflineBatch` накапливает квитанции и полные JSON-ответы для каждого `/sync/v2/push`, каждой UUID-оценки `study/grade`, каждой операции `cards-v2:*`, `classify:*` и переносов в админке, не имея ни TTL, ни фоновой очистки в `tma`. На клиенте `cardOutboxSync.js` отправляет создания и правки по 1 HTTP-запросу на карточку, `cardNotes.js` — по 1 `PUT` на заметку, а `knowledgeSyncOrchestrator.js:69` раз в 60 с сканирует `knowledge_attempt_outbox` даже при простое.
   - **[Гипотеза по коду]** Долгосрочное разрастание `TMAOfflineBatch` увеличивает объём хранилища и индексов в PostgreSQL, а последовательная выгрузка большого офлайн-пакета создаёт серию из $N$ синхронных HTTP-запросов к Vercel вместо одного батча.
