# Game Test: диагностика авторизации

17 октября 2026. Ветка `game-mode`. Проверен только сайт
`https://lerne-game-test.vercel.app`, Vercel `lerne-game-test`,
Supabase `rkkviifehykdeugovlgp`. Работающий деплой: `dpl_tZUYh5zu6zfDNgr98mqyVtoAFf6P`,
коммит `1aa78085a89650f801a187fa174a22eddc89ac4f`, статус READY.

## Причины

1. Email/password аккаунт создаётся без имени и username. API выдаёт действующую
   сессию и `is_guest=false`, но `useAppInitialization` при слиянии `/init`,
   `/auth/sync` и кэша принудительно ставил `is_guest=true`, если имя отсутствует.
   После перезагрузки браузер снова показывал Guest Mode, предложение войти и
   гостевые настройки профиля. Это воспроизведено на живом сайте и в локальном
   браузерном тесте. PostgreSQL при этом сохранял `is_guest=false`.
2. Telegram и Google OAuth в тестовом Vercel не настроены: отсутствуют
   `BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` и три `GOOGLE_OAUTH_*` переменные.
   `GOOGLE_API_KEY` для AI не является OAuth-конфигурацией.
3. Auth v2 формировал `503 provider_not_configured`, но обработчик в `api/index.py`
   заменял его на `service_unavailable`. Существующая клиентская подсказка
   использовать email/password поэтому не срабатывала.

## Исправлено локально

- Три слияния профиля сохраняют серверный `is_guest`, независимо от имени.
- Vercel entrypoint сохраняет только известный публичный код
  `503 provider_not_configured`; прочие подробности 5xx остаются скрыты.
- Добавлены проверки реального entrypoint и повторной загрузки аккаунта без имени.
  Оба дефекта воспроизведены тестами до исправления и отсутствуют после него.
- Проверка отсутствующих провайдеров перенесена с отдельного router на entrypoint.
  Существующий тест placeholder DSN теперь загружает реальный initializer отдельно
  от mock из изолированного test runner.

Новых механизмов авторизации, зависимостей, обходов или миграций нет.

## Результаты

На работающем сервере проверены два синтетических аккаунта с адресами
`example.invalid`; пользовательские учётные данные не использовались:

- Health и соединение с БД: 200.
- Регистрация, вход, `/me`, identities, password-settings и refresh: 200.
- Повторная регистрация: 409 `email_unavailable`.
- Неверный пароль: 401 `invalid_credentials`.
- Logout: 204; запрос с отозванной сессией: 401 `invalid_session`.
- Регистрация через настоящий UI успешна; после reload воспроизведён ложный Guest Mode.
- SQL подтвердил сохранённые аккаунты, password/session/token записи и серверный
  `is_guest=false`. Все созданные диагностические сессии отозваны; сами тестовые
  записи оставлены. Данные не удалялись.
- Runtime logs прочитаны через Vercel CLI; в выборках error за 48 часов до проверок
  и за последний час после них записей не найдено. Warning подтверждает отсутствие
  Telegram/Google конфигурации. Это не гарантия отсутствия ошибок вне выборки.

Локальные проверки после исправления:

- `python scripts/test_game_mvp3.py tests.test_game_test_preparation scripts.tests.test_auth_foundation`: 49 PASS.
- `auth_store_regression.mjs`, `auth_session_regression.mjs`, `test_api_silent_refresh.mjs`: 21 PASS.
- `guest-entry.spec.cjs`: 4 PASS; `game-auth.spec.cjs`: 8 PASS.
- Новый сценарий аккаунта без имени проверен после двух reload, с кэшем, при 375/1280 px.
  Существующий guest-сценарий проверяет RU/EN/UK и 320/375/430/1280 px.
- ESLint изменённого hook, Python compilation и целевой `git diff --check`: PASS.

Браузерные проверки исправленного кода используют локальный frontend и
изолированные ответы API. Живой сайт проверен до исправления; публикация не выполнялась.

## Публикация

Для применения исправлений нужен разрешённый деплой тестового проекта.
Деплой не выполнялся. Соседние незакоммиченные изменения сохранены.
Telegram/Google останутся недоступны до настройки отдельных тестовых credentials
по `deploy_tool/SETUP.md` в соседнем проекте; email/password уже работает.
Production не запрашивался и не изменялся. Секреты не выводились.
