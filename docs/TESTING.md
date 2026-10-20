# Автоматические проверки Lerne TMA

Этап 1.1 архитектурного аудита. Единая команда из корня репозитория:

```sh
npm run check
```

Команда запускает frontend, backend, критические browser-сценарии, полный ESLint
и production-сборку Vite. Все пять групп выполняются даже после ошибки; любой
ненулевой результат даёт ненулевой exit code всей команды. Ошибки не маскируются
через retries, xfail, allow-failure или baseline исключений.

## Установка и отдельные команды

Нужны Node.js 24 (как в CI), Python 3.12 (как в CI), npm и Chromium Playwright.
Локальный прогон также проверен с Python 3.14 на Windows. В активированном
виртуальном окружении Python:

```sh
npm ci
npm --prefix app ci
python -m pip install -r requirements-test.txt
npx --no-install playwright install chromium
npm run check
```

На Linux для браузера: `npx --no-install playwright install --with-deps chromium`.
Тестам не нужны `.env`, ключи провайдеров, PostgreSQL или запущенный backend.
Порт 5199 должен быть свободен: Playwright поднимает собственный Vite и не
использует случайно уже работающий сервер.

| Команда | Что запускает |
| --- | --- |
| `npm run test:frontend` | Все `app/src/{utils,design,services}/__tests__/*.test.js`, реальные auth/session/API regression-скрипты, autoplay, settings sync и scroll restoration |
| `npm run test:backend` | Явный список `SUITES` в `scripts/test_backend.py`, каждый файл в отдельном процессе |
| `python scripts/test_backend.py scripts/tests/test_critical_http.py` | Один разрешённый backend suite с той же изоляцией |
| `npm run test:browser` | Playwright project `critical`: guest-entry, card-editor, study-finished, offline |
| `npm test` | Три группы поведенческих тестов, с остановкой после первой ошибки |
| `npm --prefix app run lint` | Полный ESLint приложения |
| `npm --prefix app run build` | Сборка Vite; не проверка типов и не проверка поведения |

`npm --prefix app test` теперь включает все тесты сервисов, ранее команда
включала только knowledgeDiagnosticsService. Для существующих `mock.module`
используется встроенный Node flag `--experimental-test-module-mocks`.

## Изоляция

- Backend runner очищает унаследованные переменные, кроме системных путей,
  отключает `dotenv.load_dotenv`, startup DB и миграции до импорта моделей.
  Блокирует TCP/UDP и Peewee PostgreSQL connect, включая native driver.
  Разрешено только создание внутреннего socketpair для asyncio на Windows.
- Существующие fixtures используют SQLite в памяти или уникальные временные
  файлы. Новые HTTP-тесты используют отдельный файл в игнорируемом `scratch/`,
  удаляемый после теста. Это реальные routers/services/models без подмены auth
  dependency; `api.main` и production lifespan не запускаются.
- Разные процессы не позволяют старым `sys.modules` mocks или bindings моделей
  одного файла менять другой suite. Универсального discovery всего репозитория
  нет: некоторые старые `test_*.py` являются ручными live-скриптами.
- Node preload `scripts/tests/no-network.mjs` блокирует socket connections,
  UDP и fetch до импорта приложения. IndexedDB заменён существующим
  `fake-indexeddb`, Axios/provider transport — локальными fixtures.
- Browser project использует существующие API mocks и изолированные browser
  contexts. Общий fixture блокирует внешние запросы, WebSocket и service workers.
  Regression Vite не загружает `.env`, принудительно использует `/api`, а его
  proxy направлен на закрытый локальный порт, а не на настроенный backend.
- Защита проверяется отдельными тестами: блокировка сети/БД, работа asyncio и
  распространение ошибки единого gate. Это защита от случайного доступа тестов,
  а не sandbox для выполнения произвольного недоверенного кода.

## Что реально проверяется

| Область | Поведенческие проверки |
| --- | --- |
| Авторизация | Email/password, signed Telegram/Google fixtures, hashing, TTL, linking, rotation/replay, logout, concurrency; реальные Axios interceptors и смена аккаунта; browser guest/login |
| Серверные ошибки | `test_api_errors.py`: безопасные runtime/startup и HTTP 5xx ответы, traceback только в логах; сохранение 400/401/403/404, Bearer challenge и `provider_not_configured` (503) |
| Карточки | HTTP create/edit, запрет чужих изменений, bulk import idempotency, text-update preview/apply/rollback, parser corpus и редактор в браузере |
| Обучение | Движки SRS Python/JS и их parity, forced traversal/exclusions, валидация оценок, HTTP next/grade, completion/error/retry, упражнения и required actions |
| Прогресс | Атомарность progress/history, save-only grade, Knowledge capture/outbox, duplicate attempts, mastery/evidence, diagnostics, сохранение после browser reload |
| Sync | Серверный v2 push/pull, permissions, rollback, повтор request_id и конфликт изменённого payload; клиентские durable batches, remap ID, dirty edits во время push/pull и изоляция аккаунтов |

Новые `test_critical_http.py` проходят реальную цепочку register → Bearer → save
→ next → grade → pull; отдельно проверяют чужого пользователя, невалидные оценки,
refresh/logout и повтор HTTP sync-пакета. Backend fixtures не обходят permissions.

## CI и выпуск

`.github/workflows/checks.yml` выполняет ту же `npm run check` на push в `main`,
pull request и ручном запуске. Секреты и production services не передаются.
При ошибках сохраняются HTML-отчёт Playwright, traces и test-results на 7 дней.
Android workflow использует этот workflow через `needs: checks` до сборки APK.

Для web deployment этот workflow даёт автоматический результат проверки
коммита. В репозитории нет workflow публикации web: используется внешний Vercel
Git integration. Его ожидание обязательного CI status настраивается отдельно в
GitHub/Vercel. Настройки remote protection здесь не изменялись; наличие этого
workflow само по себе не блокирует независимый автодеплой Vercel. Перед ручным
выпуском требуется успешный `npm run check` для выпускаемого commit SHA.

## Границы покрытия

- Нет полного browser → настоящий HTTP backend → PostgreSQL E2E. Браузерный
  сценарий `two separate devices exchange real HTTP batches and progress`
  исключён из critical project **до запуска**: он требует отдельного sandbox
  на 8199, которого нет в штатном gate. Клиент и сервер v2 проверяются отдельно.
- SQLite не доказывает PostgreSQL row locks, специфичный SQL, миграции всей
  production-схемы и нагрузочную конкурентность. Это следующий уровень
  интеграционных тестов с одноразовой PostgreSQL.
- Настоящие Google/Telegram OAuth, email delivery, AI, TTS, storage/CDN,
  Web Speech API, Android/Telegram WebView и deployed lifespan не вызываются.
- Classic routes пока допускают legacy `X-User-ID`: gate проверяет текущую
  Bearer-цепочку и entity permissions, но не утверждает, что legacy fallback
  устранён. Его исправление относится к последующим этапам аудита.
- Расширенные browser specs остаются в проекте `extended` существующего
  Playwright config; их зависимости следует изучать перед ручным запуском.
  Старые live/maintenance scripts, legacy sync, админка и media не входят в gate.
- Lint/build не заменяют runtime, type checking или security audit. Процент
  покрытия не измерялся; эта матрица описывает сценарии, а не покрытие строк.

## Результат первого прогона

Локальный `npm run check`, 20.10.2026, Windows, Node 24.14 / Python 3.14:

| Группа | Результат |
| --- | --- |
| Тесты приложения | 430 / 430 PASS |
| Auth/session и дополнительные Node-регрессии | 45 PASS, 1 FAIL |
| Backend | 207 / 207 PASS, 16 suites; все 6 новых HTTP-сценариев PASS |
| Critical browser | 34 PASS, 6 FAIL, без пропущенных тестов |
| Полный ESLint | PASS |
| Production build Vite | PASS; предупреждения о размере chunks и смешанных dynamic/static imports |

Существующие падения оставлены блокирующими:

1. `scripts/tests/auth_store_regression.mjs`: сценарий
   `unconfigured provider failure presents clear message without generic fallback`
   получает общее сообщение вместо специального `provider_not_configured`.
   Он падал до изменения test commands; весь старый тест включён в gate.
2. Пять сценариев `scripts/tests/browser/card-editor.spec.cjs` не соответствуют
   текущему UI: они ищут старые `.card-editor-add summary`, название переключателя
   «Дополнительно: исходная разметка» и сообщение о сложной разметке. Это
   расхождения существующих browser assertions и текущего редактора, а не пять
   доказанных дефектов бизнес-логики. Старые assertions не отключены и не ослаблены.
3. `offline CRUD, due scheduling, restart and persistent progress` в
   `browser/offline.spec.cjs` ожидает `flag: 3`, но получает `flag: 0` после
   сохранения/обучения/reload. Требуется отдельно согласовать ожидание теста с
   текущим per-user flag контрактом; остальные поля сохраняются.

Таким образом, единый gate пока **красный** и не разрешает Android-сборку.
Бизнес-логика приложения в этапе 1.1 не изменялась. Для зелёного baseline нужны
отдельные решения по перечисленным несовпадениям, без маскировки ошибок.
Тест AI deadline переведён с гонки `.06/.1` секунд на управляемое начало retry и
отмену общего budget; проверки двух вызовов, отмены и единого timeout сохранены.

Локальные подробности: `scratch/check-final.log`, `playwright-report/index.html`,
`test-results/**/trace.zip` и error-context. Они игнорируются Git; в CI браузерные
артефакты сохраняются через upload-artifact. Сам удалённый GitHub workflow в этой
сессии не запускался: выполнена та же локальная команда, без push/deploy.
