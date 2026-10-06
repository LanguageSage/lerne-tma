# Lerne: архитектурная карта

Карта описывает устойчивые границы приложения и владельцев данных.
Для поиска по симптому откройте [AGENT_INDEX.md](AGENT_INDEX.md), затем один документ подсистемы.
Пути ниже указаны от корня репозитория; API-маршруты имеют общий префикс `/api`.
Контракты и актуальные имена символов сверяйте с кодом по Search anchors выбранной подсистемы.

## Слои приложения

| Слой | Точка входа | Ответственность |
| --- | --- | --- |
| React / Vite | `app/src/main.jsx`, `app/src/App.jsx` | Запуск клиента, экраны и модальные окна |
| UI | `app/src/components/` | Колоды, редактор, обучение, настройки |
| Hooks | `app/src/hooks/` | Пользовательские действия и жизненный цикл сессий |
| Zustand | `app/src/store/` | Общее состояние и доменные действия |
| API-клиент | `app/src/services/api.js` | Авторизация, refresh, выбор сети или offline API |
| Локальная БД | `app/src/services/localDb.js` | Dexie / IndexedDB, отдельная БД аккаунта |
| FastAPI | `api/main.py`, `api/routers/` | Регистрация маршрутов, запросы и зависимости |
| Серверная логика | `api/services/` | CRUD, синхронизация, оценивание и проекции |
| ORM / БД | `api/models.py`, `api/database.py`, `api/migrations.py` | Peewee, подключение и эволюция схемы |
| Android | `android/`, `capacitor.config.json` | Оболочка Capacitor для того же клиента |
| Локальная админка | `tools/admin/server.py` | Отдельное приложение с прямым доступом к ORM |

## Основные потоки данных

```text
UI → hooks / Zustand → services/api.js
  online:  FastAPI router → server logic → Peewee
  offline: offlineApi.js → Dexie → syncService.js → /sync/v2/* → Peewee

Study grade → useStudySession.js → knowledgeCaptureService.js
  → knowledge_attempt_outbox → knowledgeSyncService.js
  → /knowledge/attempts/sync → raw Attempts → mastery projection
```

Online и offline CRUD выбираются в API-клиенте; offline очередь отправляется отдельно.
Синхронизация Knowledge Attempts имеет собственную очередь и жизненный цикл.
Медиа разрешаются через URL, серверное хранилище и локальный кэш; см. [media](subsystems/media.md).

## Подсистемы: Intent-to-Code Matrix

| Подсистема | Основной вход UI / клиента | Серверный вход | Документ |
| --- | --- | --- | --- |
| Карточки, синтаксис, редактор, batch import | `app/src/components/common/CardForm.jsx`, `app/src/hooks/useCardEditor.js` | `api/routers/cards.py`, `api/services/cards.py` | [cards](subsystems/cards.md) |
| Колоды, папки, библиотека, sharing, trash | `app/src/components/deckgrid/DeckGrid.jsx`, `app/src/store/useDeckStore.js` | `api/routers/decks.py`, `api/routers/folders.py` | [decks](subsystems/decks.md) |
| Обучение, упражнения, SRS, autoplay | `app/src/components/study/StudyView.jsx`, `app/src/hooks/useStudySession.js` | `api/routers/study.py`, `api/srs.py` | [study](subsystems/study.md) |
| Offline CRUD и синхронизация сущностей | `app/src/services/offlineApi.js`, `app/src/services/syncService.js` | `api/routers/sync.py`, `api/services/offline_sync.py` | [sync](subsystems/sync.md) |
| AI generation и free-text evaluation | `app/src/hooks/useAiActions.js`, `app/src/hooks/useFreeTextEvaluation.js` | `api/routers/ai.py`, `api/ai_service.py` | [ai](subsystems/ai.md) |
| Вход, привязки, пароли, refresh | `app/src/store/useAuthStore.js`, `app/src/utils/auth.js` | `api/routers/auth_v2.py`, `api/auth/service.py` | [auth](subsystems/auth.md) |
| TTS, изображения, аудио, кэш | `app/src/hooks/useAudio.js`, `app/src/services/mediaCache.js` | `api/routers/media.py`, `api/services/media.py` | [media](subsystems/media.md) |
| Knowledge Items, Attempts, mastery, diagnostics | `app/src/services/knowledgeCaptureService.js`, `app/src/hooks/useKnowledgeSync.js` | `api/routers/knowledge.py`, `api/services/knowledge_mastery.py` | [knowledge](subsystems/knowledge.md) |

## Владельцы состояния и данных

| Область | Клиентский владелец | Серверные модели в `api/models.py` |
| --- | --- | --- |
| Колоды / карточки / папки | `app/src/store/useDeckStore.js`, Dexie `decks/cards/folders` | `TMA_Deck`, `TMA_Card`, `TMA_Folder` |
| Учебная сессия | `app/src/store/useSessionStore.js` | Сессия UI локальна; сохранённый прогресс — `TMAProgress` |
| SRS и история повторений | Dexie `progress`, очередь review в `syncState` | `TMAProgress`, `TMAReviewHistory` |
| Настройки пользователя | `app/src/store/useSettingsStore.js` | `TMASetting`; маршруты в `api/routers/settings.py` |
| Аккаунт / сессии входа | `app/src/store/useAuthStore.js`, `app/src/utils/auth.js` | `TMAUser`, семейство `TMAAuth*` |
| Синхронизация сущностей | Dexie `syncState`, dirty-записи | `TMAOfflineBatch` |
| Медиа | Dexie `media`, URL и состояние плеера | `TMAMedia`; аудио также использует Supabase Storage |
| Knowledge | Dexie KI-таблицы и outbox | `TMAKnowledgeItem`, `TMACardKnowledgeItem`, `TMAKnowledgeAttempt`, `TMAUserKnowledgeState` |
| AI-промпты / конфигурация | Настройки и формы генерации | `TMASetting`, `TMAUserPrompt`, `TMACustomPrompt` |
| Совместный доступ | `app/src/store/useCollaborativeStore.js` | `TMA_Collaborator` |
| Библиотека | `app/src/store/slices/createLibrarySlice.js` | `LibraryCategory`, `Deck`, `Card` |

## Смежные области

- LiD exam/practice: `app/src/components/lid/LidExamView.jsx`, `app/src/store/useLidStore.js`, `api/routers/lid.py`.
  Их quiz policy отличается от обычных учебных упражнений; вход через [study](subsystems/study.md).
- Collaboration: `app/src/hooks/useCollaborativeSync.js`, `api/routers/collaborative.py`, `api/services/collaborative_service.py`.
  Доступ и доменные действия описаны в [decks](subsystems/decks.md), transport — в [sync](subsystems/sync.md).
- Поиск: `app/src/hooks/useSearch.js`, `app/src/utils/search.js`, `api/routers/cards.py`.
  Область поиска определяется колодой/папкой; вход через [cards](subsystems/cards.md).
- Настройки и стартовая загрузка: `app/src/hooks/useAppInitialization.js`, `app/src/store/useSettingsStore.js`, `api/routers/settings.py`.
  Для переноса между устройствами см. [sync](subsystems/sync.md); для профиля — [auth](subsystems/auth.md).
- Язык интерфейса: `app/src/i18n/i18nContext.jsx`; язык обучения: `app/src/store/useLanguageStore.js`.
- Админ-консоль, массовая регенерация и бэкапы: [ADMIN_ARCHITECTURE.md](ADMIN_ARCHITECTURE.md).

## Архитектурные границы

- Исходный текст карточки и синтаксис упражнений принадлежат [cards](subsystems/cards.md).
  Рендеринг, feedback и completion принадлежат [study](subsystems/study.md).
- SRS рассчитывает повторения карточек; Knowledge mastery строится из Attempts.
  Это разные модели прогресса с разными механизмами сохранения.
- Авторизация запроса проходит через `api/dependencies/auth.py`; доступ к сущности проверяется сервером.
- Offline-записи, временные ID и повторные запросы обслуживает [sync](subsystems/sync.md).
- AI-ответ становится данными карточки через существующее сохранение; evaluator возвращает verdict.
  Детали контрактов и провайдеров находятся в [ai](subsystems/ai.md).
- Локальная админка использует `tools/admin/`, отдельно от React-клиента и его offline API.

## Документация, правила и skills

Рабочие правила находятся в [AGENTS.md](AGENTS.md) и [корневом AGENTS.md](../AGENTS.md).
Эта карта служит навигацией; процедуры работы остаются в существующих rules/skills.

| Когда читать | Документ |
| --- | --- |
| Архитектурные ограничения | [architectural_integrity](rules/architectural_integrity.md) |
| Задача явно касается режима offline | [offline_mode](rules/offline_mode.md), затем текущий [sync](subsystems/sync.md) |
| Работа с UI | [tma-ui](skills/tma-ui/SKILL.md) |
| Серверные маршруты и сервисы | [fastapi-backend](skills/fastapi-backend/SKILL.md) |
| ORM, миграции, Dexie | [db-mgmt](skills/db-mgmt/SKILL.md) |
| Границы модулей и переиспользование | [lean-code](skills/lean-code/SKILL.md) |
| Проверки изменений | [ai-harness-eval](skills/ai-harness-eval/SKILL.md) |
| Подробная схема SRS | [SRS_SYSTEM](../project_docs/ARCHITECTURE/SRS_SYSTEM.md) |
| Авторизация v2 | [AUTH_V2](../project_docs/ARCHITECTURE/AUTH_V2.md) |
| Обзор хранилищ | [DATABASE_AND_STORAGE](../project_docs/ARCHITECTURE/DATABASE_AND_STORAGE.md) |
| Поиск других проектных документов | [DOCS_MAP](../project_docs/DOCS_MAP.md) |

Проектные обзоры могут содержать исторические пути; точные ссылки здесь сверены с рабочим деревом.
`SMART_SYNC_PLAN.md` — план развития, а не контракт действующей offline sync v2.
Детали алгоритмов, параметров, миграций и сценариев тестирования находятся в документах подсистем.
