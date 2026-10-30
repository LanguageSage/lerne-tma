# Design V2 — этап 4D: runtime store и PostgreSQL recovery

Дата: 2026-10-30. Локальные изменения, без commit/push/deploy.

## Что удалено

- Flat V1 design fields и userDesign больше не создаются и не обновляются в useSettingsStore. Серверный snapshot проходит через personalDesignMigration в V2; параллельная flat-копия удалена.
- Store больше не импортирует и не реэкспортирует DEFAULT_DESIGN_SETTINGS/DESIGN_STORAGE_MAP и не вызывает конвертер. Импорт личного оформления в admin draft использует личный V2 или defaults V2.
- StudyView/TrainerView наследуют пустой фон от personalDesignV2, без flat cardBgFront/cardBgBack.
- exercises.bodyText и exercises.paletteMode удалены из defaults/schema. Они нигде не использовались runtime. Нормализация старого документа отбрасывает эти два поля; остальные известные поля сохраняются. Серверные записи массово не переписывались. Исторические hashes пресетов сохранены: тест восстанавливает только эти два прежних default-поля перед сравнением.

## Реальный PostgreSQL

Новый runner scripts/tests/personal_design_postgres.py создаёт временный native PostgreSQL cluster внутри local/test-data, использует только 127.0.0.1 и синтетические данные, очищает конфигурацию внешних сервисов и останавливает кластер в finally. Существующие LOCAL/production базы не затрагиваются. Артефакты остаются для проверки.

Команда: `python scripts/tests/personal_design_postgres.py --bin-dir C:/121/Lerne_projekt/tools/pgsql/bin`.

Успешный прогон: local/test-data/personal-design-pg-659343f90a2a48f98c078fb877de7324/result.json.

- 7 серверных тестов на PostgreSQL: точный backup, idempotency, старый клиент, CAS, rollback backup+target, повреждённый источник, account permissions, restore новой ревизией.
- Две одновременные записи одной ревизии: ровно один успех и один HTTP 409.
- pg_dump/pg_restore в другую новую БД: settings и точный исходный backup совпадают.
- Реальный JS migrateLegacyDesignSettings преобразует восстановленный backup; запись результата создаёт ревизию 3, возвращает Georgia/liquid_emerald и сохраняет исходный backup.

## Остаток Legacy и граница удаления

Runtime оформления теперь не зависит от flat V1 store. Конвертер импортирует только personalDesignMigration (и тесты): он необходим для первого открытия старого клиента, первого server snapshot и явного восстановления старых backups. Удалять его при сохранении этих функций нельзя. Исходные localStorage keys и старые серверные JSON-поля сохранены; массовое удаление production данных не выполнялось и не авторизовано. Для полного прекращения приёма V1 нужен отдельный cutoff после rollout и проверка охвата миграцией аккаунтов. Backups сохраняются независимо от cutoff.

Поля global.background.mode=legacy, appBg, glassBg/glassBorder — действующий формат старых V2 документов. Они требуют собственного преобразования V2; к flat V1 runtime не относятся.

## Проверки

- Полный `npm test`: PASS; Design subset — 75 тестов PASS, включая новые регрессии отсутствия flat store и удаления deprecated полей.
- 21 browser scenario personal-design-migration/design-runtime-v2: PASS; в том числе наследование фона, все типы карточек, offline, смена аккаунта, local/server restore.
- Targeted ESLint и py_compile runner: PASS.
- Isolated Vite build в local/test-data/design-v2-stage4d-build: PASS (предупреждения о смешанных static/dynamic imports).
- git diff --check: PASS.
- Отдельный визуальный просмотр новых screenshots этого этапа не выполнялся; изменения сохраняют существующее отображение, browser assertions проверяют typography/background/interaction.
