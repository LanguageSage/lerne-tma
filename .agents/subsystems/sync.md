# Sync: offline storage и доставка изменений

## Scope

Dexie, offline CRUD, временные ID, sync v2, повтор пакета, review history и перенос настроек.
Knowledge Attempts отправляются отдельным механизмом: [knowledge](knowledge.md).

## Primary entry points

| Задача | Файлы от корня репозитория |
| --- | --- |
| Выбор online/offline transport | `app/src/services/api.js`, `app/src/services/apiConfig.js` |
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
8. `card_notes` (Dexie v5) is a separate personal-note outbox. `api.js` routes its mutations through `offlineApi.js` to `cardNotes.js`: persist first, then use the existing authenticated network client. Existing entity sync resolves temporary card IDs before flushing this outbox. UUIDs, tombstones, local revisions and a per-account write lock protect retries/edits; account switching cannot consume another account's responses. The study card reads visible notes from Dexie; its first server read loads the deck's notes in one batch and subsequent card changes reuse that result. Explicit refresh fetches again. Card/progress snapshots never include notes. Tests: `app/src/services/__tests__/cardNotes.test.js`, `scripts/tests/browser/card-notes.spec.cjs`.
   An annotation error leaves its draft dirty and returns `card_notes_pending`, without blocking committed entity/review synchronization or unrelated offline API actions. Manual profile sync shows this partial result explicitly; the notes panel retains its pending/error/retry states.
   A flush attempts every matching note, acknowledges only successful unchanged local revisions, and reports the first error after the loop. Rejected/network-failed records remain dirty across restarts and retry with the same UUID; one record cannot block other notes. Existing entity sync is unchanged.

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
