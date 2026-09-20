# Lerne: Архитектурная карта (Architecture & Feature Topology)

> **Назначение**: Быстрая локализация кода для агента и разработчика. Перед поиском или внесением изменений определите фичу по таблице ниже и сразу переходите к целевым модулям.
> **Консоль администратора**: Архитектура и сквозная матрица админ-панели вынесены в отдельный документ: [ADMIN_ARCHITECTURE.md](file:///c:/121/Lerne_projekt/tma/.agents/ADMIN_ARCHITECTURE.md).

---

## 1. Сквозная матрица фич (Intent-to-Code Matrix)

Каждая строка связывает бизнес-фичу со всей цепочкой файлов от пользовательского интерфейса до базы данных:

| Подсистема / Фича | Frontend UI (`app/src/components/`) | Client State & Storage (`app/src/store/`, `services/`) | Backend Router (`api/routers/`) | Backend Service / Logic (`api/services/`) | DB Model (`api/models.py`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Колоды (Decks)** | `deckgrid/DeckGrid.jsx`, `deckgrid/DeckCard.jsx` | `useDeckStore.js` (`createDeckSlice.js`), `offlineApi.js`, `localDb.js` | `decks.py` | `decks.py` | `TMA_Deck` |
| **Папки (Folders)** | `deckgrid/FolderCard.jsx`, `modals/FolderModal.jsx` | `useDeckStore.js` (`createFolderSlice.js`), `offlineApi.js` | `folders.py` | `folders.py` | `TMA_Folder` |
| **Карточки (Cards & Batch)** | `CardList.jsx`, `modals/BatchMoveModal.jsx`, `modals/CardEditModal.jsx` | `useDeckStore.js`, `useCardActions.js`, `offlineApi.js`, `localDb.js` | `cards.py` (`/batch-move`, `/batch-delete`) | `cards.py` | `TMA_Card` |
| **Обучение, SRS & Авто-режим** | `study/StudyView.jsx`, `study/CardView.jsx`, `study/AutoplayControls.jsx`, `study/StudyCardWordBank.jsx`, `settings/AutoplaySettingsTab.jsx` | `useSessionStore.js`, `useSettingsStore.js`, `hooks/useAutoplay.js`, `utils/autoplaySequence.js`, `utils/wordBankParser.js`, `utils/wordBankState.js`, `offlineApi.js` | `study.py`, `media.py` (перегенерация TTS) | `study.py`, `srs.py`, `media.py` | `TMAProgress`, `TMAReviewHistory`, `TMAMedia` |
| **Offline-First & Синхронизация** | `common/SyncIndicator.jsx`, `offlineUi.js` | `localDb.js` (Dexie), `offlineApi.js`, `syncService.js` | `sync.py` | `sync_service.py`, `offline_sync.py` | `TMAOfflineBatch` |
| **AI-генерация & Промпты** | `modals/AiGenerateModal.jsx`, `study/AiExplainer.jsx` | `useSessionStore.js` | `ai.py` | `ai_service.py`, `prompt_builders.py`, `ai_clients.py` | `TMAUserPrompt`, `TMACustomPrompt` |
| **Озвучка & Медиа (TTS)** | `utils/audio.js`, `mediaCache.js` | `mediaCache.js` | `media.py` | `media.py` (edge-tts / кэш) | `TMAMedia` |
| **LiD (Экзамен, Тренировка & Карточки)** | `lid/LidExamView.jsx`, `lid/LidQuestionCard.jsx`, `lid/LidClassifier.jsx` | `useLidStore.js`, `utils/lidCardAdapter.js`, `lidFolderManager.js` | `lid.py` (`/ticket`) | `resolve_media_url`, `serialize_card` | `tma_card`, `tma_deck`, `tma_media` (строго из БД, без внешних JSON) |
| **Шеринг колод & Импорт** | `modals/ShareModal.jsx`, `modals/ImportModal.jsx` | `useDeckStore.js` (`createShareSlice.js`) | `share.py` | `sharing_service.py` | `TMA_Deck.share_id`, `TMA_Folder.share_id` |
| **Коллаборация (Co-op)** | `collaborative/CollaborativeHub.jsx` | `useCollaborativeStore.js` | `collaborative.py` | `collaborative_service.py` | `TMA_Collaborator` |
| **Корзина (Trash)** | `TrashManager.jsx` | `useDeckStore.js` (`createTrashSlice.js`) | `trash.py` | `trash.py` | `is_deleted=True` (Soft delete) |
| **Авторизация v2: вход и привязки** | `modals/AuthRequiredModal.jsx`, `settings/ProfileTab.jsx` | `useAuthStore.js`, `utils/auth.js`, `services/api.js` (авто-рефреш 401 + очередь); изоляция аккаунтов в `localDb.js` и `useDeckStore.js` | `auth_v2.py`, `bot.py`, строгая `dependencies/auth.py`; старый кодовый вход закрыт | `api/auth/providers.py`, `service.py`, `transactions.py` | `TMAAuthAccount`, `TMAAuthIdentity`, `TMAAuthSession`, `TMAAuthToken`, `TMAAuthProof`, `TMAAuthChallenge`; миграции 76–77 |
| **Email/пароль и восстановление без писем** | Предложение Telegram после регистрации; восстановление через вход привязанным провайдером и профиль | `useAuthStore.js`: настройки пароля отдельно от полей профиля | `auth_v2.py`: `email-password/register`, `login`, `link`, `set`, `password-settings` | `api/auth/service.py`: Argon2id, throttling, свежая social-сессия, отзыв остальных сессий | `TMAAuthPassword`, `TMAAuthPasswordThrottle`; миграция 78; provenance сессии — 79 |
| **Настройки & Профиль** | `modals/SettingsModal.jsx`, `settings/*.jsx` (включая `SrsTab.jsx`) | `useSettingsStore.js` (авто-синхронизация Web/Android через `/user/settings`), `useAppInitialization.js` | `settings.py` (`/user/settings`, `/admin/settings`), `main.py` (`/init`) | `reminder_service.py` | `TMASetting` (`USER_SETTINGS_{id}`, `REMINDER_SETTINGS_{id}`) |
| **Сквозной поиск (Search)** | `common/SearchBar.jsx`, `deckgrid/DeckGrid.jsx` | `search.js`, `offlineApi.js` | `cards.py` (`/search`) | `cards.py` (`search_all_in_scope`) | `TMA_Card`, `TMA_Deck`, `TMA_Folder` |

---

## 2. Дерево решений: Где искать проблему (Diagnostic Guide)

| Симптом / Проблема | Шаг 1: Проверить на клиенте | Шаг 2: Проверить на сервере | Корневой источник истины |
| :--- | :--- | :--- | :--- |
| **Изменения пропали после перезагрузки** | `localDb.js` (IndexedDB tables) $\to$ `offlineApi.js` | Проверить, прошел ли запрос в `api/routers/sync.py` | `sync_service.py` / конфликт версий |
| **Кнопка/модалка не реагирует или ломает верстку** | `app/src/components/modals/` $\to$ `useUiStore.js` | — | Локальный стейт модалки / Browser & Mobile Viewport resize |
| **Ошибка при пересчете интервала SRS (SuperMemo/Leitner)** | `app/src/components/study/StudyView.jsx` | `api/routers/study.py` | `api/srs.py` (алгоритм интервалов) |
| **Карточки создаются на сервере, но не видны в UI** | `createDeckSlice.js` (селектор фильтрации/папок) | `api/services/cards.py` | Флаги `is_deleted` или несоответствие `folder_id` |
| **Ошибка генерации карточек нейросетью** | Логи сетевого запроса к `/api/ai/...` | `api/routers/ai.py` $\to$ `api/ai_service.py` | Промпты в `prompt_builders.py` или API-ключи провайдера |
| **Не воспроизводится аудио карточки** | `app/src/utils/audio.js` $\to$ `mediaCache.js` | `api/routers/media.py` | `api/services/media.py` (генерация edge-tts) |
| **Не загружается картинка карточки** | `StudyCardImage.jsx` $\to$ `StudyCard.jsx` | `api/routers/media.py` (`/images/`) | `TMAMedia` в БД Supabase / reconnect |
| **Сбой авторизации в Telegram/Android** | `app/src/store/useAuthStore.js`, `utils/auth.js`, `utils/platform.js` | `api/routers/auth_v2.py`, `bot.py`, `dependencies/auth.py` | `api/auth/providers.py`, TTL/challenge и сессии в `service.py`; deployment-проверки в `api/auth/DEPLOYMENT.md` |
