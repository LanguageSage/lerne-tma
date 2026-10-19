# Lerne → Game Test SSO

Реализация расширяет Auth v2 провайдером `lerne`. Production подтверждает
личность, Game Test создаёт собственную сессию и хранит собственные данные.
Supabase Auth и доступ из Game Test к Production PostgreSQL не используются.

## Поток и границы доверия

1. Game Test создаёт обычный Auth v2 challenge на 5 минут. Его случайный секрет
   остаётся в `sessionStorage` исходной вкладки, в БД хранится только хеш.
2. Та же вкладка открывает `/auth/lerne` основной Lerne с ID запроса и nonce.
   Существующая основная сессия восстанавливается; если её нет, используется
   обычное окно Auth v2 (email, Google или Telegram).
3. Пользователь явно нажимает «Подтвердить вход в Game Test». Основной backend
   проверяет строгую Bearer-сессию и подписывает Ed25519-подтверждение на 60 секунд.
   В нём только основной account ID, issuer, audience, request ID, nonce,
   timestamps, уникальный proof ID и версия формата. Пароли и сессионные токены
   основной Lerne не входят в подтверждение.
4. Фиксированный callback Game Test получает подтверждение во fragment URL.
   Отдельная страница без сторонних скриптов удаляет fragment из истории,
   сохраняет результат только при совпадении ID исходного запроса и открывает `/`.
5. Общий `/auth/v2/challenges/{id}/exchange` проверяет секрет вкладки, подпись,
   issuer/audience, nonce, request ID и срок. В одной транзакции расходует proof,
   находит/создаёт identity, создаёт локальную сессию и завершает challenge.

Связь хранится в `tma_auth_identity`: provider=`lerne`,
subject=`<issuer origin>#<canonical main account ID>`. Одинаковый email не является
основанием для объединения. У локальной учётной записи свой ID и свои данные.
Закрытый ключ знает только Production; открытый ключ в Game Test позволяет
только проверить подпись. Подтверждение, перехваченное без секрета исходной
вкладки, не завершит вход; повторный или параллельный exchange не выдаст вторую сессию.

## Настройки Vercel (после отдельного разрешения)

Одинаковые несекретные значения в **обоих проектах**:

| Переменная | Значение |
| --- | --- |
| `LERNE_SSO_ISSUER_ORIGIN` | `https://tma-amber.vercel.app` |
| `LERNE_SSO_CLIENT_ORIGIN` | `https://lerne-game-test.vercel.app` |

Используйте точный origin, без `/api`, пути, query или fragment. Если основной
домен изменится, сначала согласуйте issuer: он входит в постоянный subject.
Для размещённых версий требуется HTTPS. HTTP localhost разрешён только при
`ENVIRONMENT=development` без `VERCEL` — для локальной проверки.

| Проект | Дополнительные переменные |
| --- | --- |
| Production Lerne (`tma`) | `LERNE_SSO_ROLE=issuer`; **Secret** `LERNE_SSO_PRIVATE_KEY` — PEM Ed25519 |
| Game Test (`lerne-game-test`) | `LERNE_SSO_ROLE=client`; `LERNE_SSO_PUBLIC_KEY` — соответствующий public PEM; существующий `LERNE_DEPLOYMENT=game-test` |

Для стабильного Game Test это его Vercel environment **Production**; это не
основной Production-проект. Секреты не задаются через `VITE_*` и не попадают
в клиентскую сборку. PEM может содержать реальные переводы строк или `\n`.

Новую пару можно создать **один раз локально** через OpenSSL, записав в
игнорируемый `scratch/`; не перезаписывайте уже используемый ключ:

```powershell
openssl genpkey -algorithm ED25519 -out scratch/lerne-sso-private.pem
openssl pkey -in scratch/lerne-sso-private.pem -pubout -out scratch/lerne-sso-public.pem
```

Закрытый PEM передайте только в Secret основной Lerne через приватный ввод
Dashboard/CLI. Не выводите файл в логи и не коммитьте. Не используйте ключи из
`scratch/sso-browser-*`: это одноразовые ключи тестовых fixtures.
Без корректной конфигурации SSO отключён, обычный вход остаётся доступным.

Frontend каждой версии должен обращаться к своему `/api` (`VITE_API_URL=/api`).
В сборку включаются `app/public/lerne-sso-callback.html` и `.js`; правило
`vercel.json` отдаёт HTML отдельно от SPA с `Cache-Control: no-store`.
Дополнительная настройка CORS между проектами не нужна.

## Миграция только Game Test

Подготовлена явная миграция **89**: разрешить `lerne` в CHECK constraints двух
существующих таблиц identities/challenges. Новых таблиц и копирования данных нет.
Production для выдачи подтверждения не требует этой миграции: используются
существующие Auth v2 accounts/sessions. Автоматического запуска миграции нет.

После разрешения на изменение тестовой БД, со snapshot и явным DSN только
`rkkviifehykdeugovlgp`, выполните из корня репозитория:

```powershell
# GAME_TEST_DATABASE_URL задаётся приватно, без вывода значения.
python scripts/migrate_lerne_sso.py          # Только inspection
python scripts/migrate_lerne_sso.py --apply  # Только после проверки target/snapshot
```

Runner откажется от другого Supabase ref до подключения. PostgreSQL DDL,
проверка constraint и marker выполняются одной транзакцией с ограничением
ожидания lock. Повторный запуск безопасен; ошибка не записывается как успех.
Не откатывайте constraint на старую версию при наличии `lerne` identities:
для отключения уберите роль/ключ и скройте SSO, сохранив связи аккаунтов.

Миграция проверена на одноразовой SQLite (сохранение строк, уникальность,
повторный запуск, rollback). На удалённой PostgreSQL **не применялась**;
проверка именно PostgreSQL DDL на тестовой БД остаётся частью разрешённого rollout.

## Как проверить после разрешённой публикации

1. Сначала опубликуйте согласованные изменения issuer в основной Lerne и настройте
   её ключ. Затем примените миграцию 89 в Game Test и опубликуйте client с public key.
   Обычная Production-авторизация продолжает работать; пока SSO отключён, кнопки нет.
2. В браузере войдите в основную Lerne существующим аккаунтом. В той же вкладке
   откройте Game Test → «Войти через Lerne» → проверьте основной аккаунт → подтвердите.
   Новый пароль или повторная регистрация не запрашиваются.
3. Перезагрузите Game Test, затем выйдите из него и повторите SSO. Должны открыться
   тот же локальный аккаунт и его тестовый прогресс. В основной БД новых SSO-сессий
   и игровых данных не появляется.
4. Повторите в браузере без основной сессии: сначала обычный вход в Lerne,
   затем отдельное подтверждение. Проверьте отмену и возврат после reload
   страницы подтверждения. Повторите на телефоне в той же браузерной вкладке.
5. Уже существующий тестовый аккаунт можно сохранить: войдите в него старым способом
   и выберите Профиль → Способы входа → «Добавить Lerne» в течение 5 минут после
   входа. Если основная identity уже принадлежит другому тестовому аккаунту,
   система покажет конфликт и не объединит данные автоматически.

Локальные сессии используют существующие TTL/refresh/logout Auth v2. Выход из
основной Lerne не является выходом из Game Test. После сетевой ошибки Game
повторяет обмен до истечения подтверждения; отмена/подмена/повтор/истечение
заканчивают ожидание понятной ошибкой. Открытие callback в другой вкладке без
исходного запроса не авторизует пользователя.

## Локальные проверки

```powershell
python scripts/test_game_mvp3.py tests.test_lerne_sso tests.test_game_test_preparation scripts.tests.test_auth_foundation
node scripts/tests/auth_store_regression.mjs
node scripts/tests/auth_session_regression.mjs
node scripts/tests/test_api_silent_refresh.mjs
npx --no-install playwright test scripts/tests/browser/lerne-sso.spec.cjs --workers=1 --output=scratch/sso-browser-results
```

SSO browser test поднимает два backend-процесса на 8011/8012 с разными SQLite
в `scratch/`, настоящей временной парой ключей и одним существующим синтетическим
основным пользователем. Vite использует 5199: `localhost` — issuer,
`127.0.0.1` — client. Внешние запросы блокируются. Основной пароль существует только
в issuer DB; Game Test DB получает identity и обычные локальные сессии.

Алгоритм подписи использует [Ed25519 API библиотеки cryptography](https://cryptography.io/en/latest/hazmat/primitives/asymmetric/ed25519/).
Это узкое подтверждение личности для Auth v2, а не реализация OAuth/OIDC-сервера.
