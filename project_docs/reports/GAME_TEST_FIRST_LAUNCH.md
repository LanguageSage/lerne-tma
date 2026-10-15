# Lerne Game Test — подготовка первого запуска

Дата: 15 октября 2026. Ветка: `game-mode`, исходный HEAD `b9a9499`.
**Первый публичный деплой не выполнен. Game Test пока не готов к нажатию Deploy.**

## Подготовлено

- Supabase `lerne-game-test`, ref `rkkviifehykdeugovlgp`, `eu-north-1`, ACTIVE_HEALTHY.
- Vercel `lerne-game-test`, ID `prj_TuDiTgRLfD4AoVxDbPANji70TRVA`, team
  `team_wjzyWOEAmIkLhTGAvbxF3e4c`. Пустой проект на Hobby, Git integration отсутствует,
  дополнительное платное оборудование/сервисы не включались.
- Домен `https://lerne-game-test.vercel.app` привязан к отдельному проекту. Его
  Production environment используется для постоянной тестовой версии. Деплоев нет.
- Deployment Protection тестового проекта не требует Vercel login. Lerne Auth сохраняется.
- Заполнен Game Test профиль `deploy_tool/config.json`; исходная `.vercel` связана с `tma`.
- Безопасные env и URL заданы только в тестовом проекте. Секреты Production не копировались.

## База и миграции

Только в **rkkviifehykdeugovlgp** применена Supabase migration
`lerne_game_test_canonical_bootstrap`. Перед записью ID и имя сверены программно
через Management API. До применения public-схема была пустой.

Использован `scripts/prepare_game_test.py`: генерация PostgreSQL DDL из существующих
35 ORM-моделей, затем строгий replay списка legacy `api/migrations.py` с
`ADD COLUMN IF NOT EXISTS` для уже представленных моделью полей. Стандартный
best-effort runner не использовался: он записывает в историю даже ошибочные SQL.
Auth 76–79, Knowledge 82, Game 87 и MVP3 88 представлены каноническими моделями,
их маркеры добавлены в свежую пустую схему. Отдельные Python upgrade/backfill runners
на удалённой БД не запускались. Production-схема/пользователи не копировались.

В `tma_migration_history` находятся все ID **1–88**. Всего **36 таблиц** вместе
с историей, **131 индекс**, **19 внешних ключей**, **36 первичных ключей**,
**6 CHECK constraints**. Программно сверены все поля/PK/unique indexes/FK
35 канонических моделей; PostgreSQL не показывает invalid constraints/indexes.
На всех 36 public-таблицах включён RLS, права PUBLIC/anon/authenticated отозваны,
публичных policies нет. Это соответствует собственной серверной авторизации Lerne.

Supabase security advisor показывает только информационный `rls_enabled_no_policy`:
таблицы закрыты для Data API намеренно; FastAPI подключается привилегированным
PostgreSQL пользователем и проверяет владельца. Не добавлять фиктивные `auth.uid()`
policies и не выключать RLS. [Пояснение advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
[модель доступа Supabase](https://supabase.com/docs/guides/database/secure-data).

Синтетический storage probe в PostgreSQL создал два временных аккаунта, Argon2
password hashes, session/token hash и завершённый диалог Frau Müller с learning_result.
Проверены записи и выборка с owner predicate. **Все записи откачены**, после проверки
users/passwords/sessions/attempts = 0. Это проверка хранения в PostgreSQL;
полная регистрация и серверные permissions проверялись отдельно на SQLite fixtures.
Живой HTTP backend с этой PostgreSQL ещё не запускался: нет явного тестового DSN.

Системные сценарии/NPC/книги читаются из `api/game_config/*.json`; обязательных
пользовательских seed-данных нет. AI provider/model пока не настроены. Bucket `audio`
пока отсутствует; Storage metadata напрямую через SQL не изменялась.

Bootstrap отказывается от другого ref и непустой public-схемы. **Повторно применять
его к подготовленной БД не надо.** Существующие upgrades — отдельные операции с явно
проверенным тестовым DSN; историю миграций для повторного запуска не удалять.

## Исправления

- `create_all_tables()` учитывает явный `RUN_MIGRATIONS=false` даже при вызове из
  `api/main.py`; Vercel cold start не запускает DDL.
- Runtime Game Test проверяет точный Supabase ref/URL до создания DB driver;
  неизвестная или Production-конфигурация блокируется. DSN credentials URL-decode.
- В Game Test общие Classic routes требуют тот же Auth v2 Bearer, что и Game.
  Клиентский `X-User-ID` сам по себе не авторизует доступ к аккаунтам.
- Публичные startup/runtime/HTTP 5xx ответы не возвращают exception text/traceback;
  TTS сообщает стабильный код ошибки. Диагностика остаётся в серверных логах.
- Относительное аудио Game Test идёт через `/api/media/audio` тестового сайта,
  благодаря `VITE_AUDIO_BASE_URL`; исправлена зависимость от Production CDN.
- Deploy tool принудительно задаёт `LERNE_DEPLOYMENT=game-test`, отключает startup
  migrations и MVP3 pilot. `PUBLIC_API_BASE_URL` передаётся как origin без `/api`,
  согласно существующему Telegram setup contract.
- Два browser assertions приведены к текущему начальному заголовку сцены
  Frau Müller · Kennenlernen; проверки ожидания auth и отсутствия ранних запросов сохранены.

Auth остаётся собственным: accounts/identities/sessions/token hashes, Argon2id,
refresh/revoke. Supabase Auth не подключался. Таблицы MVP3 подготовлены, collector
не включён: он предназначен для одного пилотного аккаунта вне production env.
Результаты знакомства сохраняются в `tma_game_attempt.scene_state.learning_result`
без включения MVP3. Новых игровых функций не добавлялось.

## Проверки

- Изолированные Auth v2, Game/neighbor, MVP3 и answer evaluation: **194 PASS**;
  отдельные проверки защит подготовки: **9 PASS**. Сеть блокировалась тестовым entry point,
  реальные AI/TTS/пользовательские аккаунты не использовались.
- Deploy tool: **28 PASS**, fake Vercel API, временные Git fixtures. В том числе
  `--prod` только с Game Test project ID, стабильный alias при повторном deploy,
  отдельная временная `.vercel`, блокировка чужой ветки/DB, скрытие секретов.
- Python compilation затронутых файлов — PASS. Полный frontend lint — PASS;
  повторный targeted lint после изменения `media.js` — PASS.
- Frontend build с Game Test API/audio flags — PASS, только обычные bundle warnings.
- Две новые unit-проверки аудиопутей — PASS. Полный Node suite: **266 PASS, 1 FAIL**.
  Имеющийся `deckUtils.test.js` импортирует отсутствующий export
  `getFolderContentStats`. Тест и реализация не менялись и совпадают с исходным HEAD;
  полный suite не считается зелёным. Постороннее исправление не выполнялось.
- Browser suite: **33 PASS** (`game-mode.spec.cjs` и `game-auth.spec.cjs`).
  Fixtures полностью перехватывают API/providers; STT/audio эмулируются.
- Схема удалённой тестовой PostgreSQL, RLS/grants, индексы/constraints и полный
  rollback синтетических записей проверены отдельно.

Скриншоты сценария просмотрены при 320 и 1280px; browser assertions также проверяют
375/430/768px, RU/EN/UK, завершение/ошибки/голосовые controls. Это Chromium desktop
с эмуляцией размеров. Реальный телефон, физический микрофон, браузерный STT,
автозапуск звука, живые AI/TTS и OAuth после публикации пока не проверены.

## Что осталось владельцу

1. В Vercel **lerne-game-test → Production env** добавить Sensitive
   `SUPABASE_DB_URL` и `SUPABASE_KEY` только тестовой Supabase.
2. Создать Storage bucket `audio` и проверить серверный upload/download.
3. Настроить отдельный тестовый AI key/лимиты и несекретные `AI_PROVIDER`/
   `DEFAULT_MODEL` в тестовой `tmasetting` — без модели env key не включает диалог.
4. Для проверки backend до публикации предоставить явный тестовый DSN локально
   (например, игнорируемый `scratch/game-test.env`, `GAME_TEST_DATABASE_URL`).
5. По необходимости настроить Google callback/consent testers или отдельного
   Telegram-бота; точные действия указаны в `deploy_tool/SETUP.md`.
6. Сохранить подготовленные изменения коммитом в `game-mode`: deploy tool берёт
   коммит HEAD, незакоммиченную версию не отправляет. Commit/push не выполнялись.
7. После живых проверок дать отдельное разрешение на первый публичный deploy.
   После него проверить двух тестировщиков и голос на настоящем телефоне.

Сейчас **Game Test → Deploy нажимать рано**. Схема БД подготовлена, Vercel-проект
подготовлен, но credentials/AI/Storage и живые проверки ещё не завершены.

## Production

Основной Supabase `wdopyuulhiykrextyvnt` не запрашивался и не изменялся. Основной
Vercel project `prj_7klMipRiXol3KAvxDElU9LEKOLv7`, deployment
`dpl_CBHyigqSCaNd986gCjc4pQaLhQhW`, alias `tma-amber.vercel.app` проверялись только
через metadata API; backend Production не вызывался. Состояние до/после сверено.
Локальная `.vercel/project.json` SHA256:
`F1A22FF5E7624FD0B52CCED917C30EDDA8C1801E01B0D34BF94ADBDADF44D8D0`.

Vercel-проекты и методы подготовки:
[Project CLI](https://vercel.com/docs/cli/project),
[Create project API](https://vercel.com/docs/rest-api/projects/create-a-new-project).
