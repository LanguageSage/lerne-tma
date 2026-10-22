# LOCAL: изолированное окружение разработки

## Primary entry points

- `run_local.bat`, `scripts/local_dev.py`, `compose.local.yaml` — lifecycle PostgreSQL/API/Vite, seed, backup/restore/reset.
- `api/local_runtime.py` — внешний config/data root, строгий URL и запрет внешней сети.
- `api/database.py`, `api/models.py`, `api/main.py` — отдельный LOCAL database path, существующая схема/auth migrations и fail-closed startup.
- `api/routers/local.py`, `api/auth/service.py:login_local_test` — локальный credential → существующая отзываемая Bearer-сессия.
- `app/vite.config.js`, `app/src/utils/localMode.js`, `utils/auth.js`, `services/localDb.js` — loopback proxy/CSP, namespace сессий и Dexie.

## Source of truth / Data flow

`data/config/local.json` вне Git → валидированные localhost параметры → существующие Peewee models/migrations → синтетический seed с durable marker.
По умолчанию данные вне repo в `C:\121\Lerne_projekt\data`; PGDATA Docker принадлежит Docker volume `lerne_tma_local_pgdata`, native PGDATA — `data/postgres`.
Для текущей Windows-машины выбран native: бинарные файлы `C:\121\Lerne_projekt\tools\pgsql\bin`, подключение `127.0.0.1:55432`, PGDATA `C:\121\Lerne_projekt\data\postgres`; внешний конфиг подготовлен, PostgreSQL ещё требуется установить по `docs/LOCAL_DEVELOPMENT.md`.
Uploads → `data/media` + metadata в `TMAMedia`; чтение только `/api/media`, missing → 404. Обычная cloud media policy не меняется.
LOCAL Vite добавляет login credential только для разрешённого Origin и только для local login; браузер хранит обычные auth v2 tokens отдельно (`lerne_local:*`).
Offline entities принадлежат `LerneTestDB_<user_id>` и синхронизируются только с loopback API; production/legacy Dexie не импортируется.
Сброс/restore — отдельные CLI actions с ручным подтверждением, marker БД, recovery backup; startup seed не восстанавливает удалённые пользователем объекты.

## Verification

`scripts/test_backend.py scripts/tests/test_local_dev.py`; `playwright.local.config.cjs` / `scripts/tests/browser/local-mode.check.cjs` (mock API, реальный LOCAL Vite).
Полные команды, native setup, ограничения и точные пути: `docs/LOCAL_DEVELOPMENT.md`.
Нельзя считать SQLite/mock-browser проверки доказательством работоспособности PostgreSQL или реального backup/restore.
