# Supabase: аудит и устранение публичного доступа

Первичный аудит: 20 октября 2026. Production: `wdopyuulhiykrextyvnt`, PostgreSQL 17.6.
Статус: миграция БД применена 21 октября 2026 после отдельного разрешения
пользователя и его подтверждения готовности резервной копии.
Deployment исправления API и отзыв сессий пока НЕ выполнены и требуют отдельного разрешения.

## Production: результат применения 21 октября 2026

- Применён неизменённый SQL из коммита `b36cdc8` через Supabase apply_migration.
  Запись истории: `20261021061653`, `lerne_lock_server_only_public_20261020`.
  Время: 08:16 Europe/Budapest (06:16 UTC).
- Перед применением повторно подтверждено исходное состояние: 39 таблиц,
  15 без RLS, 0 public policies/functions, все объекты принадлежат postgres.
  Активные подключения Supavisor используют postgres/NOSUPERUSER/BYPASSRLS.
- После COMMIT: 39/39 public таблиц с RLS; `audit.sql` вернул **0 нарушений**.
  У anon/authenticated нет USAGE public, CRUD на таблицы или USAGE sequences.
  У postgres/service_role сохранился доступ ко всем 39 таблицам и 27 sequences.
- В READ ONLY транзакции под реальными SET LOCAL ROLE выполнено 312 проверок
  отказа для anon/authenticated: SELECT LIMIT 0 и EXPLAIN INSERT/UPDATE/DELETE
  на каждой таблице. Записи не выполнялись, sequences не продвигались.
  Под postgres/service_role прошли 78 SELECT LIMIT 0, без выгрузки записей.
  Серверные права записи подтверждены каталогом; production CRUD/end-to-end
  через пользовательский интерфейс после применения не выполнялся.
- Snapshot исходных ACL/RLS/defaults сохранён: версия `20261020`, 910 rollback
  statements в закрытой `lerne_security.migration_snapshot`.
- Supabase security advisors: ERROR отсутствуют; осталось 40 INFO
  «RLS enabled no policy» (39 public таблиц + закрытая таблица snapshot).
  Это ожидаемое состояние серверных таблиц, разрешающие policies не добавлялись.
- Пользовательские записи, сессии и секреты целевыми UPDATE/DELETE не изменялись;
  containment, ротация секретов и deployment не запускались. Код защиты API от
  X-User-ID находится в main/b36cdc8 и всё ещё требует отдельного deployment.

## Фактический доступ приложения

| Данные | Клиент → сервер → PostgreSQL |
| --- | --- |
| Telegram, аккаунт, токены, challenge | `useAuthStore.js` → `/auth/v2` → `api/auth/providers.py`, `service.py` → `tma_auth_*` |
| Колоды, карточки, прогресс | `services/api.js` → FastAPI routers → Peewee models |
| Совместный доступ | `/collaborative` → `collaborative_service.py` → `tma_collaborator` |
| Офлайн | Dexie → `syncService.js` → `/sync/v2/push,pull` → `offline_sync.py`, `tma_offline_batch` |
| Knowledge | Dexie outbox → `/knowledge/attempts/sync` → attempts/mastery tables |
| Медиа | FastAPI загружает через Storage API; браузер получает публичные audio/images URL |

`api/database.py` инициализирует **оба** Peewee proxy, `tma_db` и `lerne_db`,
одним PostgreSQL-подключением из `SUPABASE_DB_URL`. Локальная конфигурация
указывает на production и роль `postgres` (проверено без вывода credentials).
В production `postgres` владеет всеми 39 таблицами, имеет BYPASSRLS;
`service_role` также имеет BYPASSRLS. Приложение использует прямой SQL,
а не Data API для этих таблиц. Логи Supavisor содержат подключения `postgres`.
Конфигурация развёрнутого приложения отдельно не выгружалась: перед rollout
проверить `current_user` именно через его соединение.

В `app/src` нет Supabase SQL/Auth/Realtime клиента; есть Storage CDN URL.
В runtime API найдены только Supabase Storage HTTP-вызовы. `SUPABASE_KEY`
локально классифицирован как `service_role`; он используется на сервере.
На момент аудита нет public views, public RPC, public policies или публикаций
Realtime для таблиц `public`. Не найден доступный API-ролям обход через
SECURITY DEFINER: найденные два definer в `vault` им недоступны.

**Все 39 таблиц public являются серверными.** Legacy/admin-таблицы используют
тот же прямой SQL. Обоснований для выдачи `anon`/`authenticated` доступа нет.
Supabase `auth.uid()` не соответствует собственным аккаунтам/opaque-токенам Lerne.

## Подтверждённая открытость

15 таблиц без RLS и с CRUD-доступом обеих API-ролей:

```
tma_offline_batch           tma_auth_code              tma_auth_account
tma_collaborator            tma_auth_identity          tma_auth_proof
tma_auth_session            tma_auth_token             tma_auth_challenge
tma_auth_password           tma_auth_password_throttle tma_knowledge_item
tma_card_knowledge_item     tma_knowledge_attempt      tma_user_knowledge_state
```

Ещё 24 таблицы имеют RLS без политик. Это намеренный deny-by-default для Data API,
а не повод добавлять разрешающие политики. Из них 23 сохраняют лишние права;
`tma_game_attempt` уже не выдаёт CRUD API-ролям. RLS не ограничивает TRUNCATE.
В public есть 27 sequences; явных grants на отдельные колонки не найдено.

Advisors подтвердили 15 ERROR и 24 INFO. Метаданные прав и read-only EXPLAIN
под `SET LOCAL ROLE anon/authenticated` подтвердили доступные пути планирования.
Production INSERT/UPDATE/DELETE/TRUNCATE не выполнялись, данные не выгружались.
[RLS disabled](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public),
[RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Отдельная критическая ошибка API: `get_user_id` доверял `X-User-ID`, даже после
неверного Bearer. Исправление использует ту же строгую проверку сессии, что auth v2.
Заголовок остаётся совместимым параметром, но не подтверждает личность.
Валидные сессии сохраняются. Header-only клиенты должны войти заново; локальные
dev URL с ID также больше не предоставляют серверного доступа.
Telegram использует уже существующую проверку подписанного initData/challenge.
Гостевое локальное хранилище и очереди Dexie не удаляются.

## Миграция и защита новых объектов

`20261020_lock_public.sql` выполняется одной транзакцией с ограничением ожидания
блокировок и advisory lock. Она:

1. Проверяет роль/ownership и отсутствие неожиданных public policies/RPC.
2. Сохраняет исходные ACL, column ACL, RLS и затронутые default privileges
   в закрытой `lerne_security.migration_snapshot`. Персональных данных там нет.
3. Включает RLS на всех public tables; не добавляет политик и FORCE RLS.
4. Отзывает **все** права PUBLIC, anon, authenticated на таблицы, sequences,
   отдельно выданные колонки и schema public. Права сервера/service_role сохранены.
5. Убирает автоматические grants для новых объектов, создаваемых `postgres`.
   Удаление глобального PUBLIC EXECUTE затрагивает будущие функции этого creator
   во всех схемах: schema-only revoke не отменяет глобальную привилегию.
6. Проверяет эффективные права, включая наследование/MAINTAIN; при ошибке
   откатывается целиком. Повтор не перезаписывает исходный snapshot.

Platform-owned defaults `supabase_admin` не изменяются: `postgres` не является
этой ролью. Отзыв USAGE public дополнительно закрывает объекты любого creator.
Если будущая интеграция требует Data API, для неё нужен отдельный пересмотр
архитектуры и прав. Миграция не меняет `auth`, `storage` или media bucket policies.

`audit.sql` — read-only gate, успех только при нуле строк. Проверяет все новые
таблицы, views, sequences, RPC, column grants, policies, роли и defaults postgres.
После каждой DDL-миграции обязательно запускать его на целевой базе.
RLS на новых таблицах необходимо включать явно в соответствующей миграции;
до этого ACL/defaults/schema boundary уже запрещают API-доступ.

CI job `database-security` использует отдельный PostgreSQL 17, создаёт актуальные
Peewee models и production catalog fixture без пользовательских записей,
проверяет миграцию, реальные операции ролей, будущее расширение схемы и откат.
Отдельный bootstrap admin создаёт серверную роль `postgres` с NOSUPERUSER/BYPASSRLS,
как в production; при локальном запуске можно передать `--bootstrap-user`.
Она не подключается к production. Проверка live drift запускается отдельно:

```powershell
# Задать SECURITY_AUDIT_DATABASE_URL безопасным способом, не помещая секрет в Git.
venv/Scripts/python.exe scripts/audit_supabase_security.py
# Только отдельный disposable local PostgreSQL, никогда tunnel к production:
venv/Scripts/python.exe scripts/test_supabase_security.py --disposable --port 55439
```

## Последствия и ваши данные

В момент аудита: 26 активных сессий, 27 неистёкших/неиспользованных token records,
28 identity mappings, 14 collaborator records, 1 unused legacy code,
0 незавершённых неистёкших challenges, **0 парольных аккаунтов**.
Это агрегаты, без токенов, email, Telegram subjects или содержимого карточек.

Риск не ограничен Telegram-никами. Запись в auth-таблицы позволяет подменять
доверенное состояние авторизации; запись collaborator — расширять доступ.
Через сервер, работающий с BYPASSRLS, это угрожает вашим колодам, карточкам,
прогрессу и связанным материалам, хотя их таблицы уже имели RLS.
Подмена offline receipt может нарушить подтверждение синхронизации;
подмена Knowledge — повредить учебную историю и mastery.

Токены access/refresh хранятся как SHA-256 случайных 256-bit значений;
чтение хеша само по себе не раскрывает токен. Но **права записи позволяют
подделать session/token записи**, поэтому доверять всей истории сессий нельзя.
Identity/collaborator mappings тоже могли измениться; один logout это не исправит.

Доступный интервал логов — последние 24 часа. Найдены 7 PostgREST service events,
без HTTP method/path/status; edge request logs в выборке отсутствуют.
Postgres logs преимущественно содержат Supavisor idle/disconnect events роли
postgres. Это не полноценный журнал чтений/записей: эксплуатация не доказана,
но **отсутствие эксплуатации, сохранность и отсутствие утечки не установлены**.
Для проверки ваших данных нужен доверенный backup/PITR до периода открытости
и сравнение identity/collaborator mappings, batch receipts и изменённых материалов.
Содержимое карточек и токенов в рамках этого аудита не извлекалось.
Read-only проверки orphan account/identity/session/token/collaborator-user связей,
формата token hashes и допустимости collaborator roles вернули 0 нарушений.
Корректно оформленные поддельные записи такими проверками не обнаруживаются.

Рекомендован отзыв всех сессий после закрытия доступа и deployment строгого API.
`incident_containment.sql` отдельно защищён opt-in: помечает sessions revoked,
legacy codes used, challenges completed; сохраняет строки для расследования.
Он не удаляет доказательства/proof history, identities, учебные записи или Dexie.
После отзыва пользователи входят заново в тот же проверенный аккаунт; очереди
должны синхронизироваться только после проверки его identity mappings.
Отзыв нельзя отменять восстановлением старых sessions: recovery — новый вход.

В текущих отслеживаемых `api`, `app/src`, `scripts`, workflow/config файлах
credential-pattern scan не нашёл service JWT, sb_secret, Telegram bot/OpenAI
ключей. Это не аудит полной Git history, build artifacts или deployment env.
DB password, BOT_TOKEN, Supabase service key не являются полями открытых auth
таблиц по текущим моделям. Их утечка не подтверждена. Само наличие открытых
таблиц не требует механической смены всех интеграционных ключей.
При подтверждённой публикации ключа, подозрительных privileged запросах или
компрометации окружения — перевыпустить соответствующие DB/service/bot/OAuth
secrets и обновить deployment/webhook. Значения никогда не включать в отчёт.
Смена publishable/anon key не заменяет исправление ACL/RLS.

## Порядок production rollout — после отдельного подтверждения

1. Зафиксировать время, сохранить доступные логи и проверить восстановление
   из доверенного backup/PITR. Не хранить dumps с секретами в репозитории.
2. Проверить runtime current_user/BYPASSRLS через соединение приложения.
   Не продолжать, если сервер использует anon/authenticated/неизученную роль.
3. Применить `20261020_lock_public.sql` как `postgres` через approval-controlled
   SQL connection/MCP. Для psql: `psql "$env:SECURITY_MIGRATION_DATABASE_URL"
   -v ON_ERROR_STOP=1 -f security/supabase/20261020_lock_public.sql` (одна строка).
   Это отдельная maintenance migration с собственным ledger; не добавлять её
   в legacy best-effort `api/migrations.py` и автозапуск API.
4. Выполнить `audit.sql`: ноль нарушений. Проверить Data API запросы с реальными
   anon и authenticated credentials: отказ, без строк. Production write probes
   допускаются только в отдельно одобренной синтетической fixture/транзакции.
5. Deploy коммита со строгим Bearer; проверить Telegram/new login, существующую
   сессию, refresh, карточку, grade, viewer/editor и офлайн push/retry/pull.
   Сбой серверного доступа исправлять ролью/конфигурацией, не публичной policy.
6. Отдельно одобрить containment, сверку identity/sharing и необходимую ротацию.
7. После rollout повторить audit/advisors, проверить серверные errors и sync.
   INFO «RLS enabled no policy» для серверных таблиц допустим.

## Откат

Предпочтительно восстановить работоспособность серверного соединения или вернуть
предыдущую версию приложения **с сохранённой защитой БД**. Возврат API-версии
также может вернуть ошибку X-User-ID: не использовать его без компенсационной
защиты. При сбое SQL до COMMIT транзакция откатывается автоматически.

`rollback_20261020.sql` восстанавливает исходные ACL/RLS/defaults из snapshot,
не меняя учебные записи. Он намеренно отказывается работать без отдельного
opt-in внутри транзакции. Такой откат **возвращает уязвимость**; применять только
после отдельного одобрения при закрытом внешнем Data API/окне обслуживания.
Snapshot сверять и сохранять перед откатом; при потере snapshot не угадывать grants.
После новых DDL/прав сначала проверить совместимость snapshot, не запускать старый
откат автоматически. После устранения причины заново применить hardening и audit.

## Проверки и ограничения

| Проверка | Результат |
| --- | --- |
| PostgreSQL 17.10, сервер postgres NOSUPERUSER/BYPASSRLS | PASS: воспроизведена исходная открытость, затем 400 отказов SELECT/INSERT/UPDATE/DELETE/TRUNCATE для двух API-ролей на 40 таблицах |
| Серверные роли postgres/service_role | PASS: реальные SELECT/INSERT/UPDATE/DELETE после миграции |
| RLS при случайном возвращении grants | PASS: SELECT без строк, UPDATE/DELETE без изменений, INSERT запрещён |
| HTTP → защищённый PostgreSQL | PASS: подписанный Telegram fixture, session/refresh/logout, карточки, progress, viewer/editor, offline push/retry/pull, Knowledge attempts/mastery/dedup |
| Миграция/откат | PASS: отказ при неизвестном RPC без частичного изменения, повтор миграции, точное восстановление ACL/RLS/defaults, повтор hardening |
| Новые объекты / drift | PASS: новые table/sequence/RPC закрыты; gate обнаруживает отсутствие RLS, column grants и permissive policy |
| Incident containment | PASS: без opt-in запрещён; после opt-in sessions/codes/challenges отозваны без удаления evidence |
| Полный isolated backend | PASS: 262 теста в 20 suites |
| Browser auth lifecycle | PASS: 5 сценариев с перехваченными API |
| Browser critical suite | 34/40 PASS; 5 падений CardEditor (устаревшие selectors/предупреждение raw) и 1 offline CRUD (ожидаемый flag=3, получен 0 после редактирования). Проверенные test/компонент/transport/offline файлы совпадают с HEAD; browser fixtures не вызывают live backend |
| Frontend unit / service tests | 430/430 PASS; отдельные regression scripts 45/46 PASS |
| Оставшееся frontend-падение | `auth_store_regression.mjs`: `unconfigured provider failure presents clear message without generic fallback`; старый generic текст вместо сообщения provider_not_configured. Test и `useAuthStore.js` совпадают с HEAD, не изменялись этой задачей |
| ESLint / Vite build | PASS; сборка с существующими предупреждениями о chunks/dynamic imports |
| Python compile / diff | PASS для изменённых файлов; прежний trailing blank line в пользовательском `lerne-card-prompts-v2/AGENTS.md` не изменён |
| Production read-only gate, 20 октября до применения | FAIL: 15 RLS disabled, 130 object privilege, 676 effective column privilege, 2 schema access, 24 creator default, 1 implicit function default; column findings здесь включают table-level grants |
| Production read-only gate, 21 октября после применения | PASS: 0 нарушений; 312 проверок отказа публичным ролям и 78 серверных чтений |

Полные frontend/browser gates остаются красными из-за указанных падений вне изменённых путей;
это не объявляется успешным полным `npm run check`. GitHub CI ещё не запускался.
Локальные тесты используют только
синтетические аккаунты/подписанный Telegram fixture, без обращения к провайдерам.
Production миграция выполнена 21 октября; отзыв сессий, ротация и deployment НЕ выполнялись.
Полноценный browser → live FastAPI → production DB smoke не выполнялся.
Отдельный least-privilege SQL login вместо postgres/BYPASSRLS — дальнейшая работа:
текущая серверная роль требует безошибочных permissions на каждом API-маршруте.

Документация: [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
