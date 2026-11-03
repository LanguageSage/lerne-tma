# C2: карта владения DB-соединениями

База аудита: main `1c2512f4` (PR #13). C2a — первый небольшой PR;
это не утверждение, что весь FastAPI уже исправлен. Проверены регистрации
роутеров, определения зависимостей, async-обработчики и их DB-вызовы,
background tasks, startup и явные connect/close/initialize в `api/`.
Синтетические ASGI-проверки дополняют статический аудит; production не затрагивался.

## Карта и порядок следующих частей

| Приоритет / область | Найденный путь / проблема | Состояние |
| --- | --- | --- |
| P0 global proxy | `main.db_session_middleware` и `media.get_image` вызывали `initialize_database()` при request error: новый пул подменял proxy, пока другие потоки держали старые соединения | C2a: request-перепривязки удалены; initialization сериализована и идемпотентна, несовместимые bindings отвергаются |
| P0 вход в worker scope | `db_workers.run_db`: ошибка Peewee `_initialize_connection` после checkout не вызывает `connection_context.__exit__`, слот остаётся занят | C2a: capture конкретного DB, discard частично открытого соединения, finally close в том же worker |
| P0 cards | Пять оставшихся sync handlers `bulk_save_cards`, `delete_card`, `get_duplicates`, `reorder_cards`, `search_cards`: middleware открывал connection на loop, handler автоматически открывал другой на worker, finally закрывал только loop connection | C2a: весь cards router использует C1 scope и полностью материализует ответ в worker |
| P0 оставшийся middleware | Для непомеченных маршрутов connect/close всё ещё синхронны на loop; loop connection разделяется concurrent tasks. `call_next` retry не переисполняет consumed ASGI task; reconnect loop connection не лечит worker connection | C2b: media исключён из legacy lifecycle. После переноса остальных групп удалить DB lifecycle/retry из middleware; не просто offload отдельных connect/close |
| P1 media | Все 11 handlers: uploads, TTS, чтение файлов, backgrounds list | C2b: DB prepare/persist/materialization в workers; TTS и Storage между scopes. Ограниченный GET retry повторяет DB-фазу; upload/attach не повторяются автоматически. LOCAL files, audio redirects и image cache не требуют DB |
| P1 bot/reminders | Профиль и challenge в Telegram webhook; выбор получателя, claim и запись результата в reminder cron | C2c: отдельные DB-фазы в workers, без legacy middleware. Существующий watermark и порядок отправки сохранены |
| P1 AI/settings | Конфигурация, пользовательские промпты и флаг классификации в async AI. Синхронные settings handlers и асинхронная диагностика провайдера | C2d: DB-фазы в workers, AI I/O на исходном loop. AI и settings обходят legacy DB middleware |
| P1 sync | `routers/sync.py` (5 handlers): middleware открывал соединение на event loop, SQL открывал отдельное соединение в worker | C2e-1: все пять маршрутов выполняют SQL и собирают ответ в DB worker scope |
| P1 Knowledge / персональные данные | `knowledge.py` (6 handlers), notes (3), ratings (2), messages (5): worker SQL без общего connection scope | C2e-2 / C2e-3: отдельные изменения с проверкой Knowledge/Adaptive и персональных транзакций |
| P1 остальные sync routers | decks (21), folders (9), collaborative (11), settings (21), share (5), trash (4), lid (1), feedback (1), debug (1): кандидаты на тот же worker leak; локальные connection_context в text-update handlers уже есть | C2f: точечная проверка каждого service/serializer, включая library `lerne_db` (сейчас оба proxy указывают на один DB) |
| Auth | `auth_transaction` захватывает DB, owned flag, try/finally вокруг connect и transaction: собственные sync auth service операции закрывают соединение в своём потоке. Auth routers (15) и classic auth (8) всё ещё проходят legacy middleware; дополнительные profile/settings queries вне auth_transaction требуют scope | C2e/f: не оборачивать auth service во внешнюю transaction, не менять revocation commits |
| Уже безопасные локальные границы | C1 study/cards/diagnostics; `answer_evaluation.load_answer_context` / `configured_ai`; AI batch prepare/save; reclassification claim/finish | Сохранять; внешний legacy middleware и вызываемые async config helpers всё ещё требуют проверки |
| Startup / main | module-level DB/schema init и async lifespan вызывают sync init; `/api/init` и `/api/health` — sync без worker cleanup. health connect-success имеет HTTP 200 contract, который нельзя сломать eager connect decorator | Отдельная часть после request scopes; не переносить schema migrations в requests |

Числа выше — количество определений обработчиков (aliases PUT/PATCH и несколько
URL на один handler не считаются повторно), не число доказанных отдельных утечек.
Dead/unreachable legacy bot linking/setup branches не включены в рабочий scope.

## Пул и восстановление

В Sync auth dependency завершает собственную транзакцию до запуска handler.
`db_worker` открывает и закрывает соединение в потоке обработчика, включая
сбор snapshot и запрос `access_version` в collaborative pull. `atomic()`
в v2 и legacy push по-прежнему принадлежит сервису. Receipt v2 фиксируется
вместе с mappings, progress и review history. Одинаковый пакет возвращает
квитанцию, а конфликт получает 409 в пределах ключа пользователя. При обрыве
до commit транзакция откатывается. Потеря ответа после commit разрешается
повтором клиентского пакета с прежним request ID. Legacy push не имеет
квитанции. Sync worker не повторяет запросы автоматически, включая pull
с возможной инициализацией аккаунта.

Cloud psycopg2 pool сохраняет `max_connections=20`, `stale_timeout=300`,
fail-fast exhaustion; LOCAL и fallback драйверы остаются без изменения настройки.
Нельзя лечить exhaustion заменой глобального pool, увеличением лимита или
бесконечным retry. C1 GET retry остаётся ограниченным; общего POST retry нет.
`scripts/tests/db_workers_postgres.py` использует реальный пул с лимитом 2 в
БД, созданной disposable security harness: concurrent ASGI, разные backend PID,
исчерпание, возврат ёмкости, rollback, partial initialization и принудительный
обрыв своей PostgreSQL-сессии. Никакие реальные данные/DB не являются fixture.

## Отдельные риски, не исправляемые управлением соединениями

- `study.submit_grade` повторяет `run_grade` после `connection already closed`.
  Если progress/history уже committed, а ошибка произошла при выборе/сериализации
  следующей карточки, повтор может применить grade ещё раз. Нужен отдельный
  idempotency контракт; C2a не меняет текущую политику.
- `study.get_study_card` создаёт progress после поиска активной карточки без
  `_require_study_access`; duplicate grade делегирует update без такой проверки.
  Изменение permissions — отдельный security patch с контрактными тестами.
- Подлинные concurrent writes одного progress/card могут выявить прежние
  TOCTOU/lost-update проблемы; connection ownership не заменяет row locking.

## Проверки C2a

`test_db_workers.py`: прежние C1 cases, пять дополнительных конкурентных card
маршрутов и cleanup при partial connection initialization.
`test_db_initialization.py`: binding stability, concurrent startup, inconsistent
proxies и retry неуспешного startup. Реальный PostgreSQL suite вызывается из
существующего `test_supabase_security.py`; CI infrastructure не меняется.

## Проверки C2b

`scripts/tests/test_media_db_workers.py` проверяет реальные thread-local SQL и
production middleware: загрузку/чтение/повторы/Range/ETag, роли, отзыв доступа,
удаление и изменение карточки во время TTS, сохранение старой ссылки при ошибке,
конкурентность, cleanup и ограниченный read retry. Внешние TTS/Storage синтетические;
ORM и SQL не подменяются (кроме явной инъекции ошибки для проверки retry).
Этот же набор запускает `media_db_postgres.py` в отдельных новых схемах disposable
PostgreSQL с pool limit 2 через существующий `scripts/test_supabase_security.py`.
На исходном main набор воспроизводит SQL/lifecycle на event loop.

Сохранены права `can_edit_audio`, повторная проверка после TTS и условный UPDATE
по исходным тексту/audio path. Общая галерея backgrounds, публичное чтение media,
формат ответов и ошибки TTS не меняются. LOCAL отключает внешнюю генерацию;
успешный TTS проверяется синтетическим провайдером, а не платным/live сервисом.

C2b не завершает весь аудит: bot/reminders, AI/settings, остальные sync/auth
маршруты, startup/init/health и удаление legacy middleware остаются открытыми.
