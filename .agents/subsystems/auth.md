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

- Опциональный LOCAL использует `local/router.py` → `login_local_test` для выпуска стандартной auth v2 session. Route отсутствует вне LOCAL, требует loopback client, разрешённый Origin и приватный credential от Vite proxy. Session/profile/pending keys имеют namespace `lerne_local:*`. См. [local-development](local-development.md).

- `api/auth/service.py` владеет auth-транзакциями, TTL, token rotation, password throttling и отзывом сессий.
- `api/models.py`: `TMAAuthAccount`, `TMAAuthIdentity`, `TMAAuthSession`, `TMAAuthToken`, `TMAAuthProof`, `TMAAuthChallenge`, `TMAAuthPassword`, `TMAAuthPasswordThrottle`.
- `get_user_id` в `api/dependencies/auth.py` делегирует строгой Bearer-зависимости из `api/auth/dependencies.py`. `X-User-ID` не является credential и игнорируется; неверная/отозванная сессия не допускает fallback. Telegram получает сессию через подписанный initData/challenge в auth v2. Старые header-only клиенты должны войти заново.
- Credentials/session storage принадлежит utils/auth и useAuthStore; profile fields и password settings имеют отдельные потоки.
- Password hashing использует Argon2id; восстановление через привязанный провайдер/профиль описано в [AUTH_V2](../../project_docs/ARCHITECTURE/AUTH_V2.md).
- Миграции схемы — `api/migrations.py`; детали текущего rollout/переменных — `api/auth/DEPLOYMENT.md`.
- Старый router `api/routers/auth.py` существует, но действующий вход описан через auth v2.

## Права администратора (этап 1.3)

- Единая проверка — `api/permissions.py:is_admin(user_id)`: сравнение ID аккаунта с
  `ADMIN_USER_ID` из окружения. При отсутствии переменной сохранён прежний ID
  `642478257`; пустое или некорректное значение запрещает административный доступ.
- Её используют `/api/init`, Classic/auth-v2 профили, settings, debug,
  переключение default-колод и collaborative permissions опубликованного контента.
  Username, включая прежний список `ADMIN_USERNAMES`, прав не предоставляет.
- На этапе 1.3 получение ID пользователя и auth v2 не менялись; последующий security audit удалил Bearer/legacy fallback (см. Source of truth выше).
  Клиентские проверки используют серверный флаг; существующий DEV-only `?admin=1`
  остаётся локальным UI preview, серверные права он не меняет.
- `MASTER_UID` в LiD — владелец исходных колод, ID в миграциях — данные,
  `AUTHOR_USER_ID`/`ADMIN_USER_ID` в author service — выбор автора. Это не проверки
  прав. Старые корневые `patch_*.py`/`fix_auth.py` и `codex_diff.patch` — артефакты
  прошлых правок, в runtime не участвуют.
- Регрессии: `python scripts/test_backend.py scripts/tests/test_admin_permissions.py`.
  SQLite в памяти, реальные HTTP auth dependencies, запрет внешних подключений;
  проверяются ID администратора/обычного пользователя, username spoofing,
  все settings guards, библиотека, collaborative roles и debug production 404.

## Session and provider recovery

- `utils/auth.js` consumes `guest=1` / `reset=1` through `history.replaceState`, preserving other query parameters and the hash. A new login must survive the next reload.
- API refresh handles only a rejected credential from the current account/session. Late 401 responses from a previous account cannot clear the new session; responses sent with an already rotated access token retry with the current token. Mini App proof failures are provider errors, not session refresh triggers.
- `restoreSession` resumes a pending Telegram/Google challenge (including its manual URL) from sessionStorage on reload. Missing state or invalid/expired deadlines stop the waiting UI. Temporary exchange transport/5xx errors remain retryable within the original five-minute challenge lifetime. The backend's `invalid_challenge` also represents unconfirmed challenges, so the client bounds that response by the stored deadline.
- Valid Mini App `initData` signs in directly without a popup. Expired/consumed proof falls back to a fresh bot challenge via `openTelegramLink`; server signature, replay, session and linking rules remain enforced.
- The browser auth modal prefetches one Telegram challenge in memory, deduplicating concurrent requests and refreshing it shortly before expiry. Prefetch does not persist a pending login or start polling. A native `a[href]` with `noopener noreferrer` activates/persists the same challenge synchronously on the user gesture; repeated clicks are suppressed. Purpose, expiry and account generation isolate login/link/recovery and retire stale preparations after cancellation, logout or account changes.
- An early click shares the in-flight prefetch and reserves at most one tab synchronously. Google and non-modal provider controls retain synchronous reservation. Async `openExternalLink` uses the Telegram/Capacitor bridge or reserved tab, then automatically navigates the current tab if the bridge/reservation fails. Auth calls disable further popup attempts after requests; the saved challenge resumes on return/reload. Native anchor navigation does not expose a reliable blocked-window signal, so it is never followed by a guessed second navigation that could create duplicate tabs. The manual native link is the final reserve and belongs to the modal keyboard focus loop.

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

- Серверная граница `api/index.py`: непредвиденные ошибки дают
  `runtime_error` / `internal_server_error`, сбой импорта —
  `startup_error` / `service_unavailable`; traceback остаётся в серверных логах.
  HTTP 5xx скрывают detail (`service_unavailable`), кроме публичного auth-кода
  `provider_not_configured` (503). HTTP 4xx, auth detail и Bearer headers сохранены.
  Проверка: `python scripts/test_backend.py scripts/tests/test_api_errors.py`.
- Foundation: `scripts/tests/test_auth_foundation.py`.
- Client state: `scripts/tests/auth_store_regression.mjs`.
- Новый браузер, локализованные адаптивные элементы входа и загрузка колод после входа (изолированные ответы API): `scripts/tests/browser/guest-entry.spec.cjs`.
- Refresh queue: `scripts/tests/test_api_silent_refresh.mjs`.
- Real API interceptors with isolated Axios transport: `scripts/tests/api_session_regression.mjs`; storage/reload/reset: `scripts/tests/auth_session_regression.mjs`.
- Browser provider lifecycle, native Telegram click/keyboard login, early clicks, blocked/closed reservation fallback, duplicate suppression, pending reload/expiry, expired access refresh and Mini App: `scripts/tests/browser/auth-lifecycle.spec.cjs` (all provider/API responses intercepted). Run `npm run test:auth:chrome` with installed Google Chrome; this project keeps popup blocking enabled. Platform bridge/navigation unit tests: `app/src/utils/__tests__/platform.test.js`.
Перед integration checks сверяйте fixtures/DB configuration; deployment checks описаны отдельно.

## Related docs

- [Supabase security audit / migration / rollback](../../security/supabase/README.md) — server-only public schema, read-only catalog gate, отдельное подтверждение production rollout и отзыва сессий.
- [AUTH_V2](../../project_docs/ARCHITECTURE/AUTH_V2.md), [Deployment](../../api/auth/DEPLOYMENT.md).
- [Auth security review](../../project_docs/reports/AUTH_SECURITY_REVIEW.md) — отчёт; текущие проверки находятся в коде.
- [Sync](sync.md), [Decks](decks.md), [Knowledge lifecycle](knowledge.md).


## Единая проверка регрессий (этап 1.1)

Из корня: `npm run check`. Команды, перечень изолированных suites, CI gate,
матрица покрытия и ограничения: [TESTING](../../docs/TESTING.md).
Отдельный backend suite запускайте через `scripts/test_backend.py`, чтобы
сохранить блокировку production-сервисов и загрузки `.env`.
