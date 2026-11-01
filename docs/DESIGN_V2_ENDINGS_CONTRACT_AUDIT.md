# Trainer endings: проверка контракта оформления

Дата: 2026-11-01. Репозиторий `LanguageSage/lerne-tma`, ветка `codex/adaptive-knowledge`.

## Причина исходного сбоя

До правок воспроизведён `trainer-endings: endings stay compact...`:
ожидался `rgb(254, 215, 170)`, получен `rgba(255, 255, 255, 0.5)`.
Fixture записывала `cardTextColor`, `cardFont`, `cardFontSize`, `cardFontWeight`
непосредственно в store. Эти flat V1-поля больше не читаются упражнениями.
Полученный цвет — точное стандартное значение V2 `exercises.clozeGap.gap.color`.

Это устаревшая fixture после этапов [4B](DESIGN_V2_STAGE4B_RUNTIME_CLEANUP.md)
и [5](DESIGN_V2_STAGE5_LEGACY_REMOVAL.md), а не ошибка выбора темы Trainer.
В текущем HEAD нет поддерживаемого переключателя оформления V1/V2.
Отсутствие V2-документа не означает Legacy; возврат такого fallback отменил бы
действующий контракт. Legacy-разметка учебного контента продолжает работать.

## Проверенная цепочка оформления

- `design/personalDesignMigration.js:resolveActiveDesign`: локальный preview
  черновика при включённом флаге → опубликованный V2 → личный V2 → defaults V2.
  Пустые фоны наследуются из личного V2, остальные роли берутся из выбранного
  документа, без смешивания typography/state цветов с flat V1.
- Подписка `store/useSettingsStore.js` вычисляет `activeDesignConfig` и применяет
  к root CSS tokens из той же конфигурации. Обычное сохранение draft с
  `autoPreview: false` не подменяет опубликованное оформление. Предусмотренный
  администраторский preview «только у меня» может менять приложение локально.
- `ExerciseRenderer`: `designConfig ?? activeDesignConfig`; явный `null` и
  отсутствие prop выбирают активный V2. Устаревший `styles` не передаётся детям.
- `getDesignStylesFromV2(null/undefined)` возвращает текстовые defaults V2.
  Прямые leaf-вызовы без config используют эти defaults; настоящие runtime
  callers передают активный config. Семантические цвета наследуют CSS scope.
- Settings preview передаёт draft и одновременно ограничивает его CSS variables
  через `DesignPreviewScope`. Trainer dropdown и Puzzle drag overlay сохраняют
  эти variables при portal в body; это существующий механизм, нового нет.

## Аудит упражнений

| Потребитель | Typography | Цвета состояний |
| --- | --- | --- |
| Trainer choice/input и окончания | `front.mainText`, перевод `back.answerText` | `clozeGap.gap/filled/correct/wrong`; меню `gapDropdown.item/selected` |
| Quiz | `front.mainText` | `choice.normal/selected/correct/wrong/disabled` |
| Match | `front.mainText`, правая сторона `matchRightText` | `match.item/selected/matched/wrong/disabled` |
| WordBank | `front.mainText` | `wordBank.word/selected/correct/wrong` |
| Puzzle | `front.mainText`, перевод `back.answerText` | `puzzle.item/selected/correct/wrong` |
| Free Text/Edit и диктовка | prompt `front.mainText`, input `back.context` | `freeText.input/focus/correct/wrong` |

Блокировка правильного ответа сохраняет correct feedback. Ошибочный ответ
сохраняет wrong feedback согласно поведению упражнения; disabled не должен
стирать результат проверки. Цвет текста предложения не заменяет цвет gap,
а цвет context не заменяет семантический цвет поля Free Text.

Подтверждённых runtime-ошибок выбора Legacy/V2 с общей причиной не найдено.
Остались неиспользуемые следы V1: CSS-селектор
`.trainer-exercise[data-design-v2="false"]` (компонент никогда не выставляет
`false`) и игнорируемый `styles` в AssessmentView. Они не включают Legacy и
не менялись в этой задаче.

Отдельное наблюдение визуального QA: на 320 px в настоящем Study обрезаются
правый край верхней панели и длинная подпись выбора режима. Это общая
компоновка `StudyView.css` (`study-top-collapsible`/header/select), видимая
с разными темами и упражнениями. Она не исправлялась в задаче выбора V1/V2;
проверка отсутствия горизонтального overflow документа сама по себе не
обнаруживает такое внутреннее обрезание.

## Исправление

Изменён только browser spec `scripts/tests/browser/trainer-endings.spec.cjs`:

- fixture публикует нативный V2 через существующий `/api/init` DTO;
- сохранены исходные orange/Georgia assertions; оранжевый явно задан роли
  `clozeGap.gap`, цвет предложения намеренно другой;
- оставлены конфликтующие V1-настройки для обнаружения случайного fallback;
- добавлены assertions filled/wrong/correct и locked correct;
- добавлены регрессии отсутствующего/null config и неопубликованного draft,
  обновления публикации без потери набранного ответа.

Runtime, ранее исправленная диктовка, supportEvidence, диагностика,
проверка ответов, Knowledge/SRS и учебные материалы не изменены.

## Проверки

Полный `npm run test:frontend`: 604 теста приложения + 88 регрессий PASS.
Полный `npm --prefix app run lint`: PASS.
Production build в `local/test-data/legacy-v2-build`: PASS; предупреждения о
крупных chunks и смешанных static/dynamic imports сохранены.

Browser: **111/111 PASS**, 6.4 минуты. Запускались `trainer-endings`,
`puzzle-trainer-design`, `input-design-v2`, `quiz-match-design`,
`design-runtime-v2`, `free-text-dictation`, `exercise-feedback`,
`trainer-support`, `assessment` с `--project=extended`. Проверены обычные,
selected/filled, wrong/retry, correct/locked состояния, preview, отсутствие
публикации, локальное включение/выключение draft и сохранение ввода.
Диктовка и оценивание прошли без изменения их runtime или assertions.
После усиления двух null/omitted регрессий отдельный финальный запуск:
**2/2 PASS**. Они удаляют все runtime sources V2 (включая автоматически
созданный personal document), затем проверяют появление опубликованных ролей
без потери ввода. Лог: `local/test-data/legacy-v2-final-regression.log`.

Просмотрены фактические screenshots исходного сценария окончаний на
320/375/430/768/1280 px, меню и частично правильного ответа на 375 px;
Trainer/Puzzle/Quiz/Match/WordBank/Free Text retry на мобильных размерах;
диктовка на 320/430/768/1280 px. Геометрия и CSS также проверяются browser
assertions на всех пяти размерах. Физические устройства и настоящий
микрофон не проверялись.

Первоначальный запуск инструментов из sandbox упирался в `spawn EPERM`;
разрешённый повтор локальных процессов прошёл. Итоговый общий browser suite
не имеет посторонних failures или отключённых assertions.

Проверки изолированы: локальный Vite без API proxy, подменённые API/речь,
заблокированные внешние запросы. Production-записей, миграций и deploy нет.
Логи и screenshots находятся только в ignored `local/test-data/`.
