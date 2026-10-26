# SQL-миграции: выполнение и история

## Primary entry points / Source of truth

- `api/migrations.py`: каталог `MIGRATIONS`, `run_migrations`, таблица `tma_migration_history`.
- `api/models.py:create_all_tables` и `api/main.py`: вызовы инициализации; `MigrationError` не подавляется.
- `api/database.py`: `tma_db` и `lerne_db` ссылаются на один объект подключения PostgreSQL.
- Auth и Knowledge имеют отдельные явные transactional runners в `api/migrations.py`; их поведение эта правка не меняет.

## Data flow / Recovery

Card notes migration 87 is separate from `MIGRATIONS`: LOCAL bootstrap applies
it; non-LOCAL API startup never does. Production uses only
`scripts/migrate_card_notes.py --apply` with an explicit
`CARD_NOTES_MIGRATION_DATABASE_URL`. Missing annotation storage is an isolated
503 from the notes routes. Bootstrap scope and old-schema HTTP regressions are
covered by `test_card_notes.py` and `test_critical_http.py`.

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
