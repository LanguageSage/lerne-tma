# Изолированная разработка LOCAL

Исходники: `C:\121\Lerne_projekt\tma`. Постоянные локальные данные:
`C:\121\Lerne_projekt\data`, вне Git. Production Supabase и Vercel для запуска не нужны.

## Подготовка и запуск

Нужны Python с зависимостями проекта, Node/npm и PostgreSQL 17 с клиентскими
утилитами. Для этой Windows-машины выбран **native PostgreSQL без Docker**;
порядок установки приведён ниже. Существующий Docker-вариант остаётся опциональным.
Программы автоматически не устанавливаются.

Из корня проекта в PowerShell:

```powershell
python -m venv venv                          # только если venv ещё нет
.\venv\Scripts\python.exe -m pip install -r requirements-test.txt
npm --prefix app ci
.\venv\Scripts\python.exe scripts/local_dev.py init
# Для нового конфига выберите driver=native и pg_bin по инструкции ниже.
.\venv\Scripts\python.exe scripts/local_dev.py init-native # один раз, после установки PostgreSQL
.\run_local.bat
```

`init` создаёт отсутствующие каталоги и `data\config\local.json` со случайными
локальными секретами. Существующий конфиг не перезаписывается. Новый конфиг пока
имеет `driver=docker`: перед native-запуском измените только `driver` и `pg_bin`.
БД `lerne_tma_local`, пользователь `lerne_local`, подключение `127.0.0.1:55432`.
Запуск поднимает PostgreSQL, применяет существующие модели/миграции, включая auth v2,
однократно добавляет синтетического пользователя `900000001`, две папки, две колоды
и карточки translation/quiz/theory. Повторный запуск сохраняет правки, удаления и прогресс.

API: `http://127.0.0.1:8001`, приложение: `http://127.0.0.1:5173`.
Оба порта должны быть свободны: чужие процессы не завершаются.
Браузер открывается автоматически; сверху виден баннер **LOCAL — тестовые данные**.
Вход под тестовым пользователем автоматический через отдельный локальный credential,
который Vite добавляет на серверной стороне. Секрет не включается в клиентский код.
Выдаются обычные отзываемые Bearer/refresh-токены auth v2; `X-User-ID` доступа не даёт.

Ctrl+C в окне запуска останавливает только запущенные им API и Vite. Данные PostgreSQL
сохраняются. Остановить саму БД без удаления данных:

```powershell
.\venv\Scripts\python.exe scripts/local_dev.py stop-db
```

## Где лежат данные

| Данные | Физическое/логическое место по умолчанию |
| --- | --- |
| PostgreSQL в Docker | Docker-managed volume **`lerne_tma_local_pgdata`**, PGDATA контейнера **`/var/lib/postgresql/data`** |
| PostgreSQL непосредственно в Windows | **`C:\121\Lerne_projekt\data\postgres`** |
| Медиа пользователей LOCAL | **`C:\121\Lerne_projekt\data\media`**, подпапки `images`, `audio`, `videos`, `backgrounds` |
| Резервные копии БД | **`C:\121\Lerne_projekt\data\backups\lerne-local-<UTC timestamp>.dump`** |
| Тестовые файлы / старый offline sandbox | **`C:\121\Lerne_projekt\data\test-data`** |
| Конфигурация и локальные секреты | **`C:\121\Lerne_projekt\data\config\local.json`** |

Docker использует Linux-файловую систему своей VM; PGDATA не монтируется с NTFS.
После создания тома точный Linux mountpoint выводит `local_dev.py paths` или
`docker volume inspect lerne_tma_local_pgdata --format '{{.Mountpoint}}'`.
Физический Windows-файл диска VM определяется в Docker Desktop → Settings → Resources
→ Advanced → Disk image location. Его путь зависит от установки; не следует считать
`data\postgres` местом Docker-данных. Не выполняйте `docker compose down -v` или
`docker volume rm`, если данные нужны. Для PostgreSQL 17 используется путь тома,
описанный в [документации официального образа](https://hub.docker.com/_/postgres).

Состояние на 21 октября 2026: PostgreSQL не обнаружен в PATH, стандартных каталогах,
реестре установок, службах и процессах Windows. Порты 5432/55432/8001/5173 свободны.
Внешний конфиг подготовлен для `driver=native` и
`pg_bin=C:\121\Lerne_projekt\tools\pgsql\bin`; подключение — только
`127.0.0.1:55432`, отдельные роль `lerne_local` и БД `lerne_tma_local`.
Каталог `data\postgres` пуст. Кластер и PostgreSQL-дампы ещё **не созданы**.

## PostgreSQL непосредственно в Windows

### Установка файлов PostgreSQL пользователем

1. Откройте [официальную страницу PostgreSQL для Windows](https://www.postgresql.org/download/windows/)
   и её ссылку **zip archive**, ведущую на
   [PostgreSQL Binaries от EDB](https://www.enterprisedb.com/download-postgresql-binaries).
   Скачайте **PostgreSQL 17, Windows x86-64** (последний доступный выпуск 17.x;
   на момент проверки на странице указан 17.11). Это обычный PostgreSQL для Windows,
   без Docker. Архив нужен потому, что кластером уже управляет `local_dev.py`.
2. Через Проводник создайте `C:\121\Lerne_projekt\tools` и распакуйте туда архив.
   Итоговые пути должны быть **`C:\121\Lerne_projekt\tools\pgsql\bin\initdb.exe`**
   и **`C:\121\Lerne_projekt\tools\pgsql\bin\pg_ctl.exe`**. Не распаковывайте файлы
   в репозиторий `tma` или в каталог рабочих данных `data\postgres`.
3. В обычном PowerShell проверьте:

   ```powershell
   & 'C:\121\Lerne_projekt\tools\pgsql\bin\psql.exe' --version
   & 'C:\121\Lerne_projekt\tools\pgsql\bin\initdb.exe' --version
   & 'C:\121\Lerne_projekt\tools\pgsql\bin\pg_dump.exe' --version
   & 'C:\121\Lerne_projekt\tools\pgsql\bin\pg_restore.exe' --version
   ```

   Утилиты должны вывести `PostgreSQL 17.x`. После распаковки сообщите агенту,
   что файлы готовы; пароль присылать не нужно. Если Windows требует права
   администратора или сообщает об отсутствующей DLL, передайте точный текст:
   установку системных компонентов выполняет пользователь.

Windows-служба, pgAdmin, Stack Builder и ручное создание БД не нужны.
Агент не запускает установщики с правами администратора. Рабочий кластер создаётся
следующим шагом в `C:\121\Lerne_projekt\data\postgres` и слушает только
`127.0.0.1:55432`; роль/пароль и БД независимы от Production.

### Конфигурация и первый запуск

На этой машине внешний конфиг уже подготовлен. Для новой установки после `init`
измените локально `C:\121\Lerne_projekt\data\config\local.json`:

- `driver`: `native`;
- `pg_bin`: `C:\121\Lerne_projekt\tools\pgsql\bin` для архива выше или абсолютный
  путь к `bin` вашей установки (в JSON обратные слеши удваиваются);
- `database_url`: оставьте отдельный URL с `127.0.0.1:55432`, имя БД `lerne_tma_local`
  и случайный пароль из созданного конфига.

```powershell
.\venv\Scripts\python.exe scripts/local_dev.py init-native # только для пустого PGDATA
.\run_local.bat
```

`init-native` выполняет `initdb` только в **пустом** `data\postgres`, задаёт
SCRAM-пароль, loopback listen address и порт, запускает кластер и создаёт тестовую БД.
Существующий кластер не очищается. Для уже подготовленного собственного кластера
укажите его внешний путь `postgres` и URL в конфиге; запуск проверяет фактический
`SHOW data_directory` и отказывается работать при несовпадении. Непомеченная непустая
БД не изменяется. Роль должна владеть локальной БД и иметь права на создание схемы.

## Настройки

Обычные `.env` проекта и `app/.env*` в LOCAL не загружаются. Облачные credentials
не наследуются процессами запуска. `LERNE_MODE=LOCAL` включается явно процессом.
При неверном режиме, внешнем URL, URL options или недоступной БД запуск прекращается.

`LERNE_DATA_ROOT` меняет корень данных; `LERNE_LOCAL_CONFIG` — абсолютный путь к
внешнему JSON. Поля JSON `media`, `backups`, `test_data`, `postgres` меняют отдельные
каталоги. Соответствующие переменные `LERNE_LOCAL_MEDIA_DIR`,
`LERNE_LOCAL_BACKUPS_DIR`, `LERNE_LOCAL_TEST_DATA_DIR`, `LERNE_LOCAL_POSTGRES_DIR`
имеют приоритет; `LERNE_LOCAL_DATABASE_URL` переопределяет только локальный URL.
Все пути должны быть абсолютными и находиться вне репозитория, включая symlink/junction.
Для Docker оставьте пользователя `lerne_local`; после создания тома смена пароля в
JSON сама по себе не меняет пароль внутри PostgreSQL.

Конфиг, реальные данные, пароли и дампы нельзя добавлять в Git. В репозитории
хранятся только код, Compose и инструкции. Старые exports, уже лежащие в `data`,
LOCAL не читает и не импортирует.

## Backup, восстановление и отдельный сброс

При работающей локальной БД:

```powershell
.\venv\Scripts\python.exe scripts/local_dev.py backup
.\venv\Scripts\python.exe scripts/local_dev.py paths
```

Backup проверяет localhost URL и marker тестовой БД, запускает `pg_dump` в custom
format и публикует `.dump` только после успешного завершения. Неуспешный `.partial`
удаляется. Пароль передаётся через окружение, а не аргументы командной строки.
`scripts/backup_local.py` вызывает ту же команду. Формат выбран по
[документации pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).

Остановите API/Vite перед восстановлением или сбросом, оставив PostgreSQL включённым:

```powershell
.\venv\Scripts\python.exe scripts/local_dev.py restore 'C:\121\Lerne_projekt\data\backups\lerne-local-<timestamp>.dump'
# Отдельная команда сброса только тестовой схемы:
.\venv\Scripts\python.exe scripts/local_dev.py reset
```

Обе команды требуют вручную ввести **`lerne_tma_local`**; автоматического `--yes`
нет. Перед изменением создаётся новый recovery backup. Restore предварительно
проверяет архив и использует `pg_restore --clean --if-exists --single-transaction
--exit-on-error --no-owner --no-acl`: ошибка откатывает восстановление, как описано
в [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).
Используйте только свои доверенные локальные дампы.
Reset удаляет только `public` в проверенной тестовой БД, затем создаёт схему и seed.
Медиа при сбросе БД не удаляются. SQL-дамп содержит БД и media records, сами файлы
медиа лежат отдельно: для полного переноса сохраните также `data\media` и внешний
конфиг. После restore/reset удалите в DevTools → Application → IndexedDB только
`LerneTestDB_*` и очистите ключи localStorage с префиксом `lerne_local:`, чтобы старая
offline-очередь не вернула изменения. Обычные `LerneLocalDB_*` и cloud-сессию сохраняйте.

## Что доступно и что изолировано

Доступны существующие CRUD папок/колод/карточек, bulk-import и Markdown,
детерминированные упражнения, обучение/SRS, локальные uploads и entity sync
**только с локальным API**. Browser session/cache имеют отдельные ключи
`lerne_local:*`, IndexedDB — `LerneTestDB_<user_id>`; legacy/cloud БД не импортируется.

ИИ, Edge TTS, Telegram/Google/Lerne SSO, bot/webhook, облачная синхронизация и
Supabase Storage недоступны. Отсутствующее локальное медиа возвращает 404 без
облачного redirect. Backend запрещает внешние DNS/connect/UDP, PostgreSQL отдельно
проверяется до подключения (libpq не использует Python sockets). Vite использует
только `/api` на loopback, убирает Telegram SDK и внешние шрифты, CSP запрещает
внешние запросы браузера. LOCAL запрещён на Vercel/в Production и не собирается
в deployable frontend. Обычный Production/Game Test работают без флага LOCAL.

## Проверки

```powershell
.\venv\Scripts\python.exe scripts/test_backend.py
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
# После local_dev.py init; порты 5173/8001 свободны, API полностью замокан:
npx --no-install playwright test --config playwright.local.config.cjs
```

`test_local_dev.py` проверяет URL/пути, конфигурацию, запреты Production/сети,
подтверждение reset, отказ при частичном dump, параметры восстановления, настоящие
auth dependencies/Bearer logout, CRUD/Markdown/SRS, повторный seed и локальное медиа
на синтетических SQLite fixtures. Browser-проверка проверяет LOCAL Vite, отдельные
сессии/IndexedDB, отсутствие внешних запросов и баннер на 320/375/430/768/1280 px;
API-ответы синтетические. Это **не** проверка работающего PostgreSQL.

Проверено 21 октября 2026 без PostgreSQL: все 21 изолированный backend-набор
(292 теста, включая 19 тестов LOCAL на SQLite), 438 frontend-тестов,
ESLint изменённых JS/JSX-файлов и `vite.config.js`, компиляция 16 Python-файлов,
browser-проверка LOCAL с mock API (все пять ширин, без внешних запросов и без
использования синтетического cloud-токена). Снимки баннера просмотрены.
Данные/конфиги/дампы защищены `.gitignore`, отслеживаемых таких файлов не найдено.

До установки PostgreSQL остаются непроверенными: создание/миграции настоящего
PG-кластера, CRUD и импорт на PostgreSQL, сохранение после перезапуска настоящей БД,
реальные pg_dump/pg_restore и reset с подтверждением, полный UI → API → PostgreSQL.
После установки проверьте эти сценарии с синтетическими данными; Production
credentials для этого не нужны. Коммит и push в `main` выполняются после успешного
завершения этих интеграционных проверок.

## Оставшиеся задачи перед переносом в main

- [ ] Установить PostgreSQL 17 в Windows.
- [ ] Создать локальный кластер PostgreSQL и тестовую БД.
- [ ] Проверить полный цикл UI → API → PostgreSQL.
- [ ] Проверить backup/restore и сохранение данных после перезапуска PostgreSQL.
- [ ] Подтвердить, что приложение и проверки не обращаются к Production.
- [ ] После успешного завершения всех проверок перенести решение в `main`.
