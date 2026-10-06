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
5. Клиент подтверждает пакет, переводит временные ID, синхронизирует learning preferences и получает `/sync/v2/pull`.
6. Snapshot применяется с сохранением локальных dirty changes; события remap/synced обновляют клиентские представления.
7. Legacy push/pull и collab-pull остаются отдельными маршрутами; проверяйте caller перед выбором сервиса.

## Source of truth

- `localDb.js` задаёт схему Dexie и отдельную БД аккаунта; несинхронизированные данные принадлежат этой локальной БД.
- `api/models.py` задаёт серверную схему; online entities сохраняются в Peewee, offline доставка — в `offline_sync.py`.
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
