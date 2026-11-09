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

- `tools/native_v2_snapshot.py`: только READ ONLY PostgreSQL, единый exported
  MVCC snapshot для row SHA256, входов конвертера и дампов. Private outputs —
  только новый каталог в ignored `local/test-data/`. Storage probes не являются
  полной копией media; ACL/owners и изменения non-MVCC sequences требуют
  отдельной проверки. Подключение к источнику не импортирует приложение.
- `tools/native_v2_dry_run.py`: проверяет активные и удалённые записи раздельно,
  сохраняет диагностику; exit 2 при заблокированных данных. Ничего не пишет в БД.
- `tools/native_v2_rehearsal.py`: принимает только private snapshot, explicit
  Admin checkout и PostgreSQL binaries. Использует новый cluster существующего
  disposable runner, проверяет фактический PGDATA/роль/loopback/порт. Сверяет
  public restore, DDL 93/94, повтор, strict Admin contract, V1 recovery, rescue
  dump для синтетической записи после backup и marker поколения. По умолчанию
  content остаётся V1. Не использует DSN приложения для записи.
- `--convert-active` в том же runner применяет недостающую 92 и вызывает
  `tools/migrate_native_v2_local.py`: полная предварительная валидация активных
  TMA/Library карточек существующим converter, затем запись обеих таблиц одной
  транзакцией. SQL pages ограничивают размер запроса, промежуточных commits нет.
  Deleted V1 rows не изменяются, IDs/placement/media/history и другие таблицы
  сравниваются отдельно. Готовый V2 dump восстанавливается в новую БД и сверяется
  по всем row SHA256. Повтор требует исходного V1 dump, resume не предусмотрен.
- `--applications` проверяет реальные TMA/Admin через loopback на ещё одной
  восстановленной V2-копии. Startup DDL отключён; схемой управляет runner.
  Только известные nullable warnings без NULL/critical findings подтверждаются
  штатным Admin API в изолированном локальном журнале. Приватные карточки и
  сессии не являются CI fixtures. Exit 2 — CONDITIONAL/NOT READY, не production
  допуск; детали сохраняются в database-results.json.
- `structured_cards_postgres.py` дополнительно физически разрывает собственное
  соединение перед записью истории 93 и проверяет rollback DDL/истории и повтор
  на новом соединении. Этот тест допустим только в его одноразовом кластере.

Локальный writer конвертирует только active cards; 93/94 допускают V1 tombstones
в других строках. Это не разрешение восстанавливать их через legacy trash API:
перед production отдельно закрыть старые writers/legacy restore либо валидно
конвертировать выбранную tombstone. Полного media backup и сверки устройств эти
инструменты не делают. Production dump/restore требует отдельной остановки writes,
совместимого приложения и проверки generation marker.
