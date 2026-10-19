# Auth: аккаунты, вход и привязки

## Scope

Telegram/Google/email-password, challenge/exchange, привязка identity, refresh, logout и изоляция аккаунтов.
Доступ к колоде/карточке — серверные permissions в [decks](decks.md), [cards](cards.md) и sync services.

## Primary entry points

| Задача | Файлы от корня репозитория |
| --- | --- |
| Вход / профиль | `app/src/components/modals/AuthRequiredModal.jsx`, `app/src/components/settings/ProfileTab.jsx` |
| Клиентский lifecycle | `app/src/store/useAuthStore.js`, `app/src/utils/auth.js`, `app/src/utils/platform.js` |
| Bearer / 401 refresh | `app/src/services/api.js` |
| Смена аккаунта | `app/src/services/localDb.js`, `app/src/store/useDeckStore.js`, `app/src/hooks/useAppInitialization.js` |
| HTTP / Telegram bot | `api/routers/auth_v2.py`, `api/routers/bot.py`, `api/dependencies/auth.py` |
| Auth domain | `api/auth/providers.py`, `api/auth/service.py`, `api/auth/transactions.py`, `api/auth/dependencies.py` |
| Модели / миграции / deployment | `api/models.py`, `api/migrations.py`, `api/auth/DEPLOYMENT.md` |

## Data flow

1. UI/useAuthStore → прямой provider login либо challenge → provider proof → exchange через `/auth/v2`.
2. `providers.py` проверяет identity proof; `service.py` разрешает аккаунт/привязку и создаёт session/tokens в транзакции.
3. Клиент сохраняет session через utils/auth; API-клиент прикладывает Bearer token.
4. При 401 API-клиент выполняет один refresh и переигрывает ожидающие запросы из очереди.
5. Password register/login/link/set используют отдельные password settings и правила свежести social session.
6. При смене аккаунта очищается представление store и выбирается его Dexie БД; локальные очереди сохраняются у владельца.

## Вход из браузера без сохранённой сессии

- `UserBadge.jsx` показывает кнопку входа и баннер при отсутствии профиля; оба открывают существующее окно auth v2.
- `DeckGrid.jsx` предлагает войти, если в браузере нет профиля и колод. Для определённого аккаунта без колод сохраняется действие создания колоды.
- Ответ 401 в новом браузере не должен означать, что в аккаунте нет колод. Вход продолжает использовать `useAuthStore.finishLogin`, который восстанавливает профиль и загружает колоды/папки.
- `useAppInitialization` сохраняет серверный `is_guest` при загрузке cache, `/init` и `/auth/sync`. Отсутствие имени или username у email/password аккаунта не делает его гостем; проверка повторной загрузки находится в `scripts/tests/browser/guest-entry.spec.cjs`.

## Source of truth

- `api/auth/service.py` владеет auth-транзакциями, TTL, token rotation, password throttling и отзывом сессий.
- `api/models.py`: `TMAAuthAccount`, `TMAAuthIdentity`, `TMAAuthSession`, `TMAAuthToken`, `TMAAuthProof`, `TMAAuthChallenge`, `TMAAuthPassword`, `TMAAuthPasswordThrottle`.
- Текущий `get_user_id` в `api/dependencies/auth.py` пробует Bearer, затем допускает legacy `X-User-ID`; строгая Bearer-зависимость находится в `api/auth/dependencies.py`. Проверяйте, какую зависимость использует конкретный route.
- Credentials/session storage принадлежит utils/auth и useAuthStore; profile fields и password settings имеют отдельные потоки.
- Password hashing использует Argon2id; восстановление через привязанный провайдер/профиль описано в [AUTH_V2](../../project_docs/ARCHITECTURE/AUTH_V2.md).
- Миграции схемы — `api/migrations.py`; детали текущего rollout/переменных — `api/auth/DEPLOYMENT.md`.
- Старый router `api/routers/auth.py` существует, но действующий вход описан через auth v2.

## Common symptoms

| Симптом | Первый участок проверки |
| --- | --- |
| Telegram / Android вход не проходит | platform/auth store → auth_v2 / bot → proof, TTL/challenge |
| Google callback / exchange не завершает вход | auth_v2 callbacks, providers.py и challenge state |
| Параллельные 401 вызывают logout или несколько refresh | api.js refresh queue / session token rotation |
| Identity привязана не к тому аккаунту | link purpose + access token + transactions/service |
| Пароль не меняется после provider login | Password settings, свежесть session/provenance и set_email_password |
| После logout/смены аккаунта видны старые колоды | Store reset и выбор localDb; см. [sync](sync.md) |
| Вход успешен, запрос к карточке запрещён | Permissions сущности, а не повторная аутентификация |

## Search anchors

```sh
rg -n 'isRefreshing|failedQueue|refresh_token|_retry' app/src/services/api.js
rg -n 'verify_telegram_init_data|verify_google_id_token' api/auth/providers.py
rg -n 'refresh_session|link_verified|set_email_password|create_challenge|exchange_challenge' api/auth/service.py api/routers/auth_v2.py
```

## Relevant tests

- Foundation: `scripts/tests/test_auth_foundation.py`.
- Client state: `scripts/tests/auth_store_regression.mjs`.
- Новый браузер, локализованные адаптивные элементы входа и загрузка колод после входа (изолированные ответы API): `scripts/tests/browser/guest-entry.spec.cjs`.
- Refresh queue: `scripts/tests/test_api_silent_refresh.mjs`.
Перед integration checks сверяйте fixtures/DB configuration; deployment checks описаны отдельно.

## Related docs

- [AUTH_V2](../../project_docs/ARCHITECTURE/AUTH_V2.md), [Deployment](../../api/auth/DEPLOYMENT.md).
- [Auth security review](../../project_docs/reports/AUTH_SECURITY_REVIEW.md) — отчёт; текущие проверки находятся в коде.
- [Sync](sync.md), [Decks](decks.md), [Knowledge lifecycle](knowledge.md).

## Isolated Game Test

With `LERNE_DEPLOYMENT=game-test`, `api/dependencies/auth.py:get_user_id` delegates to strict Auth v2 Bearer authentication; no X-User-ID fallback is accepted for Classic routes. Existing Game routes already use strict auth and owner predicates. Supabase Auth is not used. See `project_docs/reports/GAME_TEST_FIRST_LAUNCH.md` and `../deploy_tool/SETUP.md` (relative to the repository root) for isolated database, credentials and provider setup.

Unconfigured Telegram/Google challenges return HTTP 503 with the public code
`provider_not_configured`. `api/index.py` preserves this code through the Vercel
exception handler so `useAuthStore` can suggest email/password; other HTTP 5xx
details remain redacted. The entrypoint contract is covered by
`tests/test_game_test_preparation.py:PublicErrorTests` (run through
`python scripts/test_game_mvp3.py tests.test_game_test_preparation`).

## Lerne SSO (Production → Game Test)

- Провайдер `lerne` переиспользует `TMAAuthChallenge`, `TMAAuthIdentity`,
  `TMAAuthProof` и обычные локальные Auth v2 sessions/tokens. Subject — точный
  issuer origin + canonical основной account ID; email не объединяет аккаунты.
- `api/auth/lerne_sso.py`: Ed25519-подтверждение на 60 секунд, привязанное к
  challenge ID/nonce. Только issuer подписывает после строгой основной Bearer-сессии;
  client проверяет public key и расходует proof/challenge атомарно в `service.py`.
- `POST /auth/v2/lerne/confirm`, `GET /auth/v2/lerne/config`; существующий
  challenge/exchange принимает provider=`lerne` и optional assertion.
- `app/src/components/auth/LerneSignIn.jsx` — явное подтверждение `/auth/lerne`
  в основной Lerne с обычным окном входа. `app/public/lerne-sso-callback.html`/`.js`
  удаляют fragment до загрузки приложения и сохраняют его только для исходной
  вкладки. `useAuthStore` сохраняет pending/возобновляет exchange после reload.
- Закрытый ключ и рабочие токены не передаются Game Test. Каждая версия хранит
  данные/сессии в своей БД; роль client требует `LERNE_DEPLOYMENT=game-test`.
- Миграция 89 (`api/auth/sso_migration.py`, `scripts/migrate_lerne_sso.py`) только
  для Game Test, явно по pinned DSN; на startup не запускается. Production issuer
  использует существующую схему. Настройка/rollout: [LERNE_SSO](../../api/auth/LERNE_SSO.md).
- Проверки: `tests/test_lerne_sso.py` (две DB, подписи, replay/binding/rollback/
  совместимость/миграция), `auth_store_regression.mjs` и `lerne-sso.spec.cjs`
  (реальные локальные backend, две browser origins, consent/reload/repeat/cancel).
- `/api/init` возвращает сохранённый `TMAUser.is_guest` независимо от наличия
  имени/username: аккаунты email и Lerne SSO могут не иметь отображаемого имени.
  Регрессия проверяет реальный handler с локальной БД и новым SSO аккаунтом.
