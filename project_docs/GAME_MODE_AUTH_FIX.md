# Game Mode: исправление общей авторизации

Дата: 2026-10-12. Ветка: `feat/game-mode-mvp1`, checkout `C:/121/Lerne_projekt/tma`.
Другие worktree и существовавшие изменения `lerne-card-prompts` не изменялись.
Commit, push, deploy, миграции и изменения production-данных не выполнялись.

## Причина и воспроизведение

Game API правильно требует строгую v2 Bearer-авторизацию. Classic использует тот же
API-клиент, но его серверная dependency допускает legacy `X-User-ID`. Поэтому доступный
Classic интерфейс мог скрывать отсутствие/недействительность настоящей v2-сессии.

В `utils/auth.js` профиль из `?user_id` или `Telegram.initDataUnsafe.user.id` имел приоритет
над сохранённым каноническим аккаунтом. При несовпадении ID код удалял v2-сессию, в том числе
при обычном чтении `getUserId()` из API-interceptor/GameView. ID аккаунта email/Google может
быть отрицательным и отличаться от привязанного Telegram ID. Повторный вход не помогал при
остающемся URL/Telegram hint. `?guest=1`/`?reset=1` также очищали новую сессию при каждом чтении.

Дополнительно Game проверял токен до завершения тихого Telegram login и не подписывался
на завершение восстановления/входа. Memory-cache токенов не замечал ротацию/logout другой
вкладки. Любой сбой refresh, включая сеть/503, очищал сессию.

Пять изолированных тестов выполняют настоящий `auth.js`. На исходном HEAD все пять падают;
на исправленном модуле проходят. Проверка опубликованного auth-бандла подтверждает наличие
старой логики удаления сессии. Это воспроизводимый дефект кода; доступа к конкретной сессии
сообщившего об ошибке пользователя не было.

## Исправление

- Общий `useAuthStore.restoreSession` проверяет `/auth/v2/me` через существующий API/refresh
  или выполняет существующий тихий Mini App login. Classic init и Game ждут `isRestoring`.
- При наличии v2-сессии профиль канонического аккаунта имеет приоритет перед legacy hints.
  Reset-параметры обрабатываются один раз за загрузку страницы.
- Game берёт владельца из общего auth-store и повторяет setup после завершения входа.
  Account-scoped sessionStorage attempt ID и существующий App key сохранены.
- localStorage перечитывается при каждом запросе. Storage events синхронизируют аккаунт
  между вкладками. Logout подавляет legacy/dev fallback.
- Refresh использует прежнюю очередь и, при наличии Web Locks API, межвкладочный lock.
  Все ожидающие запросы повторяются максимум один раз. Только отказ refresh с 401 очищает
  сессию и открывает существующий login. Network/5xx оставляют токены для retry; 403 не
  вызывает refresh или logout. Переигрывание запросов под другим аккаунтом запрещено.
- Поздние refresh/login/profile responses не отменяют logout или последующий вход.
  Ошибки Game сохраняют историю, черновик и request ID. Серверные Bearer/owner checks
  не изменены. Голосовые механизмы, диалоги, память NPC и схема БД не изменены.

## Изменённые файлы

Код:

- `app/src/utils/auth.js`
- `app/src/store/useAuthStore.js`
- `app/src/services/api.js`
- `app/src/hooks/useAppInitialization.js`
- `app/src/components/deckgrid/DeckGridHeader.jsx`
- `app/src/components/game/GameView.jsx`

Проверки и документация:

- `scripts/tests/auth_session_regression.mjs`
- `scripts/tests/auth_store_regression.mjs`
- `scripts/tests/browser/game-auth.spec.cjs`
- `playwright.game-auth-production.config.cjs`
- `.agents/subsystems/auth.md`
- `.agents/subsystems/game.md`
- `project_docs/GAME_MODE_AUTH_FIX.md`

## Проверки

Все browser fixtures перехватывают API; нет реальных provider/AI/TTS вызовов или аккаунтов.
Production-конфигурация обслуживает настоящий `app/dist` на origin
`https://tma-amber.vercel.app` через Playwright routing, сохраняя реальные build-time ветки
API-конфигурации. Это тест опубликованной конфигурации frontend, а не deploy.

| Сценарий | Проверка |
| --- | --- |
| Вход один раз → Game, включая устаревший URL ID | Browser auth: login один, все Game запросы принадлежат каноническому аккаунту |
| Classic → Game → Classic | Browser auth: Classic deck и сохранённый разговор |
| Обновление страницы Game | Browser auth: существующий ID/история восстановлены после возврата в Game; существующая навигация после reload открывает Classic |
| Новая вкладка | Browser auth: сохранённая v2-сессия; дополнительного login нет |
| Logout | Реальный auth-store в dev; production storage-event boundary; старые Game данные скрыты, поздние ответы не восстанавливают аккаунт |
| Game без авторизации | Существующий login; нет анонимных attempt/API requests |
| Просроченный access/invalid refresh | Один refresh при двух вкладках; invalid refresh открывает login, сохраняет историю/черновик; 503 сохраняет сессию для retry |
| Другой аккаунт | Browser auth + реальные backend owner tests; история A не показана B, turn не переигрывается под B |
| Production-конфигурация | Те же восемь auth browser tests на production-бандле и публичном origin; только согласованные `/api` запросы |

Команды:

Результаты: 18 тестов реальных клиентских storage/store модулей, 92 серверных теста,
8 auth browser tests в dev и 8 на финальной production-сборке, 21 существующая browser
regression (Game/voice/Classic) — PASS. После последней правки login повторены 8 dev auth
tests и 3 Classic guest-entry tests. Full lint, финальные targeted ESLint, build и
`git diff --check` — PASS. Backend tests используют disposable SQLite, не production PostgreSQL.

```text
node scripts/tests/auth_session_regression.mjs
node scripts/tests/auth_store_regression.mjs
python -m unittest tests.test_game_mode tests.test_answer_evaluation scripts.tests.test_auth_foundation -q
npx --no-install playwright test scripts/tests/browser/game-auth.spec.cjs --workers=1 --output test-results/game-auth-dev
npm --prefix app run build
npx --no-install playwright test --config playwright.game-auth-production.config.cjs --workers=1
npx --no-install playwright test scripts/tests/browser/game-mode.spec.cjs scripts/tests/browser/guest-entry.spec.cjs scripts/tests/browser/autoplay-ui.spec.cjs --workers=1
npm --prefix app run lint
```

Также выполнялся targeted ESLint всех изменённых frontend-файлов после последней правки.
Проверены скриншоты Game с историей после восстановления при 375/1280px; существующая
browser regression проверяет 320/375/430/768/1280px, RU/EN/UK, voice lifecycle и Classic autoplay.
Build выдаёт предупреждения о больших chunks и совместных static/dynamic imports;
они не связаны с авторизацией. Полный Node parser suite не запускался.

## Публичный деплой и настройки

Read-only проверка действующего публичного сайта:

- `GET /`: 200; frontend содержит Game Mode и общий API-клиент.
- `GET /api/game/scene`, `GET /api/auth/v2/me` без Bearer: 401 `authentication_required`.
- `OPTIONS /api/game/scene` с публичным origin, запросом `Authorization,X-User-ID`: 200;
  разрешены origin, заголовки и credentials.
- Опубликованный auth-бандл содержит старую session-removal логику. Изменения ещё не опубликованы.

Для текущего Vercel origin изменения серверных настроек не выявлены: frontend использует
общий `/api`, `vercel.json` маршрутизирует его в тот же backend. Bearer передаётся явно в
`Authorization`; текущая v2-сессия не cookie-based, поэтому `withCredentials` не требуется.

При отдельном frontend/backend проверить `VITE_API_URL` **во время frontend build**: полный
API base с `/api`, единый для Classic, Game и `/auth/v2/refresh`, без смешения staging/production.
Для custom origin он должен входить в серверный `CORS_ORIGINS`; разрешение Authorization уже
есть в middleware. `PUBLIC_API_BASE_URL`, `TMA_PUBLIC_URL`, `GOOGLE_OAUTH_REDIRECT_URI` должны
указывать на согласованный публичный deployment; Google callback должен совпадать с настройкой
провайдера. Backend всех этих маршрутов должен использовать одну auth-БД. Новые env vars,
секреты, auth migrations и отдельный Game login не нужны.

Нужны разрешённая публикация новой frontend-сборки и последующая проверка настоящего
Telegram/Google/email login внешним пользователем. Она здесь не выполнялась: deploy запрещён
условиями задачи, а реальные credentials не предоставлены. Нельзя безопасно превратить один
legacy user_id/отображаемый профиль без проверяемого proof в Bearer-сессию: такой пользователь
должен один раз войти существующим способом, после чего Classic и Game используют её вместе.
