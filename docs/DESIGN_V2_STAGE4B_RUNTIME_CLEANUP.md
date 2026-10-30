# Design V2: удаление Legacy runtime стилей — этап 4B

Дата: 2026-10-30. Продолжение этапа 4A в той же рабочей ветке.

## Изменение

Удалены getCardStyle/getBackCardStyle/getContextStyle из utils/cardStyles.js.
StudyCard, Quiz, Match, WordBank, Free Text/Edit, Puzzle, Trainer, Speech и
TrainerView используют getDesignStylesFromV2 напрямую. Удалены условные
V1-ветви шрифтов, цветов, размеров, alignment и lineHeight; V2-стили и
семантические цвета состояний остаются прежними.

StudyView и TrainerView больше не подписываются на flat V1 typography и
не собирают styleSettings для передачи в карточки. ExerciseRenderer больше
не передаёт flat styles дочерним упражнениям. StudyCardSpeech читает V2
самостоятельно для speech follow-up. Учебная логика, parsing, SRS, оценивание,
распознавание речи и контракты хранения не менялись.

resolveActiveDesign теперь возвращает нормализованный V2 даже без personal,
published и preview документов. getDesignStylesFromV2(null/undefined)
возвращает стандартные роли V2 для безопасных самостоятельных вызовов.
ExerciseRenderer и Speech трактуют явный null config как выбор активного V2;
включить V1 передачей null больше нельзя. Browser test этого входа теперь
проверяет сохранение активной V2 typography для трёх типов упражнений,
несмотря на конфликтующие flat V1 props.

Пустой V2 background по-прежнему наследует личный фон: CardBackground и
resolveActiveDesign сохраняют это поведение. Legacy источники миграции,
backups, converter личного оформления и формат учебного контента не удалены.
Следующий аудит: оставшиеся flat чтения в common editor/list/settings,
deprecated V2 поля и условия удаления источников хранения.

## Проверки и ограничения

Добавлены unit regression для null/undefined style input и отсутствия всех
источников runtime config. Проверки миграции теперь сравнивают результат с
явными ожидаемыми значениями, вместо вызова удалённого V1 renderer.
Первый запуск выявил оставшиеся test imports удалённых функций и прежнее
ожидание null; эти проверки обновлены под новый контракт без V1 runtime.

- Полный app suite: 565/565 PASS.
- Frontend regressions: 88/88 PASS.
- ESLint затронутых JS/JSX: PASS.
- Isolated production build: PASS, прежние chunk/dynamic-import warnings.
- Браузерные проверки: результат общего запуска дописан ниже.

Проверки используют локальный Vite и подменённый API без production mutations.
Просмотрен screenshot migrated-back-375.png: текстовые роли и карточка
сохранены. Физические устройства и реальный микрофон не проверялись.
Исходные изменения этапа 4A и отчёта публикации сохранены.
Commit/push/deploy этого этапа не выполнялись.
Артефакты: ignored local/test-data/design-v2-stage4b-*.log и Playwright output.

Финальный browser run: **92/92 PASS**, 5.5 минуты. Покрыты Quiz/Match,
WordBank/Free Text/Edit, Puzzle/Trainer/automatic Cloze, речевые режимы и
follow-up, editor/settings preview, offline/reconnect/account switching,
backup restore. Размеры 320/375/430/768/1280px и три локали в speech UI.
Дополнительно просмотрен desktop trainer-completed.png (1280px).
После удаления неиспользуемой передачи styles из StudyView повторный app
suite прошёл 565/565; финальная сборка и ESLint также успешны.
