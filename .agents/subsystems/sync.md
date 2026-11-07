# Sync: offline storage и доставка изменений

## Scope

Dexie, offline CRUD, временные ID, sync v2, повтор пакета, review history и перенос настроек.
Knowledge Attempts отправляются отдельным механизмом: [knowledge](knowledge.md).

## Primary entry points

| Задача | Файлы от корня репозитория |
| --- | --- |
| Выбор online/offline transport | `app/src/services/api.js`, `app/src/services/networkApi.js`, `app/src/services/apiConfig.js` |
| БД аккаунта, схема, aliases | `app/src/services/localDb.js` |
| Offline endpoints и локальные изменения | `app/src/services/offlineApi.js` |
| Пакеты / ack / pull snapshot | `app/src/services/syncService.js` |
| UI состояния offline | `app/src/services/offlineUi.js`, `app/src/components/modals/SyncModal.jsx`, `app/src/hooks/useAppInitialization.js` |
| Sync server | `api/routers/sync.py`, `api/services/offline_sync.py`, `api/services/sync_service.py` |
| Настройки между устройствами | `app/src/store/useSettingsStore.js`, `api/routers/settings.py` |
| Collaborative transport | `app/src/hooks/useCollaborativeSync.js`, `app/src/hooks/useCollaborativePresence.js`, `api/routers/collaborative.py` |

## Data flow

1. API-клиент выбирает offline handler при offline mode/доступном fallback для поддерживаемых endpoints; online запросы идут в сеть.
2. Offline handler сохраняет изменения в Dexie, dirty flags и локальные версии; новые сущности получают отрицательные ID.
3. SyncService формирует устойчивый пакет в `syncState` и отправляет `/sync/v2/push` через `networkApi`.
4. `offline_sync.py` проверяет права и повтор `request_id`, сохраняет сущности/reviews и возвращает mappings.
   Новое значение `audio_path`/`audio_back_path` в облаке принимается только при наличии объекта в `storage.objects`; неизменённые ссылки и явное удаление поля сохраняют прежнюю семантику.
5. Клиент подтверждает пакет, переводит временные ID, синхронизирует learning preferences и получает `/sync/v2/pull`.
6. Snapshot применяется с сохранением локальных dirty changes; события remap/synced обновляют клиентские представления.
7. Legacy push/pull и collab-pull остаются отдельными маршрутами; проверяйте caller перед выбором сервиса.
   Все пять Sync handlers используют `db_worker`. Auth и handler освобождают
   свои соединения отдельно, транзакции push принадлежат сервисам, а ответы
   pull и `access_version` собираются внутри worker scope. PostgreSQL-регрессия
   с двумя соединениями запускается из `scripts/test_supabase_security.py`.
8. `card_notes` (Dexie v5) is a separate personal-note outbox. `api.js` routes its mutations through `offlineApi.js` to `cardNotes.js`: persist first, then use the existing authenticated network client. Existing entity sync resolves temporary card IDs before flushing this outbox. UUIDs, tombstones, local revisions and a per-account write lock protect retries/edits; account switching cannot consume another account's responses. The study card reads visible notes from Dexie; its first server read loads the deck's notes in one batch and subsequent card changes reuse that result. Explicit refresh fetches again. Card/progress snapshots never include notes. Tests: `app/src/services/__tests__/cardNotes.test.js`, `scripts/tests/browser/card-notes.spec.cjs`.
   An annotation error leaves its draft dirty and returns `card_notes_pending`, without blocking committed entity/review synchronization or unrelated offline API actions. Manual profile sync shows this partial result explicitly; the notes panel retains its pending/error/retry states.
   A flush attempts every matching note, acknowledges only successful unchanged local revisions, and reports the first error after the loop. Rejected/network-failed records remain dirty across restarts and retry with the same UUID; one record cannot block other notes. Existing entity sync is unchanged.

## Structured Cards V2, этап 6B.1

Standard из редактора при недоступной сети сохраняется с отрицательным ID.
`offlineApi` атомарно записывает `cards` и неизменяемую операцию
`syncState.card-create-v2:<request_id>` в БД аккаунта. `syncService` повторяет
`POST /cards/save` с тем же UUID. Нативная серверная квитанция в
`TMAOfflineBatch` и карточка фиксируются в одной транзакции. Локальный
ремап, замена строки и удаление ожидающей операции также атомарны.
Ошибка сохраняет строку и очередь. Запуск приложения, восстановление
сети и фоновый цикл повторяют доставку.

`GET /sync/v2/pull?card_schema=2` передаёт нативное содержимое, ревизии и
связанный прогресс. V1-карточки и их очередь не участвуют в новом цикле.
Формат без параметра сохранён для старого клиента. Проверка с Chromium,
FastAPI и одноразовым PostgreSQL запускается через
`scripts/tests/structured_cards_postgres.py --bin-dir <path> --offline-create-browser`.
Границы этапа описаны в [STRUCTURED_CARDS_V2](../../project_docs/STRUCTURED_CARDS_V2.md#этап-6b1-офлайн-создание-одной-standard-карточки).

## Structured Cards V2, этап 6B.2

Офлайн-редактор Standard сохраняет черновик в `cards`, состояние доставки и
версию сервера в `cards.offline_edit`, а исходный payload — в
`syncState.card-edit-v2:<card_id>`. Запись карточки и операции, подтверждение
и явный выбор версии атомарны в Dexie. Кеширование чтений и pull сохраняют
карточку с активной правкой. Существующий `syncService` отправляет нативный
`PATCH /cards/{id}` с исходной ревизией и тем же UUID до получения квитанции.
При конфликте он сохраняет отказ до загрузки серверной версии и прекращает
отправлять отклонённый payload. Явное сохранение локального варианта создаёт
операцию с новым UUID и ревизией показанной версии сервера.

Проверка двух Chromium-контекстов, FastAPI и одноразового PostgreSQL запускается
через `scripts/tests/structured_cards_postgres.py --bin-dir <path> --offline-edit-browser`.

## Structured Cards V2, этап 6B.3

У Standard в доступной кешированной колоде запись создания предшествует
HTTP-запросу и при наличии сети. Подтверждение создания сохраняет уже
закешированную строку с серверным ID и добавляет alias в той же транзакции.
Для правки `syncState.card-edit-v2:<card_id>` содержит одну отправляемую
операцию. `cards.offline_edit.next` хранит последующий черновик до квитанции
предыдущей операции. Квитанция атомарно переносит черновик в тот же ключ
с подтверждённой базовой ревизией. Следующий проход доставляет его с новым UUID.
Конфликт сохраняет последнюю локальную версию для явного разрешения. Ответ
проверяется по сессии и UUID операции. Обычный pull пропускает ожидающие правки.
Новые поля необязательны, версия Dexie и существующие payload сохранены.

Проверки доставки с разрывами соединения, задержанными ответами и перезапуском
в Chromium входят в `structured_cards_postgres.py --offline-delivery-browser`.

## Structured Cards V2, этап 6B.4

- `syncService.sync` захватывает аккаунт и идентификатор сессии перед
  запросом Web Lock. При занятой или недоступной блокировке очередь
  сохраняется для повтора. Единственный путь доставки проходит под
  `lerne-offline-sync`.
- Подтверждение сверяет UUID внутри транзакции `syncState`. Pull и кеш
  карточек сравнивают начало чтения с метками более свежего чтения и
  подтверждения. Межвкладочные уведомления передают ID для перечитывания
  Dexie, содержимое карточки остаётся в БД аккаунта.
- Collaborative при ответе `native_card_requires_v2_sync` запускает
  только V2 pull через тот же сервис и ту же блокировку.
- `structured_cards_postgres.py --offline-isolation-browser` запускает
  сценарий двух вкладок и смены сессий на одноразовом PostgreSQL.

## Structured Cards V2, этап 6B.5a

`offlineApi` атомарно меняет размещение существующей V2-карточки в `cards`
и сохраняет запрос в `syncState.card-move-v2:<card_id>`. `syncService`
доставляет его через `POST /cards/batch-move` под той же Web Lock. Сервер
проверяет ревизии и права на обе колоды, сохраняет размещение и квитанцию
вместе. Локальное подтверждение применяет размещение и удаляет операцию
в одной транзакции. Чтения сохраняют pending/rejected размещение, временные
сбои повторяются с исходным UUID. Проверка: `structured_cards_postgres.py
--bin-dir <path> --offline-move-browser`. Подробности в
[STRUCTURED_CARDS_V2](../../project_docs/STRUCTURED_CARDS_V2.md#этап-6b5a-перенос-одной-v2-карточки-между-колодами).

## Structured Cards V2, этап 6B.5b

Одиночные удаление и восстановление V2 используют `cards.is_deleted` и
`syncState.card-lifecycle-v2:<card_id>` в одной Dexie-транзакции. Доставка
использует общий `syncService`, Web Lock, серверную ревизию и квитанцию
`TMAOfflineBatch`. При сетевой ошибке сохраняется исходный UUID. При
конфликте ревизий очередь применяет серверное состояние и снимает ожидание.
Если удалена карточка с локальной правкой, серверная отметка удаления
меняет видимость, а `offline_edit` и его запрос остаются в Dexie.
Восстановление обновляет серверную сторону конфликта, чтобы пользователь
мог явно разрешить его. Регрессия запускается через
`structured_cards_postgres.py --bin-dir <path> --offline-lifecycle-browser`.

## Structured Cards V2, этап 6B.8a

Создание любой V2-карточки в известной серверной колоде использует
`card-create-v2:<request_id>` и ремап из этапов 6B.1–6B.4. Тип карточки
сверяется с отправленным payload при подтверждении. Валидация содержимого
при доставке остаётся у `POST /cards/save`. При 422 Dexie хранит исходную
карточку и payload, сохраняет текст ошибки и исключает операцию из
автоматических повторов. Остальные создания доставляются независимо.
`--offline-create-browser` проверяет Standard и все девять типов в Chromium
с FastAPI и одноразовым PostgreSQL.

## Structured Cards V2, этап 6B.8b

Все девять типов редактируются через `card-edit-v2:<card_id>` и общий
`PATCH /cards/{id}` из этапов 6B.2–6B.4. Открытие редактора использует
кешированную локальную правку или свежее чтение с офлайн-фоллбеком. Dexie
хранит полный `content_v2` вместе с операцией, а подтверждение сверяет тип
с исходным запросом. Конфликты используют ту же панель и правила ревизий.
При 422 очередь хранит отклонённый черновик до исправления. Если уже
сохранена следующая правка, она занимает тот же ключ с базовой ревизией
отклонённого запроса. Проверка девяти типов и Standard запускается через
`structured_cards_postgres.py --bin-dir <path> --offline-edit-browser`.

## V2 batch transfer

Пакетные copy/move расширяют прежние операции `card-move-v2:` в `syncState`,
без новой очереди и схемы Dexie. `offlineApi.queueCardMove` атомарно пишет все
локальные карточки и один UUID/payload; copy получает временные ID без личного
прогресса. `syncService.deliverCardMoves` подтверждает весь пакет и aliases
одной транзакцией, проверяя текущую сессию и UUID. Неизвестный ответ оставляет
операцию для повтора; окончательный отказ сохраняет её и локальные карточки
с отметкой `rejected`. `keepLocalCard` защищает их при обычном чтении и pull.
Одиночные операции предыдущего этапа читаются прежним обработчиком.
Проверки: `structured_cards_postgres.py --http` и `--offline-batch-browser`;
[контракт 6B.5c](../../project_docs/STRUCTURED_CARDS_V2.md#этап-6b5c-пакетное-копирование-и-перенос-v2-карточек).

## Клиентские зависимости транспорта

`networkApi.js` владеет единственным Axios instance, auth-interceptors,
refresh flights и Dexie refresh lease. `api.js` оборачивает его offline proxy
и сохраняет прежние default export и named export `networkApi` (тот же instance).
`syncService.js` и `cardNotes.js` импортируют транспорт напрямую.

```text
api -> networkApi, offlineApi, syncService, localDb, auth, axios
syncService -> networkApi, cardNotes, localDb, auth, locale, cardDraft
offlineApi -> cardNotes, localDb, auth, mediaCache, srsEngine, search, locale, cardDraft
cardNotes -> networkApi, localDb, auth
networkApi -> localDb, auth, apiConfig, localMode, axios
localDb -> auth, localMode, dexie, @capacitor/core
auth -> locale, localMode
mediaCache -> apiConfig
apiConfig -> media, localMode
media -> localMode
srsEngine, cardDraft -> locale
locale -> messages/en.json, messages/uk.json
```

`localMode`, `search` и JSON — локальные листья; npm packages — внешние
зависимости. Циклов в этой транзитивной области нет. Транспорт не импортирует
offline routing или outboxes, включая транзитивные связи.
Архитектурная регрессия: `app/src/services/__tests__/networkDependencies.test.js`
(AST, относительные imports/re-exports/dynamic imports и проверка всех путей).
Поведение interceptors: `scripts/tests/api_session_regression.mjs`.
`browser/offline.spec.cjs` проверяет реальный ESM singleton при загрузке API,
sync или notes первым, общий refresh и неизменный повтор пакета после 401,
offline → online доставку заметок, Web Locks/Dexie lease и смену аккаунта
с незавершёнными sync/note запросами. Эти тесты входят в `npm run check`.

## Source of truth

- Library reads from `api.js` identify their source: `cache` for automatic
  fallback, `local` for explicit offline mode. An empty automatic fallback is
  not a successful server library response. Cached init data is retained on
  transport failure and is never replaced by synthetic local profile/settings.
  Explicit local mode still updates the view from Dexie after local edits.
  No Dexie schema, entity writes, SRS or sync queues changed.

- `localDb.js` задаёт схему Dexie и отдельную БД аккаунта; несинхронизированные данные принадлежат этой локальной БД.
- `api/models.py` задаёт серверную схему; online entities сохраняются в Peewee, offline доставка — в `offline_sync.py`.
- Цветовая метка `flag` принадлежит progress конкретного пользователя. Offline `/cards/save` сохраняет явно переданный `flag` вместе с карточкой в одной Dexie-транзакции; отсутствие поля сохраняет прежний progress. Оценка переносит legacy cached `card.flag` только при создании progress. Явный `progress.flag = 0` имеет приоритет над legacy-значением при любой сериализации. Схема, накопленный SRS и очереди sync не сбрасываются.
- Pending batch хранит идентичность повторного запроса; `TMAOfflineBatch` сохраняет серверную квитанцию.
- V2 progress changes limited to a flag carry `flag_only` in the existing batch; the server updates only the personal label, preserving newer SRS/bookmarks from other devices. Native UUID grades also mark their snapshot this way: reviews own SRS. Explicit reset clears the marker. Absent/false is excluded from the receipt fingerprint, preserving old pending batches. Regression: `test_offline_sync.py` and the Chromium/PostgreSQL `--learning-browser` scenario in `structured_cards_postgres.py`.
- Grade UUID связывает online POST и `reviews[].action_id` независимо от batch request_id. Для UUID-событий сервер применяет прежний SRS один раз к актуальному прогрессу с исходным review_time; присланный SRS snapshot этой карточки игнорируется, личные flag/bookmark сохраняются. Старые события без UUID принимаются прежним путём. Новые batches дополняют несинхронизированные legacy events UUID из `review:*`; уже pending batch не меняется. Dexie сохраняет локальные `grade:*` receipts отдельно от удаляемого review outbox, включая reload/ack/remap.
- Mappings/aliases связывают отрицательные ID с серверными; используйте существующий remap перед следующими действиями.
- `review:*` события и итоговый progress доставляются совместно; сервер не запускает SRS повторно для импортированного результата.
- Dirty flags / локальная версия определяют, какую запись можно считать подтверждённой и какие правки сохранить при pull.
- Настройки идут через `/user/settings`, Knowledge — через собственный outbox; это дополнительные потоки.

## Common symptoms

| Симптом | Первый участок проверки |
| --- | --- |
| Правка исчезла после reload | Offline handler → транзакция Dexie → dirty flag → текущая БД аккаунта |
| Пакет повторяется или создаёт копии | Pending batch/request_id → TMAOfflineBatch → acknowledge |
| После sync не открывается новая карточка | mappings/aliases, remap ссылок и события `lerne:ids-remapped` |
| Review потерян или применён дважды | `review_count`, review events и обработка квитанции на сервере |
| Серверные данные затирают свежую правку | `applySnapshot` и dirty/local version comparison |
| Смена аккаунта показывает чужие данные | localDb ownership + store reset; см. [auth](auth.md) |
| Настройки не переносятся между устройствами | useSettingsStore → settings route; отдельно от entity snapshot |
| Не обновляются изменения соавтора | Collaborative hooks → collab-pull; права — [decks](decks.md) |

## Search anchors

```sh
rg -n 'isOfflineMode|resolveLocalRequest|prepareLocalDb' app/src/services/localDb.js app/src/services/api.js
rg -n 'pendingBatch|acknowledge|applySnapshot|review_count|request_id' app/src/services/syncService.js
rg -n 'TMAOfflineBatch|request_id|mappings|review_count' api/services/offline_sync.py api/routers/sync.py
```

## Relevant tests

- Offline v2: `scripts/tests/test_offline_sync.py`, `scripts/tests/offline_sandbox.py`.
- SQL read regressions: `scripts/tests/test_sync_read_queries.py` — реальные pull routes,
  проекции без image_data, batch study lookup, permissions и сохранность неизбранных полей.
  Через `scripts/test_backend.py` можно передать `--compare-ref <git-ref>` для сравнения
  SQL/байтов и ответов с указанной ревизией на одной SQLite fixture с большими BLOB.
  Методика, замеры и ограничения: [отчёт](../../reports/SYNC_SQL_READ_OPTIMIZATION.md).
- Browser: `scripts/tests/browser/offline.spec.cjs`, `scripts/tests/browser/offline-ui.spec.cjs`.
- Review delivery: `scripts/tests/test_forced_study.py`.
- Настройки / смежный sync: `scripts/tests/test_user_settings_sync.mjs`, `scripts/tests/test_smart_sync.py`, `scripts/tests/test_collaborative_presence.py`.
Названия тестов не определяют покрытие протокола; сначала читайте fixtures и setup.

## Related docs

- [Database and storage](../../project_docs/ARCHITECTURE/DATABASE_AND_STORAGE.md) — общий обзор, сверяйте с текущей Dexie-схемой.
- [SRS_SYSTEM](../../project_docs/ARCHITECTURE/SRS_SYSTEM.md), [Knowledge](knowledge.md), [Auth](auth.md).
- [SMART_SYNC_PLAN](../../project_docs/ARCHITECTURE/SMART_SYNC_PLAN.md) — план будущего merge, не спецификация sync v2.
- [Offline rule](../rules/offline_mode.md) содержит историческую инструкцию восстановления; текущие владельцы перечислены выше.
- [DB skill](../skills/db-mgmt/SKILL.md), [Architectural integrity](../rules/architectural_integrity.md).

## Restore owner access

Аудит 1.4: restore использует `_require_can_mutate(..., allow_deleted=True)` и
не позволяет обойти published policy перемещением удалённого объекта в корень.
Legacy push сохраняет проверенные правки editor папок/колод без дополнительного
фильтра владельца. Регрессии: `test_material_permissions.py`; [отчёт](../../docs/MATERIAL_PERMISSIONS_AUDIT.md).

require_access разрешает владельцу восстановление его soft-deleted deck/folder: collaborative lookup исключает удалённые targets. Исключение применяется только к deleted records собственника; активные/published permissions остаются прежними. Изолированный test_offline_sync.py проверяет restore, viewer/editor и rollback чужого пакета.


## Единая проверка регрессий (этап 1.1)

Из корня: `npm run check`. Команды, перечень изолированных suites, CI gate,
матрица покрытия и ограничения: [TESTING](../../docs/TESTING.md).
Отдельный backend suite запускайте через `scripts/test_backend.py`, чтобы
сохранить блокировку production-сервисов и загрузки `.env`.


Offline-v2 pull resolves `is_learning` only from batched personal settings;
legacy deck metadata remains raw transport data and never opts the owner in.
`test_sync_read_queries.py` covers explicit off/on/missing settings, different
readers, access checks, bounded reads and unchanged SRS/history when toggling.
Review: `docs/ADMIN_CONTRACT_REVIEW_20261029.md` (2026-10-29).

## Личное оформление Design V2

Владелец — `useSettingsStore.js` + `design/personalDesignMigration.js`.
Для каждого аккаунта localStorage record `lerne:personal-design:v2:<id>`
содержит исходные V1 snapshots, V2 config/preset и pending/base/revision.
Локальная запись с проверкой чтением предшествует отправке через `networkApi`;
настройки используют свой прежний `/user/settings`, отдельно от Dexie entities.
В `/api/init` персональные настройки возвращаются владельцу в `user_settings`.
Общий `settings` исключает персональные записи, в том числе резервные копии
дизайна, настройки напоминаний и состояние изучения колод.
`offline_mode` не мешает доставке pending настроек при восстановлении сети.

Серверный владелец — `api/services/user_settings.py`, `TMASetting`:
`USER_SETTINGS_<id>.designV2` и неизменяемая исходная строка в
`USER_DESIGN_V1_BACKUP_<id>`. Транзакция и блокировка строки объединяют backup
с переносом; ревизия/CAS и idempotent retry защищают запись между устройствами.
Старые клиенты не удаляют V2. GET публикует `_designMigrationVersion: 1`;
клиент не отправляет миграцию backend без этой поддержки.

Auth profile сохраняется до уведомления подписчиков. Смена аккаунта/поколения
отменяет pending timer, переключает scoped record/draft/preview и отбрасывает
запоздалые ответы; interceptor проверяет `_expectedUserId` до отправки.
Источник unscoped V1 переносится только первому владельцу; оригинал сохраняется.
`/user/settings/design-backup` и `restorePersonalDesignFromBackup()` позволяют
восстановить backup как новую V2-ревизию без удаления исходников.

Регрессии: `personalDesignMigration.test.js`, `test_personal_design_migration.py`,
`personal-design-migration.spec.cjs`. Матрица данных, поведение конфликта,
порядок rollout и ограничения: [отчёт этапа 3](../../docs/DESIGN_V2_STAGE3_PERSONAL_MIGRATION.md).

### Этап 4D: только V2 в runtime store

Flat V1 design state/userDesign и копирование этих полей из server snapshot
удалены из useSettingsStore. Миграция и восстановление используют сохранённые
источники через personalDesignMigration; backups/старые ключи не удаляются.
Настоящий PostgreSQL recovery проверен runner personal_design_postgres.py:
7 тестов, concurrent CAS, pg_dump/pg_restore и JS conversion backup.
[Отчёт и границы cutoff](../../docs/DESIGN_V2_STAGE4D_STORE_AND_RECOVERY.md).

### Этап 5: отказ от V1 личного оформления (2026-11-01)

По решению пользователя V1 больше не переносится и не восстанавливается.
legacyAdapter удалён, новый personal record создаётся непосредственно в V2.
Удалены старый import/restore и backup endpoint. Старые browser keys удаляются
после записи V2; сервер фильтрует flat V1 поля и атомарно очищает их вместе
с USER_DESIGN_V1_BACKUP при сохранении настроек. Настройки обучения и
актуальные V2 config/preset/offline edits сохраняются. Общие publication backups
не затрагиваются. Исторические условия cutoff этапов 3–4D отменены этим решением.
[Реализация и проверки](../../docs/DESIGN_V2_STAGE5_LEGACY_REMOVAL.md).

## V2: список, удаление, порядок и поиск (6B.5d)

`offlineApi.queueCardSelection` атомарно пишет пакет удаления/порядка и UUID
в существующую очередь `CARD_LIFECYCLE_KEY`. `syncService.deliverCardSelection`
доставляет через прежние `/cards/batch-delete` и `/cards/reorder` и подтверждает
весь `cards` одной транзакцией. Отклонённые пакеты сохраняются с локальными
карточками и исключаются из автоматического повтора. Новых схем/очередей нет.
`createDeckSlice.reorderCards` пишет до изменения store, без отложенного таймера.
Поиск читает V2 через `utils/search.matchCard`; дубликаты используют полный
V2-ключ `cardDuplicateKey` и собственные колоды, как сервер. DuplicateManager
отображает V2 напрямую. Контракт, ограничения, HTTP/PostgreSQL/Chromium проверки:
[6B.5d](../../project_docs/STRUCTURED_CARDS_V2.md#этап-6b5d-завершение-операций-со-списком-v2).
