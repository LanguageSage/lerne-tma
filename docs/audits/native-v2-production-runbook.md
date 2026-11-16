# Native V2 — production runbook

15 ноября 2026, Europe/Budapest. **NOT READY к выполнению.** Последняя подготовка артефактов — §10; проверка §9 включает read-only подключение к актуальной production; сведения §8 относятся к предыдущей изолированной фазе.
Основание — [финальный аудит](native-v2-production-cutover-final.md), включая закрытие P1 в §11–12. Здесь только сценарий; production, рабочая LOCAL, исходные исправления и финальный аудит не изменялись.

Техническая подготовка обновлена 15 ноября: guarded CLI и exporter реализованы, точный CLI 92–97 испытан отдельным процессом на восстановленной синтетической PostgreSQL-базе; старый приватный V1-архив проверен без исправления контента и ожидаемо заблокирован конвертером. Подробности проверок — §8. Production и рабочая LOCAL не подключались; P1-исправления сохранены. Прежние TMA contract verifier/Admin `--check-install` PASS не повторялись, большие suites не запускались.

## 1. Выбранный способ

**Полный простой → свежий SQL backup и копия доступных медиа → конвертация на месте существующим кодом → 96/97 → согласованная пара приложений → открытие.** Новая система write-freeze и второй конвертер не нужны. Перенос локально преобразованной БД обратно в production добавил бы restore/ACL/sequences/generation к успешному пути и потому не выбран.

TMA: `2fb3f34f77605e7d6365f89817ae51dd1a365b81` **плюс незакоммиченные P1-исправления**; Admin: `97fe7436158d5a0703eaaadeeb8f46bc9f402e94`, дерево чистое. Diff подтверждает исправления SRS CAS/ack и Like/Dislike; их прежние проверки не повторялись. Это ещё не замороженная release-пара.

Личный старый `tmaprogress` **сохраняем**: сброс разрешён, но конвертации не требуется. Старый library `progress` удаляет 97 после backup — принятая потеря старого SRS. Если владелец выберет также личный reset, это отдельный однократный шаг до открытия: только SRS-поля по образцу `api/services/decks.py:reset_deck_progress`, сохраняя `flag`, `want_to_learn` и IDs. `DELETE/TRUNCATE tmaprogress` потеряет пользовательские annotations и недопустим. Reset не включать в startup/retry и никогда не повторять после появления V2-прогресса.

## 2. Подготовленные инструменты

| Задача | Существующий инструмент / ограничение |
| --- | --- |
| Полный SQL-снимок без зависимости от аудио | `tools/native_v2_snapshot.py`: READ ONLY, explicit identity, общий MVCC snapshot, `public.dump`, `database.dump`, row SHA-256, converter inputs и Storage inventory |
| Проверка конвертации | `tools/native_v2_dry_run.py`: active/deleted раздельно, без записи |
| Атомарная конвертация | `tools/migrate_native_v2_local.py:migrate_active` → существующий `run_v1_migration_dry_run`; обе таблицы проверяются до UPDATE, один commit на все pages, сверка persisted JSON. **Guard этого LOCAL-входа по-прежнему разрешает только disposable cluster**; production-вход — `tools/native_v2_cutover.py`, общее транзакционное тело `_migrate_active` |
| Схема 92–97 | Готовые функции `api/migrations.py`; для 92 уже есть CLI `scripts/migrate_card_ratings.py` |
| Репетиция/сверки | `tools/native_v2_rehearsal.py`, `scripts/tests/structured_cards_postgres.py --unified-dump`, `scripts/tests/unified_cards_postgres.py` |
| Медиа | Download/SHA/manifest/restore verification в `tools/backup_supabase_storage.py`; authenticated download и safe paths в Admin `services/full_database_backup.py` |

**Реализовано, без нового сервиса/таблиц/reverse-converter:**

1. `tools/native_v2_cutover.py`: standalone maintenance CLI, DSN **только** `NATIVE_V2_DATABASE_URL`, без `.env`/app/LOCAL fallback. Обязательные expected host/port/database/role, проверка фактических database/role, remote TLS; рабочая LOCAL (имя/порт) и LOCAL/Vercel process отвергаются. По умолчанию READ ONLY inspect. Для записи: `--apply --writers-stopped --source-inspect ... --confirm-source-sha256 ...`. Сверяет identity, полные public row hashes, history/catalog/constraints/indexes под locks, повторно сверяет исходные строки после 92–95 под locks конвертера. Использует только существующие runners 92–97 и общее тело конвертации; LOCAL guard не отключается. Импорт ничего не применяет; non-LOCAL server startup не вызывает 92–97/content. Исторический startup DDL приложения этим CLI не меняется.
2. `tools/backup_supabase_storage.py`: явный env-файл, Storage origin, expected DB host/name и два новых private каталога (export/restore-check); allowlist **audio/images** в SQL inventory и downloader. Authenticated GET, без redirect/retry; безопасные paths, размер из inventory, SHA-256 скачанного файла и повторное чтение восстановленной копии. `manifest.json` сохраняется при ошибках: `files`, `missing` references с table/ID/field location, `failed` listed objects, `errors`, `uncovered`, before/after inventories. Отсутствующее в исходном inventory audio принято; listed-but-failed (включая 404), 403/timeout/5xx/size mismatch не скрываются. Missing images или изменение inventory дают nonzero exit. Вложенные V2/legacy resources анализируются; embedded image_data остаётся в SQL, внешние origins/другие buckets явно не охвачены. Existing Storage API контракт: [authenticated downloads](https://supabase.com/docs/guides/storage/serving/downloads). Storage не изменяется.

Нет скрытого resume. Неизвестный COMMIT → STOP → новый inspect через новое соединение → сверка durable history/content/hashes. Старый baseline после изменений отвергается; конвертированный источник не принимается для нового apply. Для повторной конвертации восстановить проверенный V1 backup и подготовить новый подтверждённый inspect. Уже записанные schema stages могут сохраниться; не открывать приложения. Не заменять это слепым повтором. Экспорт также требует новые каталоги: неполные/старые файлы не принимаются за проверенную копию.

## 3. Порядок действий

Любой failed gate: **STOP, writers остаются выключены**. Исправление исходного контента — отдельно, затем новый snapshot; скрытых нормализаций нет.

### До окна простоя

1. Зафиксировать release-пару, включающую P1: exact commits, hashes TMA build/Admin wheel, config без секретов. Проверить `python scripts/verify_admin_contract.py`, Admin `run_admin.bat --check-install`, `reviews/library-cleanup97/release-pair.json`. Общий core — `0.1.7`, SHA-256 wheel `1a9a98990c3cda199bca6b173bc65c1b7a262488c225a836f59e1341968a4e8b`. Сохранить исходную production-пару для rollback; номер версии/branch недостаточен. Подготовить CLI/экспортёр/rollback и репетицию. V2 API не подключать к production до 97: `api/index.py` выполняет schema init на cold start, `--skip-domain` этого не предотвращает.

### После отдельного разрешения на окно

2. Остановить **все** источники записи; запретить новые deploy/ручные задания:

| Источник | Действие и доказательство |
| --- | --- |
| TMA | Нужные Vercel team/project → Settings → General → **Pause Project**; основной URL отдаёт platform 503 до Python/startup |
| Старые deployments | Инвентаризация всех production/preview/alias URLs всех проектов с production credentials. Актуальная **Standard Protection**, закрытые bypass tokens/share links/exceptions старых automation. Проверить каждый URL с действительным TMA Bearer, включая GET/init/auth: платформа не пропускает к API. Старые URLs остаются защищены после открытия; оператор не использует их с Vercel session/bypass |
| Admin | Stop задач → дождаться текущей операции → сохранить checkpoints → завершить сервер **и дочерние** regen/AI/TTS/classification/import/transfer/archive/backup workers. Отключить автоперезапуск/resume; закрытая вкладка и paused-status недостаточны |
| Jobs/бот | Отключить GitHub workflow `.github/workflows/reminder-cron.yml` (:07/:37), дождаться/отменить runs. Telegram webhook не достигает API; учитывать retries. Проверить внешние schedulers/scripts/машины, Supabase Cron/Edge jobs. В `vercel.json` crons нет, но внешний cron существует |
| In-flight | Дождаться завершения DB transactions и внешних uploads/AI/TTS. Проверить `pg_stat_activity` по role/client/application_name (без query text), idle-in-transaction и `pg_prepared_xacts`. Повторные user-table counts/hashes и Storage inventory стабильны; неизвестный writer = STOP |

[Pause документирован для production](https://vercel.com/docs/projects/managing-projects#pausing-a-project), поэтому его одного недостаточно для доказательства охвата старых URLs. [Standard Protection](https://vercel.com/docs/deployment-protection#standard-protection) закрывает generated URLs; legacy Pre-Production не закрывает past production. Фактическая конфигурация аккаунта/bypass **ещё не проверена**. Не заменять остановку импровизированным REVOKE: owner/BYPASSRLS его обойдут.

3. Подтвердить target `wdopyuulhiykrextyvnt`, expected DSN identity/TLS и V1 schema/history. Исторические 38 526/8 586 cards, 741/144 decks — ориентир, не frozen baseline. Проверить active/deleted/orphans, reserve/sharing, incoming FK из любых схем; `reviewhistory/uservoice` пусты. Все orphan `tmaprogress` включить в backup без JOIN-фильтра. Перед выделением новых library IDs исключить их коллизии с orphan пользовательскими ссылками; ненулевые коллизии отдельно разобрать, annotations не удалять автоматически.

4. Создать свежий SQL backup и проверить restore. Private outputs — только новые ignored `local/test-data/cutover-<UTC>/` и защищённая внешняя копия. Ниже **будущие** команды; переменные задаёт оператор, секреты не передаются в argv/чат:

```powershell
python tools/native_v2_snapshot.py --source-env-file "$SourceEnv" --expected-host "$ProdHost" --expected-database "$ProdDatabase" --bin-dir "$PgBin" --output "$SnapshotDir"
python tools/native_v2_dry_run.py --snapshot-dir "$SnapshotDir" --output "$DryRunDir"
python tools/native_v2_rehearsal.py --snapshot-dir "$SnapshotDir" --admin-root "C:/121/Lerne_projekt/lerne-admin" --bin-dir "$PgBin" --output "$RehearsalDir" --convert-active
python scripts/tests/structured_cards_postgres.py --bin-dir "$PgBin" --unified-dump "$RehearsalDir/native-v2.dump" --admin-root "C:/121/Lerne_projekt/lerne-admin" --unified-smoke-only
```

Gate: `database_observation_complete=true`, `errors=[]`, оба dump в `artifacts`, SHA/size и `pg_restore --list` проверены. Snapshot script может вернуть 0 при ошибке отдельного dump: exit code недостаточен. Использовать PG binaries совместимой версии (последнее наблюдение сервера — 17.6), direct/session connection, не transaction pooler.

`public.dump` сохраняет все данные приложения, включая auth/session, notes/messages/ratings, SRS/orphans, Knowledge/receipts/settings и embedded media. Restore public должен дать точное равенство frozen row hashes/counts, indexes/validated constraints; sequences безопасны для существующих IDs. `database.dump` содержит доступные остальные схемы; managed extensions могут помешать его vanilla restore. Такой отказ не объявлять full-cluster recovery; пользовательские данные вне public требуют отдельного доказанного recovery.

Отдельно сохранить schema-only dump public **с owners/ACL**, defaults/RLS/policies/зависимости и определения нужных ролей без паролей: portable restore использует `--no-owner --no-acl`, row hashes доступа не восстанавливают. Полный `database.dump` не заливать поверх managed auth/storage.

Активные карточки **обеих** таблиц: blocked=0, включая свежий input 348700 без исправления на копии. Нынешний дефект этой карточки не доказан. Deleted V1 сохраняются tombstones, legacy restore не открывать. Dry-run exit 2 требует разбора active/deleted отчётов. Rehearsal тоже возвращает 2/CONDITIONAL — читать checks, это не production допуск. Его `native-v2.dump` ещё до 96/97; второй runner проверяет 96/97 отдельно. CLI `native_v2_cutover.py` уже прошёл отдельную синтетическую репетицию 92–97 (§8). Перед cutover повторить **его** на одноразовой восстановленной копии свежего frozen backup, с новым inspect этой копии. Не исправлять вход молча; исторический архив сейчас блокируется. Повтор всего suite не нужен.

5. Скопировать **все объекты audio/images**, включая неиспользуемые, существующим доработанным exporter (§2). Env-файл содержит `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_KEY`; origin должен точно совпасть с `--storage-url`. Не выводить ключ/DSN в чат или argv. Команда будущего окна:

```powershell
python tools/backup_supabase_storage.py --source-env-file "$SourceEnv" --storage-url "$StorageOrigin" --expected-host "$ProdHost" --expected-database "$ProdDatabase" --output "$MediaExportDir" --restore-check "$MediaRestoreCheckDir"
```

Требовать exit 0 **и** `ok=true`, `failed=[]`, `errors=[]`, `restore_verified=true`, стабильный inventory; прочитать `missing`/`uncovered`. Оба каталога новые, под ignored `local/test-data/`. Для каждого файла повторно прочитать size/SHA и проверить копирование в isolated restore directory; сверить начальный/конечный inventory. Manifest разделяет `files` (downloaded_verified), `failed` listed objects и `missing` DB references без объекта (bucket/name/table:ID.field location), а также неохваченные external origins/metadata/resources. Анализ ссылок охватывает все media fields и V2/legacy resources, не только пять полей старого SELECT.

Исторически missing: **1 161 paths / 2 901 references**; свежие числа могут отличаться. Отсутствующее аудио принято, ссылки не обнулять и не восстанавливать любой ценой; auth/timeout/5xx не классифицировать как историческую утрату. Необъяснённые новые потери/images требуют решения. Формулировка: «SQL backup проверен; N доступных медиа проверены, M отсутствуют/не скопированы, manifest приложен». Неполную копию полной не называть: [PostgreSQL backup не содержит Storage bytes](https://supabase.com/docs/guides/platform/backups).

Строгий Full Database Bundle Admin откажет на missing references; его не использовать как обязательный путь SQL backup. `scripts/backup_cloud_storage.py` — старый ограниченный exporter для удалённого бакета, для этой задачи не использовать; legacy `tools/backup_database.py`/`restore_database.py` частичные/LOCAL-only — не подходят.

6. В maintenance-процессе явно задать `NATIVE_V2_DATABASE_URL` через защищённое окружение оператора (не argv/чат), с TLS для remote direct/session подключения. После остановки writers сохранить inspect. Сверить его public hashes с frozen backup manifest, identity и schema/history; затем оператор подтверждает SHA-256 **этого** файла. Выходные JSON должны быть новыми в ignored `local/test-data/`.

```powershell
python tools/native_v2_cutover.py --expected-host "$ProdHost" --expected-port "$ProdPort" --expected-database "$ProdDatabase" --expected-role "$ProdRole" --output "$InspectJson"
# После проверки inspect и backup; подтверждённый digest передаётся явно:
python tools/native_v2_cutover.py --expected-host "$ProdHost" --expected-port "$ProdPort" --expected-database "$ProdDatabase" --expected-role "$ProdRole" --output "$ApplyJson" --apply --writers-stopped --source-inspect "$InspectJson" --confirm-source-sha256 "$ConfirmedInspectSha256"
```

Inspect не является backup и не доказывает остановку внешних writers. `--writers-stopped` — явное подтверждение оператора; session advisory lock исключает только второй такой CLI. Exit 0 и `ok=true` apply-отчёта обязательны, затем полный gate §4. Порядок внутри CLI строго:

| Шаг | Существующая функция / gate |
| --- | --- |
| 92 | `run_card_rating_migration`: table/unique/CHECK/RLS/grants/history |
| 93 | `run_structured_cards_v2_migration`: tma_card JSONB/exclusivity CHECK |
| 94 | `run_library_cards_v2_migration`: тот же контракт card |
| 95 | `run_card_source_migration`: source nullable обеих таблиц |
| Content | Общее тело `migrate_active`: prevalidate обе таблицы → один atomic write → persisted JSON и immutable hashes совпадают с планом |
| 96 | `run_unified_cards_migration`: полная library, новые IDs, placement/source_library_id; personal IDs неизменны |
| 97 | `run_library_cleanup_migration`: content/media/placement равны, пять legacy tables DROP RESTRICT, anchor/history committed |

Каждый schema runner имеет собственную транзакцию; общего outer transaction нет. При отказе 93–95/96 могут оставаться committed: приложения не открывать. Schema rerun только со штатными checks; conversion без автоматического resume, нужен fresh V1 input. После 97, **только если выбран**, выполнить зарегистрированный однократный личный reset (§1).

7. До допуска пользователей сверить §4, сохранить post-migration V2 dump/manifest. Выпустить **точную** пару TMA/Admin; jobs оставить выключенными. Для smoke открыть только новый deployment оператору через platform protection, сохраняя блокировку пользователей/старых URLs. Этот способ доступа проверить заранее: public reopening ради smoke недопустим.

8. После PASS §5 открыть production domain, сохранить защиту старых/generated URLs; включить Admin и согласованные jobs. Старым checkpoints — новый preview под новым contract, не resume. Проверить первые синхронизации/grades. При ошибке — §6.

## 4. Gate сохранности до открытия

Использовать полные ID sets/hashes и проверенный conversion plan: алгоритмы сверок уже есть в `immutable_cards`, `fingerprints`, `unified_cards_postgres.verify_restored` и 96/97; тестовые mutations на production не запускать.

- Все active cards — валидный canonical V2; количество/типы/Context/explanation/layout равны плану. Все deleted учтены.
- Personal IDs/owner/folder/deck placement/history/timestamps/source и **все** media fields, включая `image_data`, сохранены. Допустимы только преобразованные V1 content fields и remap personal deck `metadata.source_library_id`.
- Library counts/multisets content/media/placement с учётом новых IDs равны источнику; categories/parent/order/metadata/author_name/is_default сохранены.
- **Все остальные public tables** равны frozen hashes: users/auth, folders/settings/prompts, notes/messages, permissions/sharing, Knowledge/outboxes/receipts, ratings и personal progress/annotations. Исключения строго перечислены: history/DDL 92–97, новые library rows/remap, generation anchor, удаляемые legacy tables/старый library SRS и отдельно выбранный reset. Другая разница = STOP.
- History/schema 92–97 согласованы, CHECK/FK validated, sequences безопасны, RLS/effective client grants не расширены. 97 сохраняет generation через anchor; обычный cutover не является restore.

## 5. Короткий smoke

На отдельном тестовом аккаунте/материале после сохранения baseline: login/init/catalog, personal/library read; native create/edit/copy/export→import TMA/Admin; реальный audio/image HTTP/CORS; note/flag/bookmark; Like→Dislike→clear/reload; foreign access 403. Проверка всех девяти типов — полный data gate и прежние nine-type доказательства.

Grade создаёт **новый** V2 progress; native offline→online event/replay применяется один раз; stale snapshot с новым request_id получает 409, новый SRS сохранён, conflict pending не исчезает. Не симулировать недоступность production DB ради 503: отрицательные случаи уже проверены изолированно. Повторный startup не возвращает legacy tables; старые deployment URLs недоступны до и после reopening.

## 6. Откат

**До reopening:** writers выключены; сохранить rescue dump/журнал даже при неизвестном COMMIT. Сверить durable state; затем при необходимости вернуть свежий **V1 public dump**, исходную пару приложений и доступ. Storage audio/images не менялись.

Заранее подготовить и проверить на disposable V2-копии: `pg_restore --clean --if-exists --no-owner --no-acl --file <reviewed.sql>` с TOC без `SCHEMA public`. Добавить точечное удаление новых objects/dependencies, которых нет в V1 dump и которые мешают clean: например, `tma_card_rating`, `tma_deck_category_id_fkey`, если absent в frozen baseline. Сверить **полный** schema/dependency diff. Применять reviewed SQL и сохранённый owner/ACL replay одной транзакцией через `psql -X --set ON_ERROR_STOP=on --single-transaction --file ...` к проверенному target. Не применять DROP SCHEMA/CASCADE или restore managed schemas; неизвестная зависимость = STOP.

После восстановления проверить V1 hashes/schema/ACL/sequences; до открытия вызвать существующий `mark_database_restored(database)`, commit и проверить generation/recovery на **исходном rollback-релизе**. Restore marker — ожидаемая дополнительная разница. Этот production rollback ещё не отрепетирован. Admin bundle restore требует пустую цель; legacy partial restore и LOCAL restore здесь не подходят.

**После пользовательских V2-записей:** вновь остановить writers, сохранить rescue dump/media inventory со всем новым SRS/голосами/notes. Предпочесть исправление вперёд. Слепой возврат V1 backup запрещён: rescue dump сам по себе не переносит delta. Возврат только после отдельно проверенного переноса новых данных и согласования; без него сохранять закрытую V2 до исправления.

## 7. Решение, риски и разрешения

**NOT READY** по конкретным причинам:

1. Guarded entrypoint, синтетические 92–97 и **in-place V2→V1 rollback с owners/ACL** проверены (§9). Реальные production TOC/dependency/ACL и generation на исходном rollback-релизе требуют отдельной сверки; синтетический PASS их не заменяет.
2. Inventory доступного Vercel-проекта и protection прочитаны (§9); bypass/exceptions, охват внешних writers и operator-only reopening ещё не доказаны.
3. Нет свежего frozen backup с restore и active converter-ready gate; 348700 требует актуальной проверки.
4. Локальная release-пара с P1 собрана и хеширована, существующие audio/images полностью скопированы (§10). До go/no-go разобрать 5 unresolved image paths / 15 active references; платформенная Vercel Python 3.12 сборка не выполнялась.

**Не блокеры:** разрешённая утрата старого library SRS, различие прежних SRS counts и ранее отсутствующее аудио. Принятые ограничения: V1 offline queues могут требовать ручной сверки/сохранения, их не очищать; автоматическая миграция всех устройств не обещается. P2 поиска 11–18 секунд остаётся известным долгом; нового UI/Admin функционала не добавлять. Неизвестный writer или новая необъяснённая потеря не считаются принятым риском.

`tma-audio` **уже удалён владельцем**. Его удаление завершено и не входит в будущие действия или необходимые разрешения. Рабочие `audio` и `images` не изменять; exporter только читает их.

Технические дополнения к tools выполнены. Окно простоя определить по свежей репетиции и объёму медиа; исторический blocked input не использовать для оценки успешной конвертации текущего production.

**Отдельное разрешение владельца на выполнение:** остановка/возобновление TMA/Admin/jobs и изменение protection; свежий production backup/выгрузка private media; commit/merge/release/deploy/переключение; 92–97/content conversion и выбранный личный reset; destructive production rollback. Сейчас выполнена подготовка кода/документа и изолированные проверки; рабочая LOCAL не используется как цель.


## 8. Результаты целевых проверок подготовки

15 ноября 2026, только новые disposable PostgreSQL-кластеры под ignored `local/test-data/structured-cards-pg-*`, роль `cards_test`, случайный loopback-порт. Исходный приватный dump только читался; production/рабочая LOCAL/Storage/сервисы не изменялись. Тесты CI генерируют синтетические данные; приватный dump подключается только отдельным `--private-dump`.

| Проверка | Результат |
| --- | --- |
| Default inspect; неверные DB/role/port/LOCAL process; неверный SHA; изменённый baseline | PASS: отказ без row/DDL writes; inspect не меняет схему/данные |
| Remote DSN без TLS, maintenance imports, non-LOCAL startup, прежний LOCAL guard | PASS, targeted `test_native_v2_rehearsal_tools.py`: 8 тестов; 92–97/content не применяются при import/startup |
| Blocked library conversion | PASS: обе таблицы проверены до UPDATE, 0 content writes |
| SQL-ошибка во второй таблице; порча неизменяемого media внутри конвертации | PASS: первая UPDATE также откатывается; immutable hashes защищают non-content/deleted rows до COMMIT |
| Неизвестный COMMIT | PASS: тест фиксирует content COMMIT и теряет подтверждение; CLI останавливается, новый inspect видит durable V2, повтор со старым baseline отказывается без записи; восстановленная V1-копия проходит весь CLI |
| Синтетический V1 dump → restore → отдельный процесс production CLI 92–97 | PASS: history 92–97, валидные V2, personal IDs/media/embedded image/deleted rows/notes/progress сохранены, legacy tables удалены |
| Post-97 V2 dump restore; отдельное V1 recovery | PASS: полное равенство row hashes соответствующему исходному состоянию; завершённый apply повторно не применяется |
| Существующий `supabase_production_public.dump` → одноразовый restore → тот же CLI | Без исправления контента **ожидаемый STOP** на prevalidation одной TMA-карточки; 0 V2 записей в обеих таблицах. Это не PASS полного cutover архивных/актуальных production данных; текущую карточку production здесь не читали |
| Storage exporter | PASS: 7 синтетических тестов размера/SHA, authenticated URL, safe paths/allowlist, чтения восстановленных bytes, nested resources, manifest missing audio/images, 403/404/500 и drift inventory. HTTP/DB transport изолирован заглушками; действующий Storage не выгружался |
| Python compile | PASS для изменённых Python-файлов |

Команды проверок:

```powershell
python scripts/tests/native_v2_cutover_postgres.py --bin-dir "$PgBin"
# Отдельная явно приватная проверка, не вход CI:
python scripts/tests/native_v2_cutover_postgres.py --bin-dir "$PgBin" --private-dump "$ArchivedV1Dump"
python scripts/test_backend.py scripts/tests/test_native_v2_rehearsal_tools.py
python -m unittest scripts.tests.test_native_v2_storage_export -v
```

Private evidence: `local/test-data/cutover-cli-c6617945f29947bdb22c5ec1069e9f0c/` содержит историческую проверку с отказом; финальная синтетическая проверка — `local/test-data/cutover-cli-958f2d96064647bcbbf47707d713c5b7/`. Большие browser/application suites без изменений продукта не повторялись. Проверки не доказывают production protection/URLs/writers, актуальную converter-ready базу, живую выгрузку media или in-place rollback/ACL. Эти gates §3/§6/§7 остаются до отдельного разрешения на production окно.


## 9. Readiness preflight и репетиция in-place rollback — 15 ноября 2026

**Актуальная production: read-only наблюдение выполнено.** Использован существующий `scripts/structured_cards_preflight.py --dsn-env CUTOVER_DATABASE_URL`, DSN взят из явно прочитанной конфигурации, принадлежность project `wdopyuulhiykrextyvnt` сверена по pooler username до соединения. Environment передан без app/LOCAL fallback, `PGOPTIONS=-c default_transaction_read_only=on`; inspector открывает REPEATABLE READ READ ONLY. Приложение не импортируется. Отдельное соединение подтвердило `transaction_read_only=on`. Никакая конвертация, включая converter dry-run, не запускалась.

Наблюдение `2026-11-15T18:26:28.731638+00:00`: 41 public-таблица; `tma_card=38526`, `card=8586`, `tma_deck=741`, `deck=144`, `tmaprogress=7392`. Полные row hashes/schema/sequences находятся только в ignored `local/test-data/readiness-20261115/production-preflight.json`. Exit **2** — штатный blocked verdict inspector, не ошибка подключения. Report blockers: `writer_fence_not_verified`, `device_coverage_not_verified`, `rollback_not_verified`, отсутствующая `tma_card_rating`, отсутствие V2 schema обеих card tables. Последние три schema findings ожидаемы **до** явно разрешённых 92–95, не являются поводом применять их сейчас. `rollback_not_verified` — фиксированный внешний gate inspector; новый synthetic drill не меняет production-report задним числом. Preflight **не проверяет converter-readiness**. Данных об актуальном дефекте 348700 этот запуск не даёт.

Дополнительное read-only наблюдение: prepared transactions = 0; другие подключения: idle=4, state недоступен/null=2. Это не доказательство отсутствия writers. Схем `cron`/`supabase_functions` не обнаружено в данной БД; внешние schedulers/Edge jobs этим не исключены. Сервисы не останавливались. Наблюдение не frozen snapshot и не свежий backup.

### Проверенный scope Vercel и перечень отключения

Authenticated read-only `list_projects/get_project/list_project_domains/list_aliases/list_deployments`: доступен один проект `tma`, project `prj_7klMipRiXol3KAvxDElU9LEKOLv7`, team `team_wjzyWOEAmIkLhTGAvbxF3e4c`. Полная возвращённая страница: **54 deployment records, pagination.next отсутствует**, 3 aliases (next=null). Доступные API вернули SSO enabled, `deploymentType=all_except_custom_domains`; passwordProtection disabled, trustedIps disabled. `live=false` не интерпретировать как доказанный Pause. Настройки не менялись; bypass secrets/share links не создавались. У `tma-amber.vercel.app` alias `protectionBypass={}`; отсутствие bypass для всех остальных URLs/automation этим не доказано.

Последний production deployment: `dpl_D1pF7WP7rX83pf6LiVdn5ULuaJLQ`, `tma-qjkwo5hzk-u6141216213-maxs-projects.vercel.app`, commit `edceff02f29df32af501806efb301cf2d6a3ec62`. **Он отличается от локального Native V2 кандидата.** Это значение latestDeployment из API; фактическую недоступность/защиту HTTP мы не проверяли. HTTP GET/HEAD к `/api/*` не выполнялись: cold start способен запустить исторический startup DDL. Не использовать `web_fetch_vercel_url`: он может создавать bypass URL.

Точный список известных входов, которые оператор должен закрыть на время окна:

| Writer/вход | Что закрыть и что ещё требуется проверить |
| --- | --- |
| Основной TMA | `https://tma-amber.vercel.app` и project alias `https://tma-u6141216213-maxs-projects.vercel.app`; весь API, включая GET/init/auth со скрытыми записями, uploads/TTS/AI/sharing/sync/study |
| Branch alias | `https://tma-git-main-u6141216213-maxs-projects.vercel.app` (сейчас указывает на `tma-71912djxh-u6141216213-maxs-projects.vercel.app`); не открывать старый API операторским bypass |
| Старые/preview/production deployments | Все 54 точных hostname ниже, независимо от branch/state. Какие из них имеют production credentials, безопасными metadata-запросами не установлено — исключать их из охвата нельзя |
| GitHub reminders | `LanguageSage/lerne-tma`, `.github/workflows/reminder-cron.yml`: schedule `7,37 * * * *` UTC и `workflow_dispatch`; POST `https://tma-amber.vercel.app/api/bot/cron-reminders`. Оператор отключает workflow и разбирает in-flight runs; текущее enabled/runs состояние здесь не проверялось |
| Telegram | POST `/api/bot_webhook` на фактически зарегистрированном webhook origin. Код пути проверен, live webhook origin не запрашивался; владелец подтверждает его и delivery/retry policy. Не вызывать GET `/api/bot_setup`, он меняет Telegram webhook |
| Admin | Все экземпляры сервера и дочерние `services/regen_worker.py` (AI/TTS/bulk), `services/classification_worker.py`, `folder_import_worker.py`, `transfer_worker.py`, `material_archive_worker.py`, `full_database_worker.py` и ручные maintenance/import/restore jobs. Остановить задания, дождаться завершения, сохранить checkpoints, отключить autoresume/autostart. Код подтверждает эти writers; инвентаризация процессов на всех машинах требует владельца |
| Прямые подключения | Любые DB consoles/scripts/CI/другие машины с production DSN, внешние schedulers/Edge functions и прямые Storage uploads. Неизвестный writer = STOP. Четыре idle DB sessions сейчас не доказывают их безопасность |
| Deploy/autostart | Не допускать новых deploy/cold starts/ручных maintenance запусков до допуска пары. После будущего fence проверить drained transactions/uploads и стабильные hashes/inventory, не полагаться на закрытую вкладку |

Полный набор deployment hostname из API (сохранён также в ignored `local/test-data/readiness-20261115/deployment-urls.txt`):

```text
tma-qjkwo5hzk-u6141216213-maxs-projects.vercel.app
tma-oixblpsue-u6141216213-maxs-projects.vercel.app
tma-71912djxh-u6141216213-maxs-projects.vercel.app
tma-4sxgtxsiy-u6141216213-maxs-projects.vercel.app
tma-biv1tr61n-u6141216213-maxs-projects.vercel.app
tma-osyyho6iz-u6141216213-maxs-projects.vercel.app
tma-msrgs6v1t-u6141216213-maxs-projects.vercel.app
tma-csypxfsqs-u6141216213-maxs-projects.vercel.app
tma-ku5sz12kz-u6141216213-maxs-projects.vercel.app
tma-nt44apw0t-u6141216213-maxs-projects.vercel.app
tma-bgoli7du7-u6141216213-maxs-projects.vercel.app
tma-ahmkqkc65-u6141216213-maxs-projects.vercel.app
tma-5x1lughqn-u6141216213-maxs-projects.vercel.app
tma-crhwpyg7x-u6141216213-maxs-projects.vercel.app
tma-lv5bt6tg6-u6141216213-maxs-projects.vercel.app
tma-50t94u9e9-u6141216213-maxs-projects.vercel.app
tma-jw07junph-u6141216213-maxs-projects.vercel.app
tma-8nosuxqn4-u6141216213-maxs-projects.vercel.app
tma-my2vg0bug-u6141216213-maxs-projects.vercel.app
tma-ihzy4jx7x-u6141216213-maxs-projects.vercel.app
tma-3qtt2dshs-u6141216213-maxs-projects.vercel.app
tma-jlsm67zm1-u6141216213-maxs-projects.vercel.app
tma-rdnwvsstb-u6141216213-maxs-projects.vercel.app
tma-74ztq3vgo-u6141216213-maxs-projects.vercel.app
tma-5ja26wbb4-u6141216213-maxs-projects.vercel.app
tma-pro5je3zy-u6141216213-maxs-projects.vercel.app
tma-8c2igd8z9-u6141216213-maxs-projects.vercel.app
tma-8ry5580f9-u6141216213-maxs-projects.vercel.app
tma-nhh95wiwz-u6141216213-maxs-projects.vercel.app
tma-5nfiq6fig-u6141216213-maxs-projects.vercel.app
tma-dfflrzstu-u6141216213-maxs-projects.vercel.app
tma-fzfda8dfj-u6141216213-maxs-projects.vercel.app
tma-938uge5e7-u6141216213-maxs-projects.vercel.app
tma-7dgbjax3s-u6141216213-maxs-projects.vercel.app
tma-gaeakhgou-u6141216213-maxs-projects.vercel.app
tma-g91l1t9s0-u6141216213-maxs-projects.vercel.app
tma-ejx44ljg2-u6141216213-maxs-projects.vercel.app
tma-l5qh82tup-u6141216213-maxs-projects.vercel.app
tma-ma922xb9s-u6141216213-maxs-projects.vercel.app
tma-bpeoyh41a-u6141216213-maxs-projects.vercel.app
tma-9umsronix-u6141216213-maxs-projects.vercel.app
tma-yoi7ncqfq-u6141216213-maxs-projects.vercel.app
tma-ex63mu51l-u6141216213-maxs-projects.vercel.app
tma-klujzq2j0-u6141216213-maxs-projects.vercel.app
tma-40egj1q8a-u6141216213-maxs-projects.vercel.app
tma-mqtay9vf2-u6141216213-maxs-projects.vercel.app
tma-2t49rfymz-u6141216213-maxs-projects.vercel.app
tma-egfjzr2l3-u6141216213-maxs-projects.vercel.app
tma-imqs4lrhe-u6141216213-maxs-projects.vercel.app
tma-6k1j80n6a-u6141216213-maxs-projects.vercel.app
tma-2287xwyjk-u6141216213-maxs-projects.vercel.app
tma-b9h4ku3fn-u6141216213-maxs-projects.vercel.app
tma-4btrlyvdp-u6141216213-maxs-projects.vercel.app
tma-mpb70fsdr-u6141216213-maxs-projects.vercel.app

```

Охват — доступный аккаунту Vercel project. Владелец должен подтвердить отсутствие других проектов/аккаунтов с тем же production DSN, exceptions/bypass и возможность operator-only smoke без reopening. SSO конфигурация прочитана; фактическая защита каждого URL под действительным TMA Bearer остаётся gate окна.

### In-place rollback: подтверждённая репетиция

На **новом disposable PostgreSQL**, без подключения production/LOCAL, восстановлены существующие synthetic V1/V2 dump из `cutover-cli-958f2d96064647bcbbf47707d713c5b7`. Использована процедура §6, не новый rollback engine: TOC → reviewed SQL `pg_restore --clean --if-exists --no-owner --no-acl` → точечные `DROP TABLE tma_card_rating RESTRICT` и `ALTER TABLE tma_deck DROP CONSTRAINT tma_deck_category_id_fkey` → ACL из исходного dump через отдельный TOC → единая `psql -X --set ON_ERROR_STOP=on --single-transaction`.

PASS: после V2→V1 **в той же target-БД** совпали все row hashes, полный нормализованный schema-only dump (включая indexes/constraints), значения sequences, owners/ACL таблиц и sequences. Синтетический `rollback_reader` получил исходный SELECT и USAGE sequence; INSERT остался запрещён. DROP SCHEMA/DROP CASCADE не применялись. Первая проверка SQL была уточнена: исходные FK `ON DELETE CASCADE` разрешены, команды `DROP ... CASCADE` запрещены. Созданные файлы/кластеры сохранены, файлового удаления не было; останавливался только собственный одноразовый test PostgreSQL после проверки, не действующие сервисы.

Evidence: ignored `local/test-data/readiness-20261115/rollback_drill.py`, `reviewed.sql`, `acl.sql`, `rollback-v1-with-acl.dump`, `rollback-result.json`. Это синтетическая проверка механизма. Реальные production роли/ACL/RLS policies/dependency diff и generation/recovery на исходном rollback-релизе ещё не воспроизведены; переносить этот SQL на production запрещено.

### Точный release-кандидат

[`native-v2-release-manifest.json`](native-v2-release-manifest.json) фиксирует heads/branches, working diff SHA-256 и SHA-256 файлов исходников TMA/Admin, включая незакоммиченные P1 CAS/ack SRS и Like/Dislike. TMA head `2fb3f34f77605e7d6365f89817ae51dd1a365b81`, dirty=true; Admin head `97fe7436158d5a0703eaaadeeb8f46bc9f402e94`, dirty=false. Core wheel 0.1.7 присутствует, hash записан в manifest. `scripts/verify_admin_contract.py` повторно PASS; Admin `--check-install` повторно PASS (core 0.1.7, diagnostics=2, profiles=8, assets present, без доступа к БД). Старый review manifest расположен в **Admin**: `../lerne-admin/reviews/library-cleanup97/release-pair.json`, не в TMA.

Это точный source candidate, **не выпущенная build-пара**: build hashes и привязка к будущему deployment ещё отсутствуют. Незакоммиченные файлы сохранены; commit/merge/deploy не выполнялись. Перед release сверить file hashes и включить P1 в разрешённый release; любой drift требует нового manifest. Живая выгрузка `audio/images` по-прежнему не выполнялась; `tma-audio` уже удалён и не является действием/блокером.

**Решение:** обсуждать предварительное окно можно, подтверждать выполнение cutover пока нельзя. До go/no-go нужны владельческий inventory/fence/protection/bypass, frozen backup+restore+актуальная converter-ready репетиция, media export и точные production rollback ACL/generation/release artifacts. Отсутствующая V2-схема до окна и ранее отсутствующее аудио не новые блокеры.


## 10. Артефакты и подготовка к окну — 15 ноября 2026

Без изменений production/Storage/LOCAL, без миграций, merge/deploy и остановки действующих сервисов. Исходники release manifest сверены до сборки: drift=0 в TMA/Admin; P1 сохранены. Большие тестовые наборы не повторялись.

**Release-пара собрана локально.** Vite production build PASS (Node 24.14.0, Vite 8.0.8), outDir новый `local/test-data/release-build-20261115/tma-web`, рабочий app/dist не менялся. Build использует `LERNE_ISOLATED_CHECKS=1` (envDir отключён), LOCAL выключен, штатный same-origin `/api` на Vercel; секреты конфигурации не включены. Предупреждение о chunk >1000 kB не помешало сборке, рефакторинг не выполнялся.

Admin `0.2.2` wheel собран setuptools 80.9.0/wheel 0.45.1 из отдельной staging-копии точных исходников. Все runtime source bytes и wheel RECORD сверены; исходные Markdown-документы вне package-data штатно не упакованы. `--check-install` именно из распакованного **собранного wheel** PASS (core 0.1.7, diagnostics=2, profiles=8, assets present; no DB). `scripts/verify_admin_contract.py` PASS; `scripts/build_card_core.py --wheel ...0.1.7...` PASS provenance/source/RECORD. Общий wheel не пересобирался и не обновлялся. 105 Python-файлов api из TMA-архива успешно скомпилированы без исполнения импортов.

Готовые handoff artifacts (полные пути, размеры и hashes файлов frontend сохранены в `native-v2-release-manifest.json`):

| Artifact | SHA-256 |
| --- | --- |
| `tma-native-v2-source-and-web.zip` | `f80fad394fc94d4c1ebf83591539c9e594a2186cc6677bb86cb59a28b0c501e0` |
| `lerne_admin-0.2.2-py3-none-any.whl` | `e9e947067cf83c0dbcf0b43d43e4475de6df2bd3a525aebce956511f74f4b82f` |
| `lerne_card_core-0.1.7-py3-none-any.whl` | `1a9a98990c3cda199bca6b173bc65c1b7a262488c225a836f59e1341968a4e8b` |

Артефакты лежат в ignored `local/test-data/release-build-20261115/`. TMA ZIP содержит `source/` с точными исходниками/P1 и `web/` с готовым frontend; это handoff bundle, не `.vercel/output` и не готовый deployment ID. Admin wheel проверен в имеющемся окружении зависимостей, установленный Admin не менялся. Локально доступен Python **3.14**; заданный в Vercel Python **3.12** отсутствует (`py -0p`), платформенная сборка/установка backend-зависимостей не выполнялась. Нельзя объявлять эту проверку production runtime smoke. Ранее принятые проверки поведения сохраняют силу.

**Frozen backup/converter tooling готово.** Наличие зависимостей/imports и `--help` проверено для snapshot/dry-run/rehearsal/cutover; compile PASS. `pg_dump/pg_restore` 17.11 доступны, production сообщает 17.6. Конвертер и `--apply` не запускались. В текущем исходном `.env` DSN использует порт **6543**, его не использовать для frozen exported snapshot или session advisory lock CLI. Отдельное TLS session-подключение к тому же project через **5432** реально проверено: `READ ONLY=on`, REPEATABLE READ, `pg_export_snapshot()` успешен; транзакция отменена, соединение закрыто. Сам backup не создавался. Минимальный `source-session.env` (только необходимые DSN/Storage origin/key) подготовлен в защищённом media-каталоге ниже; рабочий `.env` не изменён. Секреты не передавать в argv/чат. Для будущего `$SourceEnv` выбрать этот session-файл; `NATIVE_V2_DATABASE_URL` для maintenance также должен указывать на session DSN, expected-port=5432.

### Короткий checklist остановки TMA

1. Владелец подтверждает полный список writers/URLs/bypass из §9 и разрешает окно. Зафиксировать эту пару по hashes и исходную rollback-пару; остановить новые deploy/ручные jobs.
2. Закрыть TMA и все старые/generated URLs, отключить GitHub reminders/Telegram delivery и Admin workers/autoresume; дождаться завершения transactions/uploads. Подтвердить operator-only smoke. До разрешения это не выполнять.
3. С session DSN создать свежий frozen SQL backup + owners/ACL; прочитать manifest/errors, проверить SHA/size, restore и актуальный converter-ready gate на disposable копии. Сверить остановленные writers и media inventory; при изменении медиа — новая согласованная копия.
4. Сохранить новый inspect production, сравнить frozen hashes/identity/history; явно подтвердить его SHA. Только в разрешённом окне выполнить существующий CLI 92→95→content→96→97. Любая ошибка/unknown COMMIT: STOP, durable inspect и процедура §6, без слепого повтора.
5. Проверить сохранность §4, rollback TOC/ACL/generation, сохранить V2 backup. Выпустить точную пару, выполнить короткий operator-only smoke §5 и только после PASS открыть TMA/jobs; старые URLs оставить закрытыми.

### Фактическая выгрузка audio/images

Выполнена подготовленным exporter, Storage не изменялся. Новый защищённый ACL каталог (только текущий пользователь и SYSTEM): `C:\121\Lerne_projekt\tma\local\test-data\cutover-window-20261115T183715Z`. В нём `media/`, независимый `media-restore/`, исходный `media/manifest.json`, private reconciliation и `source-session.env`; секреты не копировались в Git/артефакты. Основной `.env`, рабочая LOCAL, действующие сервисы не менялись.

**Все существующие объекты скопированы и проверены:** audio **13026**, images **820**, всего **13846**, **468916420 bytes**. Размер каждого файла сверён с inventory, SHA-256 вычислен и проверен повторным чтением; независимая restore-копия verified=true. `failed=[]`, `errors=[]`, before/after inventories равны. SHA-256 неизменённого manifest: `a0d9ff4363d09275068ee9e6ce2d0da401db342803e94348747255d9239faaf1`.

**Exporter exit 1 / ok=false сохранён честно:** кроме bytes он проверяет ссылки. Raw manifest отдельно фиксирует **2133 distinct audio paths / 5165 references**, отсутствовавшие в исходном inventory; это не ошибка скачивания listed объектов и не новая потеря, вызванная этой выгрузкой. Это raw paths: aliases могут пересекаться; числа не подменяют старые исторические 1161/2901. Их не восстанавливали и ссылки не меняли.

Raw images: 270 paths / 881 refs. Конкретная узкая read-only сверка выявила 865 refs к уже скачанным объектам через **существующий basename-route** (`api/routers/media.py:get_image`, `api/services/media.py:resolve_media_url`); 1 ref имеет embedded bytes в `tmamedia` (сохраняется SQL backup). Исходный exporter manifest не нормализовался/не переписывался. Остались **5 image paths / 15 references** активных карточек без найденных bytes в Storage, `image_data` или `tmamedia`. Это существующие до выгрузки unresolved ссылки, не доказательство новой потери. Нужен разбор/решение владельца перед go/no-go, автоматического восстановления/обнуления нет. Private table/ID/path locations: `image-final-reconciliation.json` в защищённом каталоге. Ещё 28 raw references вне охвата exporter отмечены как `uncovered`; полную внешнюю media-копию не обещаем.

**Готовность:** существующие Storage bytes и локальная release-пара готовы, инструменты frozen backup/conversion подготовлены. Можно согласовывать окно. Перед выполнением остаются решение по 5 image paths, владельческий writers/URL/bypass fence, свежий frozen backup/restore с актуальным converter-ready gate и production rollback ACL/generation. Платформенная сборка/смоук точной пары выполняются только в разрешённом release, не выдаются за сделанные сейчас. Сам cutover, deploy, остановка сервисов и изменение production не выполнялись.


## 11. Остановка writers и frozen backup — 15 ноября 2026

Выполнено по решению владельца без отключения `reminder-cron.yml` (workflow обращается только к production endpoint TMA, который возвращает `503 DEPLOYMENT_PAUSED`). Production-миграции 92–97, V1→V2 конвертация, merge/deploy, запуск TMA/Admin и изменения рабочей LOCAL/Storage не выполнялись.

### Проверка блокировки источников записи

- **Локальный компьютер:** процессы `lerne-admin` не найдены (`127.0.0.1:8050` не прослушивается); остановлен обнаруженный локальный `Lerne TMA API` (`PID 73080` / parent `PID 252` на `127.0.0.1:8002`, не подключавшийся к production PostgreSQL). Автозапуск/задачи планировщика для TMA/Admin отсутствуют.
- **Vercel (`prj_7klMipRiXol3KAvxDElU9LEKOLv7`, team `team_wjzyWOEAmIkLhTGAvbxF3e4c`):**
  - Read-only Vercel API: `paused=True`, `ssoProtection={"deploymentType": "all_except_custom_domains"}`, `passwordProtection=None`, `trustedIps=None`, `crons.definitions=0`, `deployments_count=54` (`pagination.next=None`), `protectionBypass_count=1` (`automation-bypass`).
  - HTTP-проверка без редиректов по всем 57 известным URL: `tma-amber.vercel.app`, `tma-u6141216213-maxs-projects.vercel.app`, `tma-qjkwo5hzk-u6141216213-maxs-projects.vercel.app` → `503` (`x-vercel-error: DEPLOYMENT_PAUSED`); все 54 остальных URL (включая `tma-git-main-u6141216213-maxs-projects.vercel.app` и 53 deployment hostname из `deployment-urls.txt`) → `302` на `vercel.com` (Standard Protection). Неожиданных ответов: `0`.
- **Production PostgreSQL (`wdopyuulhiykrextyvnt`, session pooler port `5432`, TLS):**
  - `pg_prepared_xacts = 0`.
  - В `pg_stat_activity` только 4 системные `idle`-сессии Supabase (`pgbouncer / Supavisor (auth_query)`, `authenticator / postgrest`, `supabase_admin`, `supabase_admin / postgres_exporter`). Сторонних подключений TMA/Admin не обнаружено.

### Свежий frozen backup и проверки

Каталог (ignored): `C:\121\Lerne_projekt\tma\local\test-data\cutover-20261115T193104Z\`.

| Артефакт | Размер (bytes) | SHA-256 |
| --- | --- | --- |
| `snapshot/public.dump` | `30778120` | `f4938a9d3e170ab919f005e5e7caa744b905b76c1cd799d2cce060c6174f7c4a` |
| `snapshot/database.dump` | `32627610` | `5e254ec1ecacf70fa3ae6aa1baefca1e603a0c8125b0168628fab4212dc92067` |
| `snapshot/public-schema-acl.sql` | `93078` | `31b9a3394f20c6aa5943b5016401b3ad930b65c766d868ab5151fc2f93623a5c` |
| `snapshot/manifest.json` | `62720` | `0617e0bc5b38c5e8d430c61464fd8c289c274b6051b1da5fa412a2f4f4045430` |

- **`tools/native_v2_snapshot.py` (exit 0):** `observed_at=2026-11-15T19:31:05.284769+00:00`, `database_observation_complete=true`, `errors=[]`, `tma={total: 38526, active: 38526, deleted: 0, native: 0}`, `library={total: 8586, active: 8586, deleted: 0, native: 0}`, `storage_objects=13846`, `migration_history=89`, `sequences_observation_non_mvcc=27`.
- **`pg_restore --list`:** `public.dump` — 416 строк TOC (exit 0); `database.dump` — 846 строк TOC (exit 0). `public-schema-acl.sql` содержит 69 `OWNER TO`, 88 `GRANT`, 1 `REVOKE`, 41 `ENABLE ROW LEVEL SECURITY`, 27 `CREATE SEQUENCE`.
- **`tools/native_v2_dry_run.py` (exit 0, converter-ready):**
  - `tma active`: `ok=true`, `decks=741`, `cards=38526`, `converted_count=38526`, `blocked_count=0`, `v2_valid=true`.
  - `library active`: `ok=true`, `decks=144`, `cards=8586`, `converted_count=8586`, `blocked_count=0`, `v2_valid=true`.
  - `tma deleted` / `library deleted`: `cards=0`, `blocked_count=0`.
- **`tools/native_v2_rehearsal.py --convert-active` (одноразовый PostgreSQL port `60363`, verdict `CONDITIONAL`, `failures=[]`):**
  - `public_restore`: 41 таблица, 72 619 строк, `different_tables=[]`, `all_row_sha256_equal=true`.
  - `catalog`: `index_definitions_equal=true`, 65 constraints в источнике и в восстановленной БД (`constraint_definitions_equal=false` из-за различий форматирования/схемы portable restore).
  - `schema`: 93–95 применены и идемпотентны при повторе; `atomic_migration`: `tma_card=38526`, `card=8586`, `immutable_rows_equal=true`, `other_tables_equal=true`; `v2_dump_restore`: 42 таблицы, `all_row_hashes_equal=true` (`sha256: e4163d3378cd522d6f8ff66701c2b5c7d562601f88267aa9507c34dc284e183`); `v1_recovery`: `before_generation_rotation_all_row_sha256_equal=true`, `generation_rotated=true`. (Не-zero exit обусловлен отсутствием `SUPABASE_DB_URL` в изолированном окружении и ожидаемым `rehearsal_all_schemas` на managed-схемах.)
- **`scripts/tests/structured_cards_postgres.py --unified-smoke-only` на `rehearsal/native-v2.dump`:**
  - PASS: `migration96` (`library_decks=144`, `library_cards=8586`, `personal_cards=38526`), exact personal card hashes и сохранение прочих таблиц, `cleanup97` (strict FK refusal/rollback/retry, legacy generation retained, repeated startup without retired tables), `POST /api/decks/external/import/7510?mode=copy` → `200 OK`.
  - В конце `verify_copy_roundtrip` остановился на проверке версии локально установленного пакета `lerne_card_core` (`RuntimeError: Card core version differs from the reviewed Admin release`) в окружении Python 3.14 после прохождения всех проверок 96/97.

