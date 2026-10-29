# Design V2: этап 2B — Puzzle и Trainer

Дата: 2026-10-29. Продолжение [этапа 2A](DESIGN_V2_STAGE2A_INPUT_EXERCISES.md)
в рамках [решения о переходе только на V2](../.agents/AGENTS.md#design-v2-архитектурное-решение).
Этот этап меняет оформление и предпросмотры, сохраняя механику упражнений.

## Источники оформления

`ExerciseRenderer` передаёт effective V2 в `StudyCardPuzzle` и `StudyCardTrainer`
по прежнему контракту: явный config для scoped preview, иначе active local draft
или published config. Используется прежний `getDesignStylesFromV2`, без нового
resolver/provider, источника состояния или хранилища.

| Элемент | Источник |
| --- | --- |
| Текст Trainer, полные пропуски, окончания, слова Puzzle | Типографика `front.mainText` |
| Перевод внутри Trainer/Puzzle | `back.answerText` |
| Trainer: пустой / заполненный / правильный / ошибочный пропуск | `exercises.clozeGap.gap / filled / correct / wrong` |
| Меню вариантов Trainer | `exercises.gapDropdown`, включая item/selected |
| Puzzle: области слов и ответа | `exercises.puzzle.container` |
| Puzzle: исходное / выбранное слово | `puzzle.item / selected` |
| Puzzle: успешное завершение / ошибка порядка | `puzzle.correct / wrong` |
| Проверка и сброс | Существующий `exercises.actionButton` |

Цвет текста роли не перекрывает семантические состояния. Trainer использует
свои состояния и для полного ввода, и для выбора, и для окончаний внутри слова.
Правильно собранное слово с окончанием наследует собственные correct-токены,
без принудительного зелёного `!important`. Типографика и lineHeight приходят
из V2; стили формы редактора больше не перекрывают поля Trainer в preview.
Отдельный автоматический режим «Пропуски» в StudyCard использует те же роли
и токены: его correct/wrong больше не задаются жёстким CSS с `!important`.
Алгоритм выбора пропуска и его собственная учебная политика сохранены.

У Puzzle цвет ошибки относится к направленному соседству и области ответа,
а не к отдельному слову: правильные соседства по-прежнему не блокируют drag.
После completion выбранные слова и область ответа сохраняют correct при
блокировке. Повторные определения CSS источника и ответа и жёсткие inline
поверхности/кнопки удалены.

В схему добавлены только необходимые `puzzle.correct/wrong`: ранее эти
feedback-поверхности существовали исключительно как жёсткие цвета Legacy.
Старый V2 JSON дополняется defaults, сохраняя известные настройки item/selected
и радиусы. Cloze filled и поверхности Puzzle теперь экспортируют недостающие
CSS-токены. Формат хранения и schemaVersion остаются прежними.

## Предпросмотры и порталы

- Отдельный макет Cloze удалён. В той же preview-области работают настоящие
  Trainer и Puzzle через `ExerciseRenderer`, с проверкой, повтором и сбросом.
- Редактор содержимого использует те же компоненты с normal-оформлением внутри
  своего прежнего disabled fieldset. Исходник и сохранение карточки не менялись.
- Меню Trainer и drag-overlay Puzzle остаются в `document.body`. Они получают
  переменные своего effective config локально на узле портала; CSS из черновика
  не публикуется в корень приложения. `gapDropdown.font: inherit` наследует
  шрифт учебного текста, в том числе из scoped draft.
  Drag-overlay расположен над settings-modal; это проверено отдельно после
  визуального просмотра. Для `inherit` преобразователь сбрасывает CSS custom
  property через `initial`, чтобы `font-family` наследовал scoped card font,
  а не опубликованный токен из родительского DOM.
- Существующие контролы состояний переиспользованы для Cloze и Puzzle.
  Отдельных копий настроек или схемы только для preview нет.

## TrainerView и временный fallback

Отдельный `TrainerView` также читает effective V2. Он передаёт его renderer и
fallback-компоненту, а обратная сторона использует reference/answer/context
через общий helper. Основной маршрут `App` для `view: trainer` по-прежнему
открывает `StudyView`: маршрутизация и учебная политика не менялись.

При отсутствии V2 остаются прежние helpers. Сохранены прежний размер слова
Puzzle по умолчанию 1rem и наследование цвета пустого окончания Trainer;
последнее ограничено одним CSS-правилом на прежней fallback-границе.
Новых V1-полей, адаптеров хранения или синхронизации нет.

## Проверки

- `puzzle-trainer-design.spec.cjs`: конфликтующие V1/V2 настройки, типографика,
  normal/filled/correct/wrong, endings, перевод, меню selected, кнопки,
  completion/lock, editor parity, scoped portal, standalone renderer,
  сохранение черновика ответа при смене дизайна и отдельный TrainerView.
- `puzzle-feedback.spec.cjs`: направленные соседства, duplicate tokens, Checks,
  flip/remount, перестановка исходных слов и ответа, обе зоны, mouse/touch,
  Escape/outside drop, перенос строк и сохранение истории.
- `trainer-endings.spec.cjs` и `exercise-feedback.spec.cjs`: attachment окончаний,
  ввод/выбор/retry, confirmed parts, cumulative evidence, новый review.
- Unit-регрессия: свои filled/Puzzle токены, независимость от choice,
  дополнение старого V2 и round-trip конфигурации.

Исходные снимки до изменений сняты теми же сценариями Puzzle/окончаний;
адресный запуск до правок прошёл 2/2. После изменения размеров прежний тест
точной mouse-вставки считывал координаты во время layout-анимации. Для этого
геометрического сценария включён reduced motion; assertions о порядке слов
сохранены. Остальные mouse/touch-сценарии продолжают проверять обычную анимацию.
В старые заглушки Puzzle/окончаний добавлен корректный массив `/api/messages`.

| Проверка | Результат |
| --- | --- |
| `npm run test:frontend` | 544 теста приложения + 88 регрессий, PASS |
| Адресный token suite после исправления inherit | 9/9 PASS, входит в 544 |
| ESLint девяти изменённых JS/JSX-файлов приложения | PASS |
| `node --check` трёх изменённых browser specs | PASS |
| Финальный isolated Vite build | PASS |
| Новый browser suite 2B | 17/17 PASS после адресных повторов |
| Puzzle feedback/drag | 8/8 PASS |
| Trainer endings | 2/2 PASS |
| Регрессии этапов 1/2A, дизайна и feedback | 70/70 PASS |
| Финальный запуск нового suite + endings | 19/19 PASS |
| Дополнительная проверка scoped overlay над modal | 1/1 PASS |

Общий запуск 96 сценариев обнаружил две проблемы: утечку published font через
CSS-wide `inherit` и устаревший тест редактора окончаний. Оба случая исправлены
и повторно проверены. Старый тест ожидал уже удалённые Advanced/Simple controls;
теперь он проверяет ту же вставку `klein{en}`, набор пяти окончаний и correct
answer через фактический parser, настоящий disabled preview и точный save payload.
Продуктовый editor/source/save для этого не менялись. Финальный 19/19 запуск
также включает добавленный автоматический Cloze и настройки с inherited font.
После визуального обнаружения скрытого за modal drag-overlay выполнен отдельный
повтор scoped-сценария, затем финальные lint/build.

Команда финального адресного прогона:

```powershell
npx --no-install playwright test --project=extended puzzle-trainer-design.spec.cjs trainer-endings.spec.cjs --fully-parallel --output=local/test-data/design-v2-stage2b-verified
```

Проверены 320/375/430/768/1280 CSS px, длинные немецкие слова, normal/feedback,
keyboard focus, Escape, mouse/touch, reduced motion и отсутствие horizontal
overflow. Выполнен визуальный просмотр matched V1-снимков до/после на 375px,
V2-карточек на mobile/desktop, автоматического Cloze, scoped drag и мобильных
настроек. Отдельный TrainerView проверен через настоящий компонент с обычным
LanguageProvider на FRONT; его BACK перенесён на общие helpers, но отдельная
браузерная проверка BACK не выполнялась (основной App route использует StudyView).

API полностью подменены, внешняя сеть заблокирована, dev server работает без
`.env` с isolated proxy. Данные синтетические; реальные БД/публикация дизайна,
AI/микрофон, миграция online/offline и физический Android/iOS/WebView не проверялись.
Для assertions использованы системные шрифты: внешние веб-шрифты заблокированы.
Сборка сохраняет известные предупреждения о размере чанка и ineffective dynamic
imports exerciseDetector/clozeParser/wordBankParser. Commit/push/deploy этапа 2B
не выполнялись. Артефакты находятся только в ignored
`local/test-data/design-v2-stage2b-*`.

## Границы и следующие этапы

Алгоритмы parsing/evaluation/drag, part IDs, попытки, evidence, SRS, сохранение
ввода и модель пользовательских настроек не менялись. Пользовательские данные,
Legacy-пресеты, adapter и хранилища не мигрировались и не удалялись.

Речевые режимы, оставшиеся фоны/декор, текстовые shadow, auto context/palette и
`exercises.bodyText` ещё требуют отдельных решений. После завершения runtime
переноса остаются безопасная миграция личных настроек и пресетов, проверка
online/offline, смены аккаунта и восстановления, затем удаление Legacy-кода
и хранилищ. Полный отказ от Legacy этим этапом не объявляется.
