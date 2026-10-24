# LOCAL: изолированное окружение разработки

## Primary entry points

- `run_local.bat`, `scripts/local_dev.py` (совместимый вход), `local/dev.py`, `local/compose.yaml` — lifecycle PostgreSQL/API/Vite, seed, backup/restore/reset.
- `local/runtime.py` — внешний config/data root, строгий URL и запрет внешней сети; `api/local_runtime.py` — ленивый production-safe адаптер режима.
- `api/database.py`, `api/models.py`, `api/main.py` — отдельный LOCAL database path, существующая схема/auth migrations и fail-closed startup.
- `local/router.py`, `api/auth/service.py:login_local_test` — локальный credential → существующая отзываемая Bearer-сессия.
- `lerne-admin:src/lerne_admin/services/deck_import.py`, `lerne-admin:src/lerne_admin/services/deck_import_media.py`, `lerne-admin/run_admin.bat` — preview/apply folder importer в LOCAL и сохранение медиа в LOCAL data root.
- `app/vite.config.js`, `app/src/utils/localMode.js`, `utils/auth.js`, `services/localDb.js` — loopback proxy/CSP, namespace сессий и Dexie.

## Source of truth / Data flow

`data/config/local.json` вне Git → валидированные localhost параметры → существующие Peewee models/migrations → синтетический seed с durable marker.
По умолчанию данные вне repo в `C:\121\Lerne_projekt\data`; PGDATA Docker принадлежит Docker volume `lerne_tma_local_pgdata`, native PGDATA — `data/postgres`.
Для текущей Windows-машины выбран native: бинарные файлы `C:\121\Lerne_projekt\tools\pgsql\bin`, подключение `127.0.0.1:55432`, PGDATA `C:\121\Lerne_projekt\data\postgres`; установлен PostgreSQL 17.11, реальная БД/миграции/импорт/перезапуск/backup/restore проверены; подробности в `docs/LOCAL_DEVELOPMENT.md`.
Uploads → `data/media` + metadata в `TMAMedia`; чтение только `/api/media`, missing → 404. Обычная cloud media policy не меняется.
Folder importer использует существующие card IDs и права в каждой выбранной базе. В LOCAL его admin-процесс запускается отдельно на loopback с очищенным окружением; медиа пишутся в `data/media`, Supabase Storage не вызывается. Один исходник для LOCAL и Supabase импортируется двумя независимыми preview/apply циклами; IDs, preview tokens, receipts и транзакции принадлежат каждой БД отдельно.
LOCAL Vite добавляет login credential только для разрешённого Origin и только для local login; браузер хранит обычные auth v2 tokens отдельно (`lerne_local:*`).
Offline entities принадлежат `LerneTestDB_<user_id>` и синхронизируются только с loopback API; production/legacy Dexie не импортируется.
Сброс/restore — отдельные CLI actions с ручным подтверждением, marker БД, recovery backup; startup seed не восстанавливает удалённые пользователем объекты.

## Verification

`scripts/test_backend.py scripts/tests/test_local_dev.py`; `playwright.local.config.cjs` / `scripts/tests/browser/local-mode.check.cjs` (mock API, реальный LOCAL Vite).
Полные команды, native setup, ограничения и точные пути: `docs/LOCAL_DEVELOPMENT.md`.
Нельзя считать SQLite/mock-browser проверки доказательством работоспособности PostgreSQL или реального backup/restore.

`local/` хранится в Git, исключён из Vercel целиком. API вне LOCAL не импортирует
этот пакет и не читает local.json; production URL отвергает loopback и имя
lerne_tma_local. Модели и миграции остаются в TMA; административный импортёр находится в lerne-admin и использует общие сервисы через установленный lerne-tma-core.

## Управляемый перенос и публикация

- Контракт, конфигурация и ограничения: [MATERIAL_TRANSFER](../../docs/MATERIAL_TRANSFER.md).
- LOCAL admin `/api/admin/transfer/*` → `lerne-admin:src/lerne_admin/routers/material_transfer.py` →
  отдельный `lerne-admin:src/lerne_admin/transfer_worker.py`. Очищенное окружение, внешний
  `config/transfer.json`, проверенный LOCAL URL/marker, TLS и совпадающий Supabase
  project_ref. Никаких migrations/startup init; облачная запись выключена без
  явного серверного флага и подтверждения preview.
- `/transfer/catalog`: серверный кеш 300 с с объединением запросов и cooldown 10 с
  для ошибок; смена конфигурации/успешная запись инвалидируют кеш.
- `/transfer/preview` возвращает 202; `/transfer/previews/{id}` читает только
  локальное состояние фоновой проверки. Одинаковые проверки переиспользуются
  300 с, ошибки — 10 с. Размер пакета проверяется до snapshots карточек.
- `services/material_transfer.py`: проекции контента, прежний collaborative resolver,
  ID ledger/версии/preview/jobs через существующий TMAOfflineBatch, atomic target
  content + receipt и replay после потери ответа; source/target freshness.
- `services/material_transfer_media.py` расширяет прежний deck_import_media:
  source revisions, immutable SHA-256 assets, LOCAL media root/TMAMedia, конечный
  перенос без автоматических повторов. Пользователи, SRS, grants и auth не копируются.
- LOCAL API/admin сохраняют network guard. Только отдельный worker подключается
  к явно указанной облачной цели. Переключать Peewee proxy в HTTP-процессе запрещено.
- `local/router.py:/local/transfer-card/{id}` + `LocalPublishButton.jsx`: проверка
  локального автора/permissions, сохранение редактора и существующий Dexie sync,
  затем admin с выбранной карточкой. Сам переход ничего не публикует.
- Проверки: `test_material_transfer.py`, `test_material_transfer_boundary.py`,
  `run_material_transfer_postgres.py` (новый временный native PG cluster),
  `browser/admin-transfer.spec.cjs` (8061, две SQLite, simulated bridge).
