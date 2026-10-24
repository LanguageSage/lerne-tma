# Управляемый перенос материалов: отдельный проект lerne-admin

Контракт и операторские инструкции перенесены в `lerne-admin/docs/MATERIAL_TRANSFER.md`.
Запуск и внешняя конфигурация: `lerne-admin/README.md`.
Граница TMA ↔ admin: [.agents/ADMIN_ARCHITECTURE.md](../.agents/ADMIN_ARCHITECTURE.md).

TMA сохраняет общие модели, permissions, авторские сервисы, LOCAL runtime и
HTTP-переход из LOCAL UI на `http://127.0.0.1:8050`. Этот переход не публикует
материалы. Конфигурация `data/config/local.json`, `data/config/transfer.json`,
ledger/receipts в существующей БД и данные остаются на прежних местах.
