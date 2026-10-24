# Админка вынесена в lerne-admin (этап 1)

Исходники и полный реестр функций: отдельный проект
`C:\121\Lerne_projekt\lerne-admin`, `src/lerne_admin/`.
Архитектура и зависимости: `lerne-admin/docs/ARCHITECTURE.md`,
`lerne-admin/docs/DEPENDENCIES.md`; запуск: `lerne-admin/README.md`.

TMA предоставляет устанавливаемый `lerne-tma-core==0.1.1` (`pyproject.toml`):
пакеты `api` и `local`. Модели, права, сервисы автора/контента/CEFR/медиа остаются
единственными источниками бизнес-правил в TMA. Админка устанавливает этот
checkout через `pip -e`; относительных sys.path/cwd связей между проектами нет.
`scripts` и React-клиент админке для runtime не нужны. Админских Python-импортов
в TMA нет; LOCAL UI сохраняет разрешённый HTTP-переход на loopback 8050.

Старые `run_admin.bat`, `local_dev.py admin`, `tools/admin`, админские тесты и
fixtures удалены после проверки нового проекта. Вместо них запускайте
`lerne-admin/run_admin.bat` из нового проекта; настройка путей и отдельного
окружения выполняется его `setup.ps1`.

Checkpoint/config перемещены вне Git в `data/admin` без изменения байтов.
LOCAL DB, медиа, бэкапы, `config/local.json` и `config/transfer.json` сохраняют
прежнее расположение. Облачный env подключается явно по пути без копирования.
Схема, seed и миграции при запуске админки не применяются.

Админские HTTP/unit/browser проверки принадлежат новому проекту. Проверки
permissions TMA (`test_admin_permissions.py`), LOCAL и общего авторского сервиса
остаются здесь. Maintenance Storage migration tests выделены из прежнего
смешанного набора в `scripts/tests/test_media_storage_migration.py` и включены
в обычный backend gate TMA.

Следующий этап: выделить публичные версии доменных контрактов и конфигурации
из `api`/`local.runtime`, убрать приватные импорты и legacy backup/audio paths,
выпустить самостоятельный shared package. Сейчас editable TMA обязателен.

Завершающий аудит: [docs/ADMIN_EXTRACTION_AUDIT.md](../docs/ADMIN_EXTRACTION_AUDIT.md). Core в админке закреплён точным SHA и проверяется при bootstrap/старте; clean checkout tests не требуют private config. Production source manifest проверяет scripts/verify_deploy_files.py.
