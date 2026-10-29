# Design V2: этап 1 — Quiz и Match

Дата: 2026-10-29. Изменения выполнены в TMA, без commit/push/deploy.

## Поведение

Основной текст Quiz (вопрос и типографика вариантов), prompt Match и типографика
обеих колонок Match используют `front.mainText` через существующий
`getDesignStylesFromV2`. Учитываются font/size/weight/style/lineHeight/align.
Цвет вопроса/prompt берётся из `front.mainText.color`; цвет вариантов и пар
определяется отдельно состоянием, поэтому смена основного цвета не стирает feedback.

`ExerciseRenderer` принимает необязательный `designConfig`. Явный config нужен
для изолированного предпросмотра; без него используется действующий дизайн из
store: активный локальный черновик либо опубликованный V2. Явный `null` выбирает
V1 fallback. StudyCard и CardContentEditor передают свой effective config.

При отсутствии V2 сохранены шрифт/цвет вопроса Quiz и независимые V1-настройки
левой/правой колонок Match. Legacy helpers применяются только как fallback.
При этом цвет состояния применяется после типографики, включая V1: старая
перезапись correct/wrong/selected цветами `cardStyle`/`contextStyle` устранена.

| Состояние | Quiz | Match |
| --- | --- | --- |
| normal | `exercises.choice.normal` | `exercises.match.item` |
| selected | `choice.selected` | `match.selected` |
| correct | `choice.correct` | `match.matched` |
| wrong | `choice.wrong` | `match.wrong` |
| disabled | `choice.disabled` | `match.disabled` |

Для каждого состояния сохраняются независимые color/bg/borderColor.
Добавлены недостающий choice-disabled-border и полные Match-токены.
Старый V2 JSON получает отсутствующий `match.disabled` из defaults без миграции.
Правильная заблокированная пара остаётся correct: disabled не скрывает результат.
В нормальном Match завершение фиксирует все пары, поэтому отдельная ветка
disabled не заменяет matched; её schema/token-покрытие проверено unit-тестом.

Quiz success banner тоже использует choice.correct. Гармонизация значков Quiz
при наличии V2 использует `exercises.baseColor`, а не Legacy cardTextColor.
Длинные подписи Match переносятся внутри двух ограниченных колонок.

## Существующие предпросмотры

- CardContentEditor сохраняет единственный прежний preview через ExerciseRenderer.
  Его normal-цвета и типографика совпадают с StudyCard. Внешний disabled fieldset
  по-прежнему блокирует редактирование ответа, сохраняя исходный normal-внешний вид.
- В ExerciseDesignSection самодельные Quiz/Match элементы заменены тем же
  ExerciseRenderer в прежнем DesignPreviewScope. Можно выбрать вариант, проверить
  ошибку, повторить попытку и сбросить sample. Новых preview-поверхностей нет.
- Контролы Quiz/Match редактируют текст/фон/рамку каждого из пяти состояний;
  основной шрифт и основной цвет остаются в существующем разделе «Лицевая».
- Scoped draft проверен при выключенном локальном preview: он меняет только
  settings preview. Явное включение локального режима продолжает менять приложение
  в текущем браузере; публикация и её подтверждение не изменены.
- Парсеры, evaluator/evidence, retry, сохранение состояния, SRS и другие типы
  карточек не изменены.

## Проверки

| Проверка | Результат |
| --- | --- |
| `npm run test:frontend` | 542 теста приложения + 88 регрессий, PASS |
| Новый state-token test, включая старый V2 JSON | PASS; входит в 542 |
| ESLint на восьми изменённых JS/JSX-файлах приложения | PASS |
| `LERNE_ISOLATED_CHECKS=1 npm run build` | PASS |
| `match-quiz-feedback.spec.cjs` | 5/5 PASS |
| `design-editor.spec.cjs` | 11/11 PASS |
| `quiz-match-design.spec.cjs` | 18/18 PASS |
| Финальный объединённый browser run | 34/34 PASS, Chromium |

Адресный browser suite `quiz-match-design.spec.cjs` проверяет конфликтующие V1/V2
шрифты и цвета, size/weight/style, пять состояний Quiz, normal/selected/wrong/matched
обеих колонок Match, keyboard selection, retry/lock, V1 fallback, локальное
переключение без потери выбора, оба существующих preview, scoped draft,
ExerciseRenderer без явного config и длинные DE/RU подписи с prompt.

Ширины Quiz/Match: 320/375/430/768/1280 CSS px; editor preview — 375px;
дополнительная проверка длинных пар — 320px. Существующий design editor suite
также проверяет 320/375/430/768/1080px, Tab и reduced motion.
Выполнен визуальный просмотр mobile/desktop screenshots, проверен horizontal
overflow. API и WebSocket изолированы, данные синтетические. Реальные БД,
сохранённый дизайн пользователей и публикация на сервере не затронуты.

При первом запуске обнаружена устаревшая заглушка `/api/messages`: объект вместо
массива приводил к падению DeckGridHeader до открытия карточек. Исправлены только
заглушки в затронутых suites. Новые Quiz-селекторы используют идентичность текста,
а не случайный порядок перемешанных вариантов. Отдельный route `trainer` в App
ведёт в StudyView; default config renderer проверяется прямым component harness.

Read-only probe исходного `HEAD:app/src/design/designTokens.js` воспроизводит
дефект: custom selected color/border Match не экспортируются. Новая регрессия
проверяет эти значения, а исправленный converter её проходит.

Сборка сохраняет предупреждения о размере основного чанка и неэффективных
dynamic imports exerciseDetector/clozeParser/wordBankParser. Backend/live-service
проверки не выполнялись. Chromium viewport emulation не заменяет физический
Android/iOS/WebView; внешние веб-шрифты заблокированы изоляцией сети, для точных
assertions используются системные monospace/serif/Georgia.

Логи и screenshots находятся только в ignored `local/test-data/`:
`design-v2-stage1-frontend.log`, `design-v2-stage1-build.log`,
`design-v2-stage1-browser.log`, `playwright/`.

## Что остаётся от Legacy

1. Flat-поля useSettingsStore, localStorage, user-settings sync, legacyAdapter,
   миграции и DESIGN_PRESETS сохранены. Автоматической перезаписи настроек нет.
2. getCardStyle/getContextStyle и гармонизация сохраняются для V1 fallback;
   другие типы карточек остаются на прежних путях до следующих этапов.
3. CardBackground и cardBgFront/cardBgBack ещё управляют фоном карточки.
   Их перенос на V2 не входит в оформление основного текста Quiz/Match.
4. Общие CSS semantic aliases оставлены как fallback к узким токенам состояний.
   Служебный заголовок Match, цветные парные метки, значки и часть эффектов кнопок
   сохраняют прежнее оформление; это не Legacy override основного текста.
5. `exercises.bodyText` не стал вторым источником для Quiz/Match: используется
   существующий `front.mainText`. Режим auto-palette/baseColor и полный перенос
   декора/поверхностей остаются отдельной задачей; полная автогенерация всех
   палитр в этом этапе не добавлялась.


Команда финального browser run:

```powershell
npx --no-install playwright test --project=extended quiz-match-design.spec.cjs match-quiz-feedback.spec.cjs design-editor.spec.cjs --fully-parallel
```

`git diff --check` прошёл. Изменения оставлены в рабочем дереве TMA;
рабочее дерево независимого lerne-admin осталось чистым.
