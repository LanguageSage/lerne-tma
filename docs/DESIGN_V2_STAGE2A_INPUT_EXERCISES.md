# Design V2: этап 2A — WordBank, Free Text и Edit

Дата: 2026-10-29. Цель миграции — [только Design V2](../.agents/AGENTS.md#design-v2-архитектурное-решение).
Этот этап переводит три типа упражнений на существующий механизм оформления;
хранение пользовательского дизайна и миграция данных остаются отдельными этапами.
[Этап 1 Quiz/Match](DESIGN_V2_STAGE1_QUIZ_MATCH.md) сохраняет свой контракт.

## Оформление

`ExerciseRenderer` передаёт уже разрешённый effective design в WordBank и общий
компонент Free Text/Edit. Явный `designConfig` обслуживает scoped preview;
без prop renderer читает опубликованный V2 или активный локальный черновик.
Используется прежний `getDesignStylesFromV2`, без нового resolver/provider.

| Элемент | Источник V2 |
| --- | --- |
| WordBank: тело, пропуски и типографика вариантов | `front.mainText`; размер вариантов — прежние 90% |
| Free Text: условие | `front.mainText` |
| Free Text/Edit: типографика поля и пример ответа | `back.context` |
| WordBank: normal / active / correct / wrong | `exercises.wordBank.word / selected / correct / wrong` |
| WordBank: панель банка слов | `exercises.wordBank.container` |
| Free Text/Edit: normal / focus / correct / wrong | `exercises.freeText.input / focus / correct / wrong` |

Типографика включает font/size/weight/style/lineHeight/align. Цвет из текстовой
роли не применяется inline к вариантам, пропускам и полю ввода: их цвета
принадлежат состояниям упражнения. Пример ответа сохраняет контекстную роль.
Для Edit нет отдельной копии настроек Free Text.

WordBank использует собственные текст/фон/рамку/скругление каждого состояния,
а не `choice.correct/wrong`. Завершённые пропуски сохраняют correct при блокировке.
Занятые варианты остаются на своей поверхности `word` с прежним dimming.
Цвет номера и нижнего акцента пропуска наследуется от состояния; жёсткие
цвета feedback и hover-фона удалены. Кнопки вариантов и пропусков имеют
минимальную высоту 44px, длинные слова переносятся в пределах карточки.

Free Text/Edit используют собственные цвета поля и рамки при correct/wrong,
а также фон/рамку focus. Rejected ответ помечается `aria-invalid`; при правке
он возвращается к обычному цвету. `unavailable` остаётся нейтральной ошибкой
сервиса. Принятый ответ сохраняет correct при блокировке. Оценка, счётчики,
reveal gates, SRS, speech recognition и сохранение состояния не менялись.

Все использованные поля уже присутствовали в схеме V2. Преобразователь теперь
выдаёт недостающие CSS-токены. Нормализация старого V2 JSON дополняет отсутствующие
значения defaults, сохраняя известные пользовательские значения.

## Предпросмотры

- В настройках отдельный JSX-образец WordBank удалён: используется настоящий
  `ExerciseRenderer`, можно заполнить пропуски, проверить ошибку и завершение.
- В ту же область добавлены настоящие Free Text и Edit, заблокированные через
  fieldset. Free Text содержит демонстрационный ответ, Edit — исходный текст.
  Они показывают normal-оформление и не вызывают оценку или микрофон.
  Интерактивные focus/feedback этих типов проверяются на реальной карточке.
- Существующий preview редактора содержимого получает тот же effective config.
  Его блокировка не подменяет normal-цвет состоянием disabled.
- Черновик остаётся в `DesignPreviewScope`; при выключенном локальном просмотре
  он не меняет реальную учебную карточку. Контролы редактируют существующие
  `wordBank`/`freeText`, без второго набора типографики или настроек Edit.
- На узких экранах переключатель preview использует select, освобождая место
  для образца внутри прежней ограниченной по высоте области.

## Проверки

Адресный suite: `scripts/tests/browser/input-design-v2.spec.cjs`.
Проверяются конфликтующие V1/V2 шрифты и цвета, независимые состояния WordBank,
Free Text/Edit, keyboard selection, retry/lock, ошибки сервиса, normal-соответствие
редактору, isolated draft, переключение дизайна без потери ввода/выбора,
standalone renderer, V1 fallback и длинные слова.

Unit-регрессия в `app/src/design/__tests__/designTokens.test.js` проверяет
собственные токены WordBank/Free Text, независимость от choice и старый V2 JSON.
Read-only probe исходного `HEAD` подтвердил отсутствие новых feedback/focus
токенов в старом преобразователе.

| Проверка | Результат |
| --- | --- |
| `npm run test:frontend` | 543 теста приложения + 88 регрессий, PASS |
| Адресный token suite | 8/8 PASS, входит в 543 |
| ESLint на шести изменённых JS/JSX-файлах приложения | PASS |
| `node --check` трёх изменённых browser specs | PASS |
| `LERNE_ISOLATED_CHECKS=1 npm --prefix app run build` | PASS |
| Новый `input-design-v2.spec.cjs` в финальном прогоне | 26/26 PASS |
| Финальный объединённый browser run | 70/70 PASS, Chromium |
| `git diff --check` | PASS |

Финальная браузерная команда из корня:

```powershell
npx --no-install playwright test --project=extended input-design-v2.spec.cjs quiz-match-design.spec.cjs design-editor.spec.cjs match-quiz-feedback.spec.cjs free-text-evaluation.spec.cjs exercise-feedback.spec.cjs --fully-parallel --output=local/test-data/playwright-stage2a-final
```

Проверены 320/375/430/768/1280 CSS px для WordBank/Free Text/Edit,
375px для editor preview, мобильные и настольные настройки. Снимки мобильных
и настольных карточек, длинных слов и настроек просмотрены визуально;
проверен horizontal overflow. Существующие design editor tests также покрывают
1080px, Tab и reduced motion. Все данные синтетические, API перехвачены;
Vite запускается без `.env` и с изолированным proxy, внешние соединения запрещены.

Первый дополнительный regression run выявил старые заглушки `/api/messages`
в `exercise-feedback.spec.cjs` и `free-text-evaluation.spec.cjs`: ответ `{}`
вместо массива ломал неизменённый DeckGridHeader до открытия упражнения.
Trace подтвердил `messageRoots.reduce is not a function`. Исправлен только
контракт заглушек на `[]`; учебные assertions сохранены. Финальные 70/70
получены после исправления заглушек и мобильного переключателя preview.

Сборка сохраняет предупреждения о размере основного чанка и неэффективных
dynamic imports exerciseDetector/clozeParser/wordBankParser. Backend, реальные
БД, внешняя AI-оценка, микрофон и миграция online/offline не проверялись этим
этапом. Chromium viewport emulation не заменяет физический Android/iOS/WebView;
внешние веб-шрифты заблокированы, assertions используют системные шрифты.
Commit/push/deploy не выполнялись.

Логи и screenshots хранятся только в ignored `local/test-data/`:
`design-v2-stage2a-*.log`, `playwright/`, `playwright-stage2a-regression/`
и `playwright-stage2a-final/`.

## Оставшиеся этапы

- Puzzle, Trainer, отдельный TrainerView и речевые режимы ещё требуют переноса
  оставшихся Legacy-потребителей и настоящих preview (Cloze пока остаётся образцом).
- Фоны карточек, текстовые shadow, `context.color: auto`, `exercises.bodyText`
  и auto-palette не менялись в 2A; их ограничения из исходного аудита сохраняются.
- Legacy helpers остаются временным fallback при отсутствии V2. Flat settings,
  пресеты, legacyAdapter, пользовательский sync и хранилища не удалялись и не
  переписывались. Существующие данные пользователей не мигрировались.
- Полное удаление Legacy требует безопасного переноса настроек/пресетов,
  проверки всех типов и режимов, online/offline, смены аккаунта и восстановления.
  Перед этим сложным этапом требуется остановиться по просьбе пользователя
  о переключении модели.
