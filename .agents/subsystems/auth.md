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

## Source of truth

- `api/auth/service.py` владеет auth-транзакциями, TTL, token rotation, password throttling и отзывом сессий.
- `api/models.py`: `TMAAuthAccount`, `TMAAuthIdentity`, `TMAAuthSession`, `TMAAuthToken`, `TMAAuthProof`, `TMAAuthChallenge`, `TMAAuthPassword`, `TMAAuthPasswordThrottle`.
- Текущий `get_user_id` в `api/dependencies/auth.py` пробует Bearer, затем допускает legacy `X-User-ID`; строгая Bearer-зависимость находится в `api/auth/dependencies.py`. Проверяйте, какую зависимость использует конкретный route.
- Credentials/session storage принадлежит utils/auth и useAuthStore; profile fields и password settings имеют отдельные потоки.
- Password hashing использует Argon2id; восстановление через привязанный провайдер/профиль описано в [AUTH_V2](../../project_docs/ARCHITECTURE/AUTH_V2.md).
- Миграции схемы — `api/migrations.py`; детали текущего rollout/переменных — `api/auth/DEPLOYMENT.md`.
- Старый router `api/routers/auth.py` существует, но действующий вход описан через auth v2.

## Session and provider recovery

- `utils/auth.js` consumes `guest=1` / `reset=1` through `history.replaceState`, preserving other query parameters and the hash. A new login must survive the next reload.
- API refresh handles only a rejected credential from the current account/session. Late 401 responses from a previous account cannot clear the new session; responses sent with an already rotated access token retry with the current token. Mini App proof failures are provider errors, not session refresh triggers.
- `restoreSession` resumes a pending Telegram/Google challenge (including its manual URL) from sessionStorage on reload. Missing state or invalid/expired deadlines stop the waiting UI. Temporary exchange transport/5xx errors remain retryable within the original five-minute challenge lifetime. The backend's `invalid_challenge` also represents unconfirmed challenges, so the client bounds that response by the stored deadline.
- Valid Mini App `initData` signs in directly without a popup. Expired/consumed proof falls back to a fresh bot challenge via `openTelegramLink`; server signature, replay, session and linking rules remain enforced.
- Browser provider flows reserve a tab synchronously in the click handler. `openExternalLink` returns whether a window/bridge was available; a blocked popup shows an explicit message and a native anchor as the manual fallback. The fallback belongs to the modal keyboard focus loop.

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
- Real API interceptors with isolated Axios transport: `scripts/tests/api_session_regression.mjs`; storage/reload/reset: `scripts/tests/auth_session_regression.mjs`.
- Browser provider lifecycle, blocked-popup fallback, pending reload/expiry, expired access refresh and Mini App: `scripts/tests/browser/auth-lifecycle.spec.cjs` (all provider/API responses intercepted).
Перед integration checks сверяйте fixtures/DB configuration; deployment checks описаны отдельно.

## Related docs

- [AUTH_V2](../../project_docs/ARCHITECTURE/AUTH_V2.md), [Deployment](../../api/auth/DEPLOYMENT.md).
- [Auth security review](../../project_docs/reports/AUTH_SECURITY_REVIEW.md) — отчёт; текущие проверки находятся в коде.
- [Sync](sync.md), [Decks](decks.md), [Knowledge lifecycle](knowledge.md).
