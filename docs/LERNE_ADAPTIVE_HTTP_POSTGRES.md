# Lerne Adaptive: HTTP / PostgreSQL проверка первого патча

Дата: 30.10.2026. Оценка сложности: **8/10**.
Результат: все шесть запрошенных сценариев прошли в одноразовом native
PostgreSQL **17.11** через настоящие TCP HTTP-запросы. Подтверждённых дефектов
прикладного кода в этом прогоне не обнаружено; добавлен воспроизводимый стенд,
исходный технический патч не расширялся.

## Настоящий HTTP и PostgreSQL

| Сценарий | Фактически выполнено | Результат |
| --- | --- | --- |
| Обычная карточка с KI → grade → Attempt → Mastery | Настоящий email/password signup и Bearer; HTTP создание колоды/карточки; Chromium запускает `useStudyNavigation` и `useStudySession`; реальные Axios, KI endpoint, Dexie capture, Knowledge Sync и diagnostics endpoint | PASS. После подтверждённого grade создаётся один Attempt, счётчик evidence увеличивается на один, diagnostics подтверждает совпадение проекции с raw history |
| Offline → reconnect | Снимок карточек получен реальным entity sync; Chromium `setOffline(true)`; grade создаёт локальные progress/review/Attempt. В этот момент строки сервера не меняются, неудачная отправка сохраняет очередь. IndexedDB закрывается/открывается; сеть восстанавливается; `/sync/v2/push`, pull и Knowledge sync отправляют сохранённое | PASS. Review и Attempt на сервере прибавляются ровно по одному; очередь очищается только после подтверждения. Повтор исходного события получает duplicate |
| Повторная и конкурентная отправка | Восемь HTTP-запросов одного события. Тест удерживает настоящий `pg_advisory_xact_lock`, наблюдает несколько ожидающих запросов в `pg_stat_activity`, затем отпускает lock | PASS: **1 created, 7 duplicate**, одна raw-запись для события и один вклад в Mastery. Изменённый payload с тем же ID получает event_conflict |
| Подмена card/KI/review | Девять событий: чужая/несуществующая/отсутствующая карточка; secondary/чужой для карточки/несуществующий KI; review другого пользователя/другой своей карточки/несуществующий review. Дополнительно чужая колода, anonymous и только X-User-ID | PASS. Все девять событий rejected с ожидаемыми кодами; проверки HTTP прав дают 403/401. Attempts и Mastery не меняются |
| Remapping / unmapping | Primary изменён и удалён SQL-операциями **только над синтетической fixture**. Ответ настоящего KI endpoint обновляет реальный Dexie-кэш. Проверяется primary lookup, capture без mapping и отправка нового события со старым KI | PASS. Старый primary исчезает, после unmapping capture не создаёт Attempt, сервер отклоняет устаревшую связь. Идентичный повтор ранее принятого события остаётся duplicate |
| Смена аккаунта | Запрос A удержан реальным PG lock после проверки Bearer. Реальный logout; закрытие Dexie A; переключение auth helpers на настоящую сессию B; в B есть pending-событие с тем же ID. Позднее подтверждение A отпускается; затем B синхронизирует свою очередь; реальный повторный login A и stale recovery повторяют исходное событие | PASS. Очередь B не затрагивается поздним ответом A. В PostgreSQL по одному событию на пользователя, обе проекции соответствуют их raw history; replay A не увеличивает Mastery |

На первом HTTP grade дополнительно проверены конкретные значения неизменённого
mastery-v1: `positive_evidence=0.375`, `evidence_mass=0.5`, `proficiency=0.55`.
После конкурентного события positive evidence равен `0.75`, а счётчик событий —
двум, включая исходный grade. После конфликтного payload эти значения сохранены.

## Что осталось изолированным

Дополнительно выполнены **13** Node-тестов `knowledgeFlow.test.js` с
fake-indexeddb и mock API, **21** серверный тест `test_knowledge_sync.py` и
**20** тестов `test_knowledge_mastery.py` на SQLite. Все прошли.

Ошибочные/неполные ответы transport, malformed KI response, rollback локальной
транзакции кэша, совместимость старого ответа без `card_ids`, отсутствующий KI в
кэше и дополнительные версии/некорректные поля evidence проверены этим
изолированным набором. Их прохождение **не считается** доказательством настоящего
HTTP/PostgreSQL. Повторное выполнение всей прежней тестовой матрицы не заявляется.

## Стенд и воспроизведение

Из корня, при наличии native PostgreSQL binaries, Python-зависимостей проекта,
установленных npm-зависимостей и Chromium Playwright:

```powershell
python scripts/tests/run_knowledge_http_postgres.py --bin-dir C:/121/Lerne_projekt/tools/pgsql/bin
```

- Runner очищает унаследованное окружение, отключает dotenv, не читает LOCAL
  config и создаёт новый кластер/БД на свободном `127.0.0.1` порту. Бинарные
  файлы PostgreSQL используются из указанного каталога; существующий PGDATA и
  сервер на 55432 не участвуют.
- Schema fixture создаётся из настоящих Peewee models и существующего partial
  unique primary index. Цепочка production migrations не вызывается.
- Uvicorn обслуживает реальные FastAPI routers для auth, decks/cards, study,
  sync, Knowledge, settings и notes. Нет dependency overrides, TestClient,
  замены SQL, permissions, scoring, advisory locks или auth/HTTP transport.
- Отдельный Vite проксирует `/api` только на этот API. Chromium использует
  настоящий IndexedDB; внешние запросы браузера блокируются. Python допускает
  только loopback networking. Секреты внешних сервисов в процессы не передаются.
- Данные синтетические, объём ограничен несколькими карточками и событиями.
  KI fixture и её remapping/unmapping создаются напрямую в одноразовой БД,
  поскольку отдельного authoring endpoint для этого контрактного теста нет.
- В `finally` останавливаются созданные HTTP/Vite процессы и кластер,
  удаляются только проверенный PGDATA этого запуска и файл синтетических
  auth tokens. Логи/результаты остаются в игнорируемом `local/test-data/`.

Успешный прогон:
`local/test-data/knowledge-postgres/241a3b820b5d486b94465943e04f2a07/results.json`.
Рядом: `browser-results.json`, `browser.log`, `api.log`, `postgres.log`,
`initdb.log`, `pg_ctl.log`, `vite.log`. В итоговом JSON:
`status=PASS`, `critical_mocks=false`, `cluster_stopped_and_removed=true`.

Подготовительные неуспешные запуски стенда в соседних каталогах не засчитаны как
PASS: исправлены кеширование snapshot статистики PG при наблюдении lock,
допустимые отрицательные account IDs, импорт React DOM, выбор новой карточки
после SRS планирования серверных fixtures и штатный logout HTTP 204.
Эти исправления затронули только тестовый стенд.

## Границы доказательств

- Проверена композиция настоящих routers на Uvicorn; production `api.main`
  startup/lifespan, его middleware и полный migration upgrade не запускались.
  Начальная попытка model initializer без cloud URL оставляет в `api.log`
  сообщение `SUPABASE_DB_URL is not set`; Peewee proxies заранее привязаны к
  одноразовой PostgreSQL, что проверяется HTTP-записями и прямыми SQL чтениями.
- Браузер вызывает настоящие study hooks в минимальном harness. Полные экраны
  входа/выхода, визуальные click-сценарии и `useAuthStore` UI lifecycle здесь не
  проверялись; auth endpoints, auth helpers, закрытие БД и границы очередей —
  проверялись.
- Восстановление после длительного закрытия всей программы, нескольких вкладок,
  Android/Telegram WebView/native runtime, нескольких API-инстансов и нагрузочная
  конкурентность не проверялись. Восемь конкурентных HTTP отправок не являются
  нагрузочным тестом.
- Не проверялись внешние OAuth, AI, TTS, storage/CDN и production. Правильность
  самого клиентского ответа не становится серверно доказанной из-за проверки
  его происхождения; scoring mastery-v1 сохранён.

Production migrations, деплой, массовая запись, изменение карточек пользователя,
SRS, формата V2 и алгоритма Mastery не выполнялись. Следующий практический этап —
native/offline и несколько вкладок, затем согласование стабильных skill keys и
небольшого каталога навыков для пилота Adaptive.
