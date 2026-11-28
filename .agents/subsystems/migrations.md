# SQL-миграции: выполнение и история

## Primary entry points / Source of truth

- `api/migrations.py`: каталог `MIGRATIONS`, `run_migrations`, таблица `tma_migration_history`.
- `api/models.py:create_all_tables` готовит схему; `api/main.py` вызывает её в рабочем
  потоке lifespan, `api/index.py` — на cold start Vercel. Ошибка прерывает инициализацию.
- `api/database.py`: `tma_db` и `lerne_db` ссылаются на один объект подключения PostgreSQL.
- Auth и Knowledge имеют отдельные явные transactional runners в `api/migrations.py`; их поведение эта правка не меняет.

## Data flow / Recovery

Vercel сохраняет фактическую политику подготовки схемы: `api/main.py` выполнял её
независимо от `RUN_MIGRATIONS` и `LERNE_SKIP_SCHEMA_INIT`. Эти флаги управляли
дополнительной подготовкой при импорте моделей. Импорт теперь только привязывает proxy.

Card communication migration 90 is separate from `MIGRATIONS`: LOCAL bootstrap
applies it; non-LOCAL API startup never does. Both connected Supabase projects
already record ID 87 without `tma_card_note`; test also records 88 and 89, so
87 must not be reused. Production uses only
`scripts/migrate_card_notes.py --apply` with an explicit
`CARD_NOTES_MIGRATION_DATABASE_URL`. The migration
creates private notes and messages atomically; existing untracked tables or a
recorded 90 with a different shape fail closed. Missing note storage is an
isolated 503 from the notes routes. Bootstrap scope and old-schema HTTP
regressions are covered by `test_card_notes.py` and `test_critical_http.py`.

Structured Cards V2 migration 93 has a separate PostgreSQL runner,
`run_structured_cards_v2_migration`. Only PostgreSQL LOCAL bootstrap calls it
automatically. It adds the JSONB column and validated exclusivity constraint,
then records 93 in the same transaction under advisory lock. Reruns check
the recorded schema. Existing cards retain their current representation.
The disposable PostgreSQL check is `python scripts/tests/structured_cards_postgres.py
--bin-dir <path-to-pg-bin>`.

`run_migrations` открывает собственную транзакцию. PostgreSQL advisory transaction lock
`76120901` (ожидание блокировки максимум 5 секунд) или SQLite `BEGIN IMMEDIATE`
сериализует запуск до создания/чтения истории. ID из истории пропускаются.
SQL каждой новой миграции выполняется перед INSERT её ID; весь pending batch
фиксируется вместе. При ошибке SQL, истории или commit batch откатывается,
лог содержит этап/ID, traceback и причину, `MigrationError` прерывает startup
или maintenance-процесс с ненулевым exit code. Следующие миграции не выполняются.
Повторный запуск сохраняет прежние committed ID и повторяет только откатившийся batch.
Если ответ на COMMIT потерян после фиксации, процесс сообщает об отсутствии
подтверждения; повторный запуск проверяет durable history и не повторяет SQL.

`run_migrations_fallback` оставлен совместимым входом в тот же безопасный runner;
запуск без истории запрещён. Разные объекты БД и внешняя транзакция отклоняются
до SQL: существующая центральная история не обеспечивает атомарность между БД.
SQL-каталог, схема истории и локальный механизм views/triggers не изменены.

Старые ложные записи автоматически не удаляются. Неприменённый ALTER при уже
существующей колонке теперь завершится ошибкой; требуется отдельная проверка
схемы и истории перед ручным согласованным восстановлением. По тексту ошибки
«duplicate», «view», «no such column» успех больше не определяется.

## Verification

- `python scripts/test_backend.py scripts/tests/test_sql_migrations.py` — SQLite,
  уникальные удаляемые файлы в `scratch/`, без `.env` и внешних сервисов.
- `python scripts/tests/test_sql_migrations.py --disposable --postgres-port 55449`
  — только отдельный одноразовый PostgreSQL на `127.0.0.1`, роль `migration_test`.
  Создаёт и удаляет уникальные БД `lerne_migration_test_<uuid>`, не использует
  конфигурацию приложения. Кластер необходимо отдельно запустить и остановить.
- Покрытие: успех, SQL-ошибка, DDL/DML/history rollback, ошибка истории и commit,
  потеря подтверждения уже выполненного COMMIT,
  повторный запуск, два параллельных запуска с пустой историей, аварийный выход
  процесса между SQL и записью статуса, ненулевой exit code и propagation startup.

Не запускать каталог миграций на production или локальной БД разработки для
этих проверок. Нетранзакционные SQL-команды не поддерживаются этим runner.

## Native V2: независимая репетиция

Исторический конвертер и команды конвертации выведены из TMA. Архив и решение
об отказе от переноса V1 приведены в [состоянии миграции SQLite](../../docs/SQLITE_MIGRATION.md).

- `tools/native_v2_snapshot.py`: только READ ONLY PostgreSQL, единый exported
  MVCC snapshot для row SHA256, входов конвертера и дампов. Private outputs —
  только новый каталог в ignored `local/test-data/`. Storage probes не являются
  полной копией media; ACL/owners и изменения non-MVCC sequences требуют
  отдельной проверки. Подключение к источнику не импортирует приложение.
- `tools/native_v2_rehearsal.py` проверяет восстановление и схему на отдельном
  одноразовом кластере. `scripts/tests/unified_cards_postgres.py` проверяет
  миграции 96/97 и при необходимости использует восстановленную Native V2-копию.

## Unified Native V2 storage — 96

`api/migrations.py:run_unified_cards_migration` is an explicit PostgreSQL
maintenance operation after 93/94/95 and conversion of active content to V2.
It is never run automatically on a populated database. Empty LOCAL bootstrap
applies it after the historical schema baseline. Stop all writers before a real
cutover; recovery is the pre-migration dump, not a reverse merge of later edits.

The transaction locks both source/target pairs, adds scope/category_id/is_default
and the category FK, enforces personal ownership versus ownerless library placement,
allocates new library IDs, copies every library row, preserves binary/media paths
and author attribution (deck metadata.author_name), remaps source_library_id and
records 96. Failure rolls back data/DDL/history; sequence gaps may remain. Reruns
check the recorded schema. Card scope is derived from the deck, without duplication.

Mandatory: content, all media fields including the deployed-but-unmodelled
card.image_data, categories, personal folder placement, notes and existing personal
IDs/queues. Preserve is_default, deck metadata and author_name. Unused cloud_id,
empty reserve/reserve_topic and collection timestamp collected_at do not drive the
runtime. Nonempty reserve fields stop migration for review. Legacy progress and
reviewhistory are not imported. Source card/deck and their progress/reviewhistory/
uservoice FKs remain intact; no DROP/CASCADE is included. Retired ORM definitions
serve only old schema bootstrap/migration tooling, never library business routes.

Synthetic verification (no private CI input):
`python scripts/tests/structured_cards_postgres.py --bin-dir <pgsql/bin> --unified-storage`.
Explicit private rehearsal: the same runner with `--unified-dump <ignored-v2.dump>`
and `--admin-root <checkout>` restores a fresh disposable database, checks all
personal card hashes, library content/media/placement, categories/notes and other
tables, then runs actual TMA/Admin HTTP and Chromium/offline tests. Use Admin's
normal venv so its pinned card-core wheel passes the unchanged release guard.
External Storage bytes and production cutover are outside this rehearsal.

## Library cleanup 97

Explicit `run_library_cleanup_migration` runs after 93–96 with all writers stopped
and a retained local pre-cutover dump. One transaction locks the sources/targets,
compares full library deck placement and card content/media multisets, preserves
the historical generation token, drops retired tables with RESTRICT and records
97. Unknown FKs, changed media/content, nonempty reviewhistory/uservoice and
unpreserved reserve/sharing data fail without removal. Only proven library
progress may be discarded. Reruns reject reappeared sources. Fresh LOCAL creates
only Native tables and records historical empty 94 before 96/97. 94 permits an
absent source only with cleanup history. Apply 97 before reopening the new API.

V1 content columns on tma_card still support tombstones and the 93 content CHECK.
image_data/source/media paths/creator_id remain used by copy/media/TTS. Retired
ORM definitions and db_v1_reader are maintenance/test tooling, never startup.
Verification: existing unified-storage and explicit unified-dump runners now
cover cleanup refusal/retry, repeated startup, real Dexie pending preservation
and restore/native relation replacement protection after removal.
