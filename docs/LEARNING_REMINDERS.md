# «Учить» и Telegram-напоминания

Локальное исправление от 28.10.2026 на `main`, база `c79683dca745fb023adfe1a0da6476aef15631bf`.
Cloud migrations, публикация, ручной запуск production cron и реальные сообщения не выполнялись.

## Причины и результат

- `DeckCardItem` скрывал личное действие для `is_global_readonly`. Кнопка и пункт меню теперь доступны и опубликованным/shared viewer колодам. Сервер по-прежнему требует право чтения для переключения и прежние права записи для контента.
- Оптимистическое обновление подмешивало `is_learning` в metadata; при ошибке не восстанавливало `currentDeck`. Оно теперь меняет только личное поле проекции, откатывает список/текущую колоду/кеш, объединяет повторные запросы и не откатывает другой аккаунт после поздней ошибки.
- Единственный серверный источник — `TMASetting.key = DECK_LEARNING_{user_id}_{deck_id}`, `value = '1' / '0'`. Без записи значение false. Старое metadata-поле не используется и исключается из выдачи/обновления metadata. Новые колоды не получают это поле. Миграция исторических metadata не выполнялась.
- Существующая `LearningShortcutsBar` была скрыта в папках. Она теперь видна и в папках, сохраняет оформление/счётчики, сразу реагирует на переключение. Ярлык открывает нужную колоду мышью или клавиатурой.
- Offline хранит личную проекцию/`learning_dirty` в прежней отдельной Dexie БД пользователя; существующий sync отправляет её через `/toggle-learning`. Metadata не служит запасным источником.
- Reminder service читал metadata только собственных колод. Теперь использует персональные настройки и существующий resolver доступных колод, включая опубликованные/общие; удалённые колоды и отозванный доступ исключаются. LEFT JOIN `TMAProgress` ограничен текущим пользователем. Исправлен отсутствующий SQL alias `deck_id`, из-за которого разбор статистики возвращал нули.
- Напоминания выключены без явно сохранённого `enabled`; существующие явно сохранённые true/false и расписание сохраняются. Исправлено создание настроек/истории слотов с обязательным `TMASetting.value`. Фронтенд ждёт настройки текущего аккаунта и не показывает включение как успешное после ошибки API.
- Получатель — только положительный Telegram subject из `TMAAuthIdentity` активного auth account. Fallback на произвольный положительный account ID и создание identity при отправке удалены; диагностика использует ту же проверку. Тестовая отправка остаётся отдельным явным действием и не включает расписание.
- Сохранены frequency/times/hourly range/IANA timezone/legacy offset/only_due/quiet hours. Тихий режим учитывает минуты и фактическое время отправки catch-up. Для ссылок используется существующий `TMA_PUBLIC_URL`, с прежним production default.

## Повторные уведомления

В существующей `TMASetting` хранится `LAST_REMINDER_ATTEMPT_{user_id}` — атомарная отметка последнего взятого слота. Условный UPDATE до Telegram I/O разрешает только одному воркеру попытаться отправить слот. `LAST_REMINDER_SLOTS_{user_id}` по-прежнему хранит успешные/потреблённые слоты текущих суток; список больше не обрезается до 15 элементов.

После таймаута/неопределённого исхода один слот автоматически не повторяется: повтор мог бы доставить сообщение дважды. Следующий слот работает по расписанию, явная тестовая отправка остаётся доступной. Это защита от повторных попыток, а не гарантия доставки: сбой между взятием слота и отправкой может пропустить его. Ошибка учитывается в `results.errors`. Изменения схемы для этого не нужны.

## Изменённые файлы

| Файлы | Назначение |
| --- | --- |
| `api/services/decks.py`, `api/services/utils.py` | Только персональная настройка, очистка проекций metadata |
| `api/services/reminder_service.py` | Доступные изучаемые колоды, SRS, opt-in, identity, расписание и защита слотов |
| `api/requirements.txt` | `tzdata` для реальных IANA timezone в LOCAL Windows |
| `app/src/components/deckgrid/DeckCardItem.jsx`, `DeckGrid.jsx`, `LearningShortcutsBar.jsx`, `app/src/components/DeckGrid.css` | Доступность действия/ярлыков, клавиатурная навигация и сохранение выравнивания |
| `app/src/store/slices/createDeckSlice.js`, `app/src/services/offlineApi.js` | Оптимистическое/личное/offline состояние и ошибки |
| `app/src/store/useSettingsStore.js`, `app/src/components/settings/RemindersTab.jsx` | Выключенный default, подтверждённое сервером состояние текущего аккаунта |
| `.github/workflows/reminder-cron.yml` | Проверка секрета, timeout и JSON errors; вывод только агрегированных счётчиков |
| `scripts/test_backend.py`, `scripts/tests/test_learning_reminders.py`, `scripts/tests/learning_reminders_postgres.py` | Изолированные серверные/LOCAL PostgreSQL регрессии |
| `scripts/tests/browser/deck-learning.spec.cjs`, `scripts/tests/browser/offline.spec.cjs` | Браузерные регрессии |
| `.agents/subsystems/decks.md`, `docs/LEARNING_REMINDERS.md` | Контракт и отчёт |

Карточки, алгоритм SRS, прогресс, правила редактирования и админка не изменялись.

## Проверки

Все данные синтетические; Telegram send подменён. Артефакты только в `local/test-data/`.

- `venv/Scripts/python.exe scripts/test_backend.py scripts/tests/test_learning_reminders.py`: **13 PASS**, SQLite. Два читателя одной опубликованной колоды, собственный SRS и текст сообщения, отсутствие записи карточек/прогресса/metadata, shared viewer/revoke/delete, opt-in/сохранённое расписание, verified identity, тихие часы/часовой пояс/hourly, повторный/пересекающийся cron, timeout, авторизация cron и исполнение JSON-проверки workflow на синтетических ответах.
- `venv/Scripts/python.exe scripts/tests/learning_reminders_postgres.py --bin-dir C:/121/Lerne_projekt/tools/pgsql/bin`: **те же 13 PASS** в новом одноразовом native PostgreSQL-кластере; **8 конкурентных соединений — ровно 1 победитель** одного слота. Существующая LOCAL-БД не затронута, кластер остановлен, логи сохранены.
- Backend suites: `test_material_permissions.py` **36 PASS**, `test_auth_foundation.py` **39 PASS**, `test_offline_sync.py` **12 PASS**.
- `npm --prefix app test`: **523 PASS**. `library_store_regression.mjs` + `test_user_settings_sync.mjs`: **24 PASS**.
- Playwright `deck-learning.spec.cjs` + адресный `offline viewer` в `offline.spec.cjs`: **8 PASS**. Включение/выключение ярлыка, меню, immediate optimistic state/error rollback, currentDeck/cache, reload/login, два пользователя/новый browser context, поздняя ошибка после смены аккаунта, opt-in/error/persistence настроек, отдельные offline БД.
- UI RU/EN, 320/375/430/768/1280 px; screenshots в `local/test-data/playwright/`. Проверены отсутствие горизонтального overflow и открытие ярлыка клавиатурой; screenshot папки просмотрен визуально.
- ESLint затронутых JS/JSX и Python `py_compile`: **PASS**. Vite production build: **PASS**, с предупреждениями о размере chunks и ineffective dynamic imports.

Browser API fixtures проверяют реальный React/Dexie, но не реальную Telegram-доставку или два физических устройства. Серверное хранение/SQL отдельно проверены на SQLite и PostgreSQL; полноценная production-цепочка не запускалась.

## Cron и production

Проверены только существующие метаданные/логи, без запуска рассылки:

- `.github/workflows/reminder-cron.yml`: `7,37 * * * *`, POST `https://tma-amber.vercel.app/api/bot/cron-reminders`, `X-Internal-Cron-Token` из GitHub `REMINDER_CRON_TOKEN`. В `vercel.json` второго cron нет.
- API принимает этот заголовок и `Authorization: Bearer ...`, сравнивая с `REMINDER_CRON_TOKEN` (приоритет) или `CRON_SECRET`. Без настроенного/верного секрета — 403. Оба HTTP метода/заголовка и отказ проверены локально без dispatch.
- В Vercel project `tma` присутствуют production `BOT_TOKEN` и `REMINDER_CRON_TOKEN`. Значения не расшифровывались. Token сейчас помечен платформой как readable config; перед production rollout стоит перевести его в Secret, сохранив совпадение с GitHub.
- Существующий [cron run 40757496025](https://github.com/LanguageSage/lerne-tma/actions/runs/40757496025), 28.10.2026: endpoint вернул `status: ok`, `sent: 0`, `skipped: 33`, `errors: 0`; причины — `No due or new cards`. Это подтверждает рабочий URL/авторизацию на момент запуска, но не доставку. GitHub secret API недоступен коннектору; значение напрямую не читалось/не сравнивалось.

Для запуска после отдельного разрешения: опубликовать эти изменения с зависимостями; сохранить действующий BOT_TOKEN и совпадающий cron secret; убедиться, что нужный пользователь связал подтверждённый Telegram через существующую auth-цепочку, открыл/запустил бота, выбрал колоды и явно включил напоминания. Затем выполнить тестовую отправку только этому пользователю и проверить его диагностику/следующий cron slot. Миграций облачной БД не требуется. GitHub schedule может задерживаться; успешный workflow теперь дополнительно требует `status: ok` и отсутствие `results.errors`.
