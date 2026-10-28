# Пустая библиотека Android — диагностика 28.10.2026

## Проверенные версии и границы

Vercel production `dpl_C4LFW8raHMbjPaiWHqCUPNGpUaeR`, alias
`tma-amber.vercel.app`, READY, SHA `6101580541f590d13203be048540721a457f09bd`.
Локальный main до исправления: `427c5de`. Auth/store/init/API/filter файлы,
описанные ниже, между этими ревизиями не изменены (проверено git diff).

Рабочая вкладка Chrome на ПК показывает папки и колоды. Доступные runtime
error clusters Vercel не доказывают сбой `/init`, `/folders` или `/decks`.
Исторические request logs ограничены retention тарифа; пустая выборка не
доказывает отсутствие ошибки. Устройства Chrome/Brave Android пока не были
подключены: их HTTP-статусы, account IDs и количество объектов не установлены.
Ниже подтверждённые причины клиентской ложной пустоты, а не утверждение о
сетевой первопричине конкретных Android-сессий.

## Воспроизведение до изменения приложения

Изолированный Chromium, профиль Pixel 7, синтетический account 101, два deck и
две folder, parent_id: null → 11. Внешние запросы и WebSocket заблокированы.
`library-mobile.spec.cjs`: три регрессии FAIL на исходном приложении.
Артефакты: `local/test-data/library-mobile-before-valid/`.

| Сценарий | API / cache | Наблюдение UI | Причина |
| --- | --- | --- | --- |
| Чистый вход, язык сервера en | me 200; decks 200 (2); folders 200 (2) | «Нет колод на языке Deutsch» | finishLogin сохраняет profile, но не применяет active_language; /init после интерактивного входа не повторяется |
| Восстановленная сессия, загрузка 500 | me 200; init 500, три попытки | «У вас пока нет колод» и toast ошибки | finally выставляет hasInitialized; store не различает успешный пустой ответ и ошибку |
| Повторный вход/запуск без сети | me 200; init network failure; init cache 2/2; Dexie пустая | Папки и колоды исчезают | API fallback возвращает локальные [] как успешный ответ; init перезаписывает store/cache пустотой |

`parent_id` из online API сериализуется null/int. UI для папок сравнивал
parent_id строго, в отличие от колод с `?? null`: старые кеши без parent_id
могли скрывать корневые папки. Это отдельная совместимость кеша, не доказанная
причина конкретного Brave. Account mismatch на Android также не доказан.

## Исправление и проверка

Исправления ограничены клиентом, регрессиями и документацией:

- Zustand различает подтверждённую сервером библиотеку (`ready`), сохранённые
  данные (`cached`) и ошибку (`error`); загрузка учитывается отдельно.
  HTTP 401 предлагает вход; 500/transport failure — повтор загрузки.
  Сообщение о пустом аккаунте появляется только после валидных server arrays.
- `/init` сохраняет retry; после исчерпания попыток допустим paired refresh
  через `/decks` + `/folders`. Ошибка любого списка сохраняет предыдущую пару.
- API помечает автоматический кеш и явный local mode отдельно. Пустая Dexie
  при сетевом сбое не считается пустым серверным аккаунтом; кеш не стирается.
  Локальные изменения в offline mode по-прежнему обновляют представление.
- `/me` восстанавливает learning language до загрузки библиотеки.
  Startup `/auth/sync` не пишет языковые defaults браузера в аккаунт.
  Root parent_id без поля совместим с null. Чужой/неидентифицированный кеш
  игнорируется без удаления. Поздние library responses старого аккаунта
  и init/profile responses прежней session revision отклоняются.
- Повторный вход сохраняет init cache. Не добавлены clear/reset пользовательской
  БД, изменения Dexie schema или SRS/прогресса. Ошибки загрузки логируют только
  статус, без Axios config/Authorization/профиля.

Результаты на финальном клиенте:

| Проверка | Результат |
| --- | --- |
| `library-mobile.spec.cjs`, critical, Pixel 7 Chromium | 10/10 PASS |
| `guest-entry.spec.cjs`, critical | 3/3 PASS |
| `offline.spec.cjs`, critical (без отдельного HTTP sandbox) | 13/13 PASS |
| `library_store_regression.mjs` | 7/7 PASS |
| `api_session_regression.mjs` | 10/10 PASS |
| `auth_store_regression.mjs` | 30/30 PASS |
| `auth_session_regression.mjs` | 6/6 PASS |
| `npm --prefix app test` | 523/523 PASS |
| `npm --prefix app run lint` и целевой ESLint после финальных правок | PASS |
| `npm --prefix app run build`, финальная сборка | PASS (предупреждения chunk size/dynamic imports) |
| `git diff --check` | PASS |

Три первоначальных FAIL получены на исходном коде приложения после исправления
mock `/messages`: его контракт в main — массив, прежние fixtures возвращали
объект и аварийно закрывали UI. В существующем guest fixture добавлен тот же
валидный ответ, assertions не ослаблены. Итоговый guest suite зелёный.

Безопасная трасса каждого мобильного теста:
`local/test-data/library-mobile-final/*/library-diagnostic.json`.
Содержит только синтетический account 101, endpoint/status/counts,
language и counts/status/error Zustand/cache; credentials не сохраняются.

| Сценарий после исправления | Трасса | Итог Zustand / cache |
| --- | --- | --- |
| Чистый вход + reload | init 401 до входа; me 200; decks 200/2; folders 200/2; после reload me/init 200/2/2 | ready, en, 2/2; cache account 101, 2/2 |
| init 500 | me 200; init 500 × 3; decks 200/2; folders 200/2 | ready 2/2, cache 2/2 |
| transport failure с пустой Dexie | me 200; library requests без HTTP-ответа | cached 2/2, error.status 0; cache 2/2 |
| повторный вход, все списки 500 | me 200; decks/folders 500 × 3 | cached 2/2, error.status 500; cache 2/2 |

Снимки ru/en при 320/375/430/1280px проверены на отсутствие горизонтального
переполнения; retry target ≥44px. Визуально просмотрены ru 320px, en 430px
и экран ошибки Pixel 7. Артефакты: `local/test-data/library-mobile-final/`;
финальные init guards дополнительно проверены в
`local/test-data/library-final-init-guards/` (2/2 PASS).
Последний UI guard оставляет ещё не подтверждённый аккаунт в загрузке;
вход, 500/retry и настоящий empty повторно проверены в
`local/test-data/library-final-ready-state/` (3/3 PASS), затем сборка успешна.

USB-устройство недоступно. Настоящие Chrome Android, Brave Android и Telegram
WebView не прогонялись; сравнение их account IDs и исходного network failure
остаётся открытым. Эмуляция не подтверждает конкретную причину инцидента на
этих устройствах. Backend/облачная схема не изменены и не тестировались live.
Полный release gate и backend suite в этой задаче не запускались.

Supabase, серверные данные, SRS/прогресс и миграции не изменены.
Commit/push/deploy не выполнялись. Production остаётся на 6101580.

Migration 90 в main отдельная от startup и применяется только явно;
production на 6101580 сообщает об отсутствии старого note storage через 503.
Это не доказательство применённой 90 или совместимости полного main с облаком.
Клиентское исправление использует прежние API-контракты 6101580 и не требует
новой схемы. Перед публикацией полного main по-прежнему нужен отдельный gate
совместимости реальной облачной схемы и migration 90.
