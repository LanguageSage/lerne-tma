# Восстановление авторизации TMA

Дата: 2026-11-01. Исправление локально в `main`, исходный HEAD `9486b3e`.
Пользовательские изменения adaptive knowledge предварительно сохранены отдельным
коммитом `bb1f185` в `codex/adaptive-knowledge`. Auth-изменения оставлены для review
в рабочей папке `main`. Push, merge и deploy не выполнялись.

## Проверенные причины

До изменения runtime добавлены и запущены две регрессии на исходном коде:

1. Сохранённый профиль `is_guest: false` и init cache при отсутствии обоих токенов:
   `getUserProfile()` вернул профиль вместо null. Тест воспроизвёл ошибку.
2. Web restoration без credentials: Zustand сохранил старый профиль, окно входа
   не открылось. Тест воспроизвёл ошибку.

Вызовы и прямые зависимости показали остальные причины:

- `getUserProfile` смешивал сохранённую identity с session, включая URL,
  `initDataUnsafe` и development fallback.
- `restoreSession` обрабатывал токены, LOCAL и Mini App, но пропускал обычный web
  без токенов. Общий promise восстановления мог принадлежать предыдущему входу.
- API возвращал 401 без refresh без запроса формы входа. Повторный 401 после
  replay игнорировался; `clearAuthSession` изменял storage без обновления Zustand.
- Init cache публиковал профиль в UI независимо от действующей авторизации;
  auth failure мог также помешать завершению startup loading.
- Study превращал auth detail в `apiError`; выбранное действие после входа
  терялось. Открытие колоды дополнительно имело необработанный rejected promise.
- Новый browser-тест двух вкладок выявил гонку: отклонённый refresh освобождал
  Web Lock до инвалидирования credentials, позволяя повторить тот же refresh.
  Инвалидирование перенесено внутрь блокировки, тест проходит.
- Provider regression выявила лишний Telegram preflight в промежутке между
  retirement polling и закрытием формы. `finishLogin` теперь блокирует login
  preflight только для завершаемого входа; есть отдельный unit regression,
  исходные browser assertions одного challenge/окна сохранены.

## Итоговые правила

`utils/auth.js` владеет credentials и синхронными уведомлениями. `useAuthStore`
владеет состоянием восстановления, подтверждения `/auth/v2/me`, UI входа и
продолжением навигации. `useUiStore.userProfile` — его UI-зеркало.

| Данные / состояние | Значение |
| --- | --- |
| `savedProfile`, `getSavedUserProfile()` | Сохранённый контекст владельца офлайн-данных |
| `getUserId()` | Namespace владельца; никогда не credential |
| `getUserProfile()` | Только профиль, совместимый с существующими credentials |
| `status: restoring` | Проверка candidate session ещё не завершена |
| `status: authenticated` | Профиль подтверждён `/auth/v2/me` |
| `status: offline` | Credentials сохранены, проверку сейчас завершить не удалось |
| `status: required` | Нужен вход, открывается существующий AuthRequiredModal |
| `status: anonymous` | Credentials отсутствуют после явной очистки |

Refresh дедуплицируется по refresh token. Между вкладками используется Web Locks;
при его отсутствии — lease с атомарным захватом в существующей Dexie `syncState`.
Ключ `auth-v2-refresh-lease` не пересекается с `review:*`, `pending` и `aliases` и
не попадает в синхронизацию оценок. Схема Dexie не менялась. Lease живёт 20 секунд,
HTTP refresh ограничен 10 секундами. Закрытая вкладка не оставляет вечную
блокировку; истёкший lease можно захватить заново. Ответ после потери lease
не может записать токены или инвалидировать credentials.

Идентификатор конкретного входа хранится вместе с tokens и сохраняется при
rotation. Повторный вход, даже в тот же аккаунт, меняет его. Старые success,
401, network errors, refresh и provider exchange не публикуют данные нового
входа; cancelled requests не используют offline fallback другого аккаунта.

Terminal 401 — отсутствие refresh, отклонённый refresh либо отклонённый replay
актуального access token. Он сохраняет offline ownership/cache, очищает credentials
и согласованно обновляет auth/UI stores. Параллельные 401 не создают новые окна
провайдеров. Ошибка provider proof/challenge, 403, timeout, сеть и 5xx не являются
logout. Автоматический provider popup при protected-resource 401 не запускается.

Выбор колоды, карточки или занятия сохраняется как descriptor в namespaced
sessionStorage. После входа и загрузки библиотеки он потребляется один раз;
другому владельцу действие не переносится. Descriptor переживает reload/возврат
из provider. Повторяются только операции открытия; оценки не переотправляются
автоматически. Неподтверждённая оценка сохраняет существующий механизм ошибки.

## Изменённые файлы

| Файлы | Изменение |
| --- | --- |
| `app/src/utils/auth.js` | Разделение сохранённого профиля и credentials; notification и login identity |
| `app/src/store/useAuthStore.js` | Общий lifecycle, restoration по identity, согласование stores, storage events, продолжение навигации |
| `app/src/services/api.js` | Single-flight, Web Locks/lease, terminal 401, защита ответов и offline fallback; удалён X-User-ID |
| `app/src/hooks/useAppInitialization.js` | Cache не подтверждает профиль; startup завершается при 401; восстановление при reconnect |
| `app/src/hooks/useStudySession.js`, `useStudyNavigation.js` | Auth recovery вместо StudyError, восстановление открытия/занятия |
| `app/src/store/slices/createDeckSlice.js` | Без повторных запросов карточек при terminal 401/403/cancellation |
| `app/src/components/deckgrid/DeckCardItem.jsx`, `LearningShortcutsBar.jsx` | Обработан 401 при открытии колоды |
| `app/src/components/settings/ProfileTab.jsx` | Сохранение профиля через общего владельца auth state |
| `scripts/tests/{auth_session,auth_store,api_session}_regression.mjs` | Регрессии credentials, восстановления, гонок и ошибок |
| `scripts/tests/browser/auth-recovery.spec.cjs` | Desktop/Pixel 7, две вкладки, Web Locks/lease, dirty Dexie и продолжение после входа/reload |
| `scripts/tests/browser/{auth-lifecycle,guest-entry,library-mobile}.spec.cjs` | Ожидание автоматического показа существующей формы; настоящие fixture tokens для authenticated account |
| `scripts/tests/browser/card-editor.spec.cjs` | Synthetic session и `/me` вместо устаревшего предположения, что URL user_id авторизует пользователя |
| `scripts/tests/browser/local-mode.check.cjs` | Исправлен старый mock `/messages`: ответ соответствует контракту массива |
| `playwright.config.cjs` | Новый auth recovery suite включён в critical gate |
| `.agents/subsystems/auth.md`, `.agents/subsystems/study.md` | Обновлён контракт и карта проверок |

## Проверки

- Полный `npm run test:frontend`: **654 PASS** (547 application + 107 regression).
- Полный `npm --prefix app run lint`, затем ESLint всех затронутых runtime файлов:
  **PASS**.
- `npm --prefix app run build`: **PASS**. Сохранились предупреждения о размере
  существующих chunks и неэффективных dynamic imports парсеров.
- Auth recovery: desktop Chromium и Pixel 7 Chromium, cache без tokens,
  expired access, invalid refresh, параллельные 401, две вкладки с Web Locks и
  без него, смена аккаунта во время refresh, network/timeout/403/5xx,
  сохранность dirty cards/progress/notes/review events/outbox, offline library,
  продолжение study и открытия колоды после входа/reload.
- Смена владельца очищает прежнюю карточку/history только в памяти; pending
  grades/errors остаются у прежнего владельца. Browser-регрессия проверяет это
  вместе с поздним refresh предыдущего аккаунта.
- Provider lifecycle проверяется в `auth-chrome`: Telegram, Google, Mini App,
  popup blocking, reload, expiry, ранние/повторные clicks. В bundled Chromium
  отдельный Chrome policy test возвращал другой результат; в установленном
  Chrome он проходит. Проверка не была ослаблена.
- Полный critical browser project: **81 PASS**, включая **22 auth recovery**.
  В объединённом запуске critical/auth-chrome после этих 81 PASS обнаружился
  лишний provider preflight; после исправления отдельный `auth-chrome`:
  **10 PASS**. Повторный auth recovery на финальном коде: **22 PASS**.
  Финальные логи: `local/test-data/auth-recovery-browser.log`,
  `local/test-data/auth-provider-final.log` и `local/test-data/auth-recovery-final.log`.
- `playwright.local.config.cjs`: **1 PASS**, реальный LOCAL Vite, mock API,
  namespaces, IndexedDB и ширины 320/375/430/768/1280.
- Auth foundation backend: **46 PASS**; server/admin permissions: **10 PASS**.
- LOCAL backend: **19 PASS** через `venv/Scripts/python.exe`. Первый запуск
  системным Python имел 18 PASS и ошибку отсутствующего пакета `telegram`;
  проектный venv устранил ограничение окружения без изменения зависимостей.

Изолированный backend harness запрещал внешнюю сеть и PostgreSQL. Его disposable
fixtures создавали только синтетические SQLite/temp databases. Миграции проекта,
production/local PostgreSQL и реальные учебные данные не изменялись. Артефакты
browser-проверок и логи находятся в `local/test-data/`.

Финальные отдельные browser-команды:

```powershell
npx --no-install playwright test --project=auth-chrome --output=local/test-data/auth-provider-final
npx --no-install playwright test --project=critical auth-recovery.spec.cjs --output=local/test-data/auth-recovery-final
npx --no-install playwright test --config=playwright.local.config.cjs --output=local/test-data/auth-recovery-local
```

Форма и восстановленное занятие просмотрены по PNG desktop/Pixel 7. Existing
provider/library/LOCAL suites дополнительно проверили 320/375/430/768/1280px и
RU/EN локали. Нового оформления задача не добавляет.

## Границы проверки

Provider и API ответы в браузере перехвачены: реальный Google OAuth/Telegram bot
и production endpoint не вызывались. Мобильная проверка — Chromium touch
emulation, не физический Telegram/Capacitor WebView. Если вкладка закрывается
между серверной rotation и сохранением ответа, новый token нельзя восстановить
из уже потерянного ответа; потребуется повторный вход. Блокировки защищают
обычные гонки живых вкладок, а lease позволяет выйти из блокировки закрытой.
При недоступном IndexedDB и отсутствии Web Locks refresh не делает небезопасную
параллельную rotation: ошибка координации сохраняет credentials для retry.
Серверный Bearer dependency, подписи/TTL/replay provider proof и permissions
не менялись; `X-User-ID` из общего API-клиента удалён.
