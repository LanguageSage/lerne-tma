# Lerne TMA Admin Console: Архитектурная карта (Admin Architecture & Feature Topology)

> **Назначение**: Быстрая навигация по коду локальной консоли администратора (`tools/admin/`) для ИИ-агента и разработчика. Перед внесением изменений сверяйтесь с матрицей и деревом диагностики.

---

## 1. Сквозная матрица фич консоли администратора (Intent-to-Code Matrix)

| Подсистема / Фича | Frontend UI & View (`static/index.html`) | Client Logic (`static/js/`) | Backend Router (`tools/admin/routers/`) | Backend Service / Worker (`tools/admin/services/`) | DB Model (`api/models.py`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Пользователи (Users)** | `#content-users`, сетка карточек, тулбар действий | `users.js` (`loadUsers`, `deleteSelectedUsers`, `cleanupGuestAccounts`) | `users.py` (`/api/admin/users`, `/cleanup-guests`, `/purge-deleted`) | — | `TMAUser`, `TMA_Deck`, `TMA_Folder` |
| **Колоды (Decks)** | `#content-decks`, таблица колод, быстрые фильтры, пагинация | `decks.js` (`loadDecks`, `filterDecks`, `toggleDefaultDeck`, `deduplicateDeck`) | `decks.py` (`/api/admin/decks`, `/set-default`, `/assign`, `/deduplicate`) | `deck_helpers.py` (`get_deck_and_cards`, `sync_card_updates_to_matching_decks`) | `TMA_Deck`, `Deck` (Library) |
| **Папки (Folders)** | `#content-folders`, метрики, фильтры, список папок | `folders.js` (`loadAdminFolders`, `toggleDefaultFolder`, `submitAssignFolder`) | `folders.py` (`/api/admin/folders`, `/set-default`, `/assign`, `/to-library`) | `deck_helpers.py` | `TMA_Folder`, `Folder` |
| **Карточки & Превью** | `#modal-deck-preview`, `#modal-edit-card`, таблица карточек | `cards_preview.js` (`openDeckPreviewModal`, `saveCardEdit`, `synthesizeSingleCardAudio`) | `cards.py` (`/api/admin/cards/{id}`, `/synthesize-audio`, `/decks/{id}/cards`) | `card_helpers.py` (`save_audio_to_db_or_cloud`, `card_is_fully_completed`) | `TMA_Card`, `Card`, `TMAMedia` |
| **Одиночная ИИ-студия** | `#content-ai`, колонка настроек, пресеты, плеер | `ai_studio.js` (`selectStudioPreset`, `startAiProcess`, `startAudioOnlyProcess`) | `decks.py` (`/regenerate`, `/regenerate-audio`, `/regen-status`, `/regen-control`) | `regen_worker.py` (`run_ai_regeneration`, `run_audio_regeneration`) | `TMA_Deck`, `TMA_Card`, `TMAMedia` |
| **Пакетная ИИ & Очередь** | `#header-staged-box`, `#modal-staged-decks`, плавающий док | `staged.js`, `ai_studio.js` (`toggleStageDeck`, `startBatchAiProcess`) | `decks.py` (`/batch/regenerate`, `/batch/regenerate-audio`, `/batch/{id}/status`) | `regen_worker.py` (`run_batch_ai_regeneration`, `run_batch_audio_regeneration`) | `TMA_Deck`, `TMA_Card`, `admin_task_state.json` |
| **Чекпоинты & Резюме** | `#ai-resume-checkpoint-banner`, плашка ошибок | `ai_studio.js` (`checkSavedCheckpoint`, `resumeSavedCheckpoint`, `retryFailedCardsFromTask`) | `tasks.py` (`/api/admin/tasks/checkpoint`, `/resume`, `/retry-failed`) | `task_manager.py` (`save_task_checkpoint`, `load_task_checkpoint`) | `admin_task_state.json` |
| **Массовое создание (Bulk)** | `#content-bulk`, ввод слов, подсказки тем | `bulk_creator.js` (`startBulkCardCreationProcess`, `suggestTopicWords`) | `cards.py` (`/bulk-create`, `/bulk-suggest-words`) | `regen_worker.py` (`run_bulk_card_creation`), `api/ai_service.py` | `TMA_Deck`, `TMA_Card`, `Deck`, `Card` |
| **CEFR классификация** | `#content-classification`, распределение уровней, лог | `classification.js` (`startClassificationTask`, `controlClassificationTask`) | `classification.py` (`/start`, `/{id}/status`, `/{id}/control`) | `classification_worker.py` (`run_classification_task`), `api/classifier/` | `TMA_Card.tags`, `Card.tags` |
| **Резервные копии (Backups)** | `#content-backups`, таблица снимков, поле кастомного пути | `backups.js` (`loadBackups`, `triggerCreateFullBackup`, `saveBackupSettings`) | `backups.py` (`/api/admin/backups`, `/create`, `/download/{name}`, `/settings`) | `backup_service.py` (`create_sqlite_backup`, `sync_backup_to_custom_dir`) | Файлы `.db` / `.sql`, `admin_config.json` |
| **Превью голосов Edge-TTS** | Кнопка «🔊 Превью», выбор скорости и диктора | `api.js` (`playVoicePreview`, `playAudioFile`) | `media.py` (`/api/admin/voice-preview`, `/api/media/audio/{path}`) | `api/utils/audio.py` (`generate_audio`), `edge-tts` | `TMAMedia` |

---

## 2. Архитектурные инварианты админки (Admin Architecture Rules)

### Изоляция и окружение
1. **Строгая изоляция от Production TMA**: Админ-панель запускается только локально через `run_admin.bat` на порту 8050 (`tools/admin/server.py`). Она не попадает в клиентский бандл TMA (`/app/`) и не зависит от Telegram WebApp API.
2. **Прямой доступ к ORM**: В отличие от клиентского приложения (работающего через offline IndexedDB и `/api/routers/sync.py`), админка взаимодействует напрямую с PostgreSQL / SQLite через Peewee ORM (`api/models.py`).
3. **Безопасность транзакций**: Массовые операции (удаление пользователей, дедупликация, пакетное назначение дефолтных колод) выполняются в атомарных транзакциях Peewee `models.tma_db.atomic()`.

### Фоновые процессы и устойчивость к сбоям
1. **Фоновые задачи и Чекпоинты**: Долгие задачи (ИИ-генерация сотен карточек, массовая озвучка, CEFR-классификация) выполняются в отдельных потоках через `FastAPI.BackgroundTasks`.
2. **Сохранение состояния (`tools/admin/services/task_manager.py`)**:
   - Каждое изменение прогресса сохраняется атомарно во временный файл и перемещается в `tools/admin/admin_task_state.json`.
   - При перезапуске сервера или случайном закрытии браузера панель обнаруживает чекпоинт и предлагает кнопку **«▶ Продолжить задачу»** с точного индекса колоды и карточки.
3. **Изоляция ошибок в пакете**: Сбой генерации одной карточки или колоды не прерывает весь пакет. Ошибочные карточки заносятся в `failed_card_ids` для последующего запуска через **«🔄 Перегенерировать ошибки»**.

### Синхронизация данных
1. **Кросс-колодная синхронизация (`tools/admin/services/deck_helpers.py`)**:
   При включенном флаге `regen_sync_copies` обновленный контекст или озвучка карточки автоматически распространяются на все пользовательские копии колод с идентичным названием.
2. **Библиотечные и пользовательские колоды**:
   - Библиотечные колоды идентифицируются префиксом `lib_{id}` и хранятся в таблицах `Deck` и `Card`.
   - Пользовательские колоды хранятся в `TMA_Deck` и `TMA_Card`. Функция `get_deck_and_cards()` прозрачно разрешает обе модели.

---

## 3. Дерево решений: Диагностика проблем админки (Diagnostic Guide)

| Симптом / Проблема | Шаг 1: Проверка в UI | Шаг 2: Проверка на сервере | Корневой источник истины |
| :--- | :--- | :--- | :--- |
| **Кнопки не нажимаются, индикатор сервера красный** | Проверить бейдж в шапке (Online / Offline) | Проверить консоль `run_admin.bat` (работает ли uvicorn на 8050) | `tools/admin/server.py` / занят порт 8050 |
| **Генерация ИИ не стартует или зависает на 0%** | Открыть лог в блоке мониторинга студии | Проверить ключи OpenAI/Groq/Ollama в `.env` и логи `regen_worker.py` | `api/ai_service.py` (`get_ai_config()`) |
| **Не воспроизводится озвучка Edge-TTS** | Консоль браузера (F12) $	o$ ошибки сети `/api/media/audio/...` | Проверить `models.TMAMedia` в БД и доступ к серверам Microsoft TTS | `tools/admin/routers/media.py` $	o$ `api/utils/audio.py` |
| **Прерванная задача не продолжается** | Нажать «✕ Сбросить» в желтом баннере чекпоинта | Проверить валидность JSON в `tools/admin/admin_task_state.json` | `tools/admin/services/task_manager.py` |
| **Карточка отредактирована, но изменения не видны в TMA** | Проверить статус сохранения в модалке предпросмотра | Проверить `updated_at` карточки в БД и вызов клиентом TMA синхронизации `/api/sync` | `tools/admin/routers/cards.py` $	o$ клиентский `syncService.js` |
| **Не создаются бэкапы БД** | Проверить сообщение об ошибке во вкладке «Бэкапы БД» | Проверить права на запись в папку бэкапов и путь в `tools/admin/admin_config.json` | `tools/admin/services/backup_service.py` |
