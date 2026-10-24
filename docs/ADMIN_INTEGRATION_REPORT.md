# Интеграция TMA и независимой админки — 2026-10-24

В `codex/extract-local-admin` объединена ветка `codex/fix-offline-flag-and-harness`.
Merge commit `a0179fc4218fca1b2a50b022860bae96d5cba047` сохраняет оба исправляющих
коммита `253d080` / `7a33968` в истории. Коммит `717895b` добавляет воспроизводимый
аудит входных файлов Vercel. `main` не изменён.

Админка: `codex/standalone-admin`, controlled Core update `2eec3d3`, пакет 0.2.1,
snapshot 2 из TMA `a0179fc`. Candidate создан `tools/update_core.py` в новой review
папке. Из 39 Python-модулей и 3 JSON upstream изменился только `cards.py`:
пользовательский `progress.flag = 0` теперь имеет приоритет над legacy card flag.
Защитные адаптеры database/TLS/config/paths/media не перезаписывались.

## Совместимость

`api/admin_contract.json` и admin `core/compatibility.json` совпадают. Изменился
только source fingerprint import: `8bf92a19d30df1e8984efb123b6a6272c8a72543c7de8107d2d7845bc88b40c6`.
Эта область включает весь cards.py. Schema/permissions/cards fingerprints и все
четыре semantic versions остаются 1: схема, права и wire/import formats не менялись.

Production/LOCAL marker не обновлялся. Старый exact marker продолжает блокировать
запись до отдельного DBA review/register. То же относится к versioned jobs и
checkpoint с прежним contract; автоматического переписывания или resume нет.
Legacy unversioned v1 checkpoint поддерживается и читается без изменения байтов.

## Проверки

| Проверка | Результат |
| --- | --- |
| Объединённая TMA: полный `npm run check` | PASS: frontend 452 + 55; backend 29 suites / 356 cases; browser 43; lint; build |
| Чистый TMA checkout вне обоих проектов | npm ci/build PASS; contract/deployment input audits PASS; contract + LOCAL boundary + critical HTTP: 11 tests PASS |
| Чистый admin checkout вне TMA, новый venv | обычный wheel 0.2.1 установлен с requirements.lock; 146 isolated Python tests PASS |
| Новый native PostgreSQL cluster | 24/24 PASS: оба направления transfer, media, rollback, receipts, schema/version/source drift gates |
| Admin browser/passport | 19/19 PASS: импорт, media, preview/confirmation, errors/retry, background UI, passport |
| Автономная установка admin | isolated Python из постороннего cwd, PATH без Git, нет внешних api / lerne-tma-core: PASS |
| Обычный admin CLI / HTTP | UI и users HTTP 200 на отдельном порту, свежий временный state, существующая LOCAL БД принудительно READ ONLY |
| Существующие данные | before/after: schema, marker, row counts восьми таблиц, config/checkpoint hashes совпадают; probes READ ONLY |
| Текущие Git trees | проверенные secret signatures и tracked private DB/config/checkpoint отсутствуют |

36 прежних падений harness были вызваны отсутствующими импортированными зависимостями
VM fixtures. Assertions сохранены. Дополнительно исправлены подтверждённые гонки
auth после logout/account switching. Offline flag сохраняется атомарно, переживает
grade/edit/reload, sync retry/remap и stale pull без сброса progress.

## Vercel и независимость

`python scripts/verify_deployment_inputs.py` проверяет tracked inputs по правилам
`.vercelignore`, оба entry points и 23 обязательных ресурса среди 411 source files.
Сохраняются bundeslaender.js, все JSON-словари, locale/messages и admin contract.
Tools/admin, scripts, local runtime, secrets, checkpoints и базы исключены.
Проверена установка/build из чистого checkout; remote function bundle не создавался.

Runtime/install/test не требуют Git или исходников соседнего проекта. Общая
граница — schema/permissions/formats и explicit compatibility metadata, плюс
необязательная LOCAL HTTP-ссылка на админку. Каждый проект владеет своей реализацией;
будущие Core updates выполняются отдельно через candidate/review/tests/commit.

## Готовность и ограничения

- Оба исходных дерева технически готовы к отдельным репозиториям GitHub; общий
  TMA gate теперь зелёный. Публикация полной истории TMA публично требует отдельной
  очистки либо clean initial snapshot: в старых commits остаются admin config,
  checkpoint и тестовые SQLite. История не переписывалась. В истории admin таких
  путей не обнаружено; signature scan не гарантирует отсутствие custom secrets.
- Для реальных admin writes/resume нужен отдельный DBA review и регистрация
  актуального marker/fingerprint. Автоматического изменения metadata/migrations нет.
- Проверенная среда — Windows, Python 3.14, Node 24. Удалённый Linux CI и Vercel
  runtime не запускались. Остались прежние Vite chunk/dynamic import warnings.
- Реальные Supabase writes, paid AI/TTS и Storage uploads не выполнялись; в тестах
  использованы disposable PostgreSQL/SQLite и simulated external adapters.

Push, merge в main и Production deployment не выполнялись.
