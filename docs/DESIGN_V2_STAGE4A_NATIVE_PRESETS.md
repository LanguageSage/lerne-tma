# Design V2: нативные встроенные пресеты — этап 4A

Дата: 2026-10-30. Ветка: codex/design-v2-personal-migration.

## Изменение

Все 10 встроенных пресетов перенесены из flat V1 definitions в appConstants
в `app/src/design/designPresets.js`. Конфигурации заданы непосредственно
V2-полями; пропуски заполняет существующий normalizeDesignConfig.
DesignToolbar читает их напрямую. Удалены legacyPresetToDesignConfigV2,
adaptDesignPresetsToV2 и V1 definitions встроенных пресетов.
ID, порядок и названия сохранены; названия читаются через прежний tr/getter.
Применение по-прежнему затрагивает только front/back/cardList и отменяется
существующим Undo. Личный preset остаётся в прежнем меню.

Перед изменением сохранён полный результат старого конвертера для каждого
пресета в ignored `local/test-data/design-v2-builtins-before.json`.
После переноса deepEqual подтвердил совпадение всех 10 полных документов,
включая наследованные шрифты, auto context, фоны, упражнения и список.
В designPresets.test.js закреплены SHA-256 канонических полных документов:
проверяются все поля и порядок, а не только названия или число пресетов.
Пять тестов удалённых функций заменены этой проверкой всех реальных пресетов;
тесты миграции личных настроек и восстановления сохранены.

## Оставшиеся зависимости и границы удаления

| Зависимость | Причина сохранения / следующий шаг |
| --- | --- |
| legacyAdapter: migrateLegacyDesignSettings, defaults, storage map | Первичная миграция старого клиента и восстановление V1 backup; встроенные пресеты от него больше не зависят |
| personalDesignMigration и scoped local records | Рабочий протокол backup/pending/CAS/ack, смена аккаунта и recovery; это механизм переноса, не второй runtime оформления |
| V1 localStorage keys и server flat fields | Источники ещё не обновившихся клиентов; удаление требует проверки rollout и восстановления на разрешённом PostgreSQL |
| Legacy getCardStyle/getBackCardStyle/getContextStyle и fallback в study components | Отдельный следующий перенос runtime: проверить все входы компонентов и гарантированный effective V2, затем заменить fallback и удалить функции |
| V2 background mode legacy и пустые card backgrounds | Совместимость сохранённых V2 JSON и наследование личных фонов; публикация ревизии 23 сама по себе не делает все старые JSON ненужными |
| Deprecated exercises.bodyText/paletteMode | Сохранённые данные, удалять после проверки normalizer/import/export и миграции этих значений |
| Legacy формат учебного контента | Вне миграции оформления |

Этап не удаляет пользовательские записи, backups, старые storage keys
или runtime fallback. Production publication ревизии 23 остаётся прежней.
Для удаления старых хранилищ одной публикации недостаточно: нет подтверждённой
проверки восстановления реального PostgreSQL и переноса всех клиентов.

## Проверки

- Полное сравнение старого и нового результата: 10/10 документов совпали.
- Design unit suites: 71/71 PASS.
- Штатный полный `npm --prefix app test`: 563/563 PASS.
- ESLint семи изменённых JS/JSX-файлов: PASS.
- Isolated production build: PASS; прежние chunk/dynamic-import warnings.
- Browser: 3/3 PASS: применение/Undo встроенного пресета, приоритет публикации
  и личного preset, offline reload/reconnect и сохранение личного preset.
- git diff --check: PASS.

Первый запуск Node test runner был заблокирован spawn EPERM. Режим без
изоляции прошёл design suites с флагом module mocks, но при полном наборе
обнаружил утечку mock fetch между существующими тестами. Финальный полный
запуск выполнен штатно с изоляцией процессов и прошёл 563/563.
Vite/Playwright также потребовали разрешённого запуска дочерних процессов.

Browser использовал локальный Vite и подменённый API с блокировкой внешней
сети; production записи не менялись. CSS/layout не менялись; отдельная
визуальная сверка screenshots и физические устройства не проверялись.
Артефакты: ignored local/test-data/design-v2-stage4-*.log и Playwright report.
Изменения этого этапа не закоммичены и не развёрнуты.
