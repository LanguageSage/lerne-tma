# Design V2 — этап 4C: редакторы, список и настройки

Дата: 2026-10-30. Изменения локальные; commit/push/deploy не выполнялись.

## Реализация

- CardForm использует только V2 answer/context typography; удалены flat V1 стили и зависимости auto-resize от них.
- CardContentEditor больше не принимает запасной textStyle: предпросмотр берёт front.mainText V2.
- CardList использует V2 typography, фон и lines; при отсутствии активного документа — defaults V2.
- CardForm и Front/Back/ExerciseDesignSection наследуют пустой background от личного V2, без обращения к flat cardBgFront/cardBgBack. Само наследование сохранено.
- CardListDesignSection использует V2 default вместо previewCardBg.
- Markdown browser fixture задаёт оформление нативным V2; проверки конкретных font/color/size сохранены.

## Оценка оставшихся зависимостей

`exercises.bodyText` и `exercises.paletteMode` присутствуют только в defaults/schema (кроме тестов). Runtime и редакторы их не читают. Удаление из нормализатора изменит экспорт/сохранение документов: отложено до отдельной миграции сохранённых V2 с проверкой восстановления. `exercises.baseColor` остаётся рабочим полем гармонизации Quiz.

`global.background.mode = legacy` относится к старым документам V2, а не к V1 store: designTokens использует global.appBg. Аналогично пустые panels.color/borderColor используют global.glassBg/glassBorder; GeneralDesignSection читает alpha этих цветов. Удалять эти ветви без преобразования существующих V2 нельзя.

`legacyAdapter.js` нужен personalDesignMigration (чтение локального источника, первого server snapshot, старого userDesign preset) и useSettingsStore (defaults/storage map, восстановление источника, явный importLegacyPersonalDesign). Встроенные пресеты и runtime typography больше не нуждаются в конвертере. Удаление конвертера сейчас нарушит безопасную миграцию/восстановление.

Legacy-хранилища, backups и серверные механизмы миграции сохранены. Восстановление на реальном тестовом PostgreSQL не проверялось. Формат учебного контента не затронут.

## Проверки

- Design unit tests: 73 PASS.
- ESLint затронутых JSX: PASS.
- Редактор исходника: 14 browser scenarios PASS (включая responsive и сохранение draft/selection/undo).
- Markdown и настройки: 16 browser scenarios PASS (320/375/430/768/1080 px, reduced motion, ошибки сохранения/публикации, keyboard, preview isolation, пресеты).
- Просмотрены screenshots полей редактора и controls настроек на 375 px. Полный визуальный просмотр всех screenshots не выполнялся.
- git diff --check: PASS. Полная сборка и полный suite повторно не запускались.
- Первый Markdown прогон выявил устаревший V1 fixture (Georgia ожидался при настройке flat полей); fixture переведён на V2 без ослабления assertions.
