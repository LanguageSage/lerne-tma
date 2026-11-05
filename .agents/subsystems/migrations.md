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
