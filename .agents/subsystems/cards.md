# Cards: карточки, синтаксис и редактор

## Scope

Создание/редактирование, список карточек, batch import, перемещение, копирование, удаление и поиск.
Синтаксис исходного текста и парсеры принадлежат этой подсистеме; проверка решения — [study](study.md).

## Primary entry points

Пути от корня репозитория; начинайте с нужной строки.

| Задача | Файлы |
| --- | --- |
| Форма и редактор содержимого | `app/src/components/common/CardForm.jsx`, `app/src/components/common/CardContentEditor.jsx`, `app/src/components/common/CardContentEditor.css` |
| Создание, редактирование и сохранение | `app/src/components/deckgrid/CardCreator.jsx`, `app/src/components/deckgrid/CardEditor.jsx`, `app/src/hooks/useCardEditor.js` |
| Список / действия / возврат | `app/src/components/deckgrid/CardList.jsx`, `app/src/hooks/useCardActions.js`, `app/src/hooks/useCardNavigation.js`, `app/src/utils/navigation.js` |
| Batch import | `app/src/components/modals/BatchCardModal.jsx`, `app/src/hooks/usePendingImport.js`, `app/src/utils/batchCardParser.js` |
| Синтаксис и распознавание | `app/src/utils/cardEditorSyntax.js`, `app/src/utils/exerciseContentParser.js`, `app/src/utils/exerciseDetector.js` |
| Парсеры упражнений | `app/src/utils/wordBankParser.js`, `app/src/utils/clozeParser.js`, `app/src/utils/matchParser.js`, `app/src/utils/quizParser.js`, `app/src/utils/freeTextParser.js` |
| Сеть / хранение | `api/routers/cards.py`, `api/services/cards.py`, `app/src/services/offlineApi.js` |

## Data flow

1. CardCreator/CardEditor → CardForm → CardContentEditor редактирует `cardData.front`.
2. `cardEditorSyntax.js` использует `parseExerciseContent` для проекции и вставки команд в исходный текст.
3. `useCardEditor.js` → API-клиент → `/cards/save` → server `save_card` либо offline API → Dexie.
4. BatchCardModal разбирает ввод и отправляет `/cards/bulk-save`; pending import хранит исходный payload и `import_id` для повтора.
5. Серверный bulk-save фиксирует результат импорта через `TMAOfflineBatch`; AI batch имеет отдельный путь в [ai](ai.md).

## Source of truth

- Исходный текст формы — `cardData.front`; сохранённый текст — `TMA_Card.front_text` в `api/models.py` и запись Dexie.
- Переключение Simple/Raw не должно пересобирать исходный текст; проекция не является отдельной копией карточки.
- Официальные информационные маркеры распознаёт `exerciseContentParser.js`; кнопка «Подсказка» вставляет `::source`.
- Команды вставки определены в `cardEditorSyntax.js`; `::hint` не входит в официальный набор маркеров.
- Структура панели определяется `editorCommandGroups` в `cardEditorSyntax.js`; вставка работает с текущим выделением, а восстановление фокуса/selection/scroll находится в CardContentEditor.
- В online-режиме результат сохраняет сервер, в offline — Dexie; перенос данных описан в [sync](sync.md).
- Порядок карточек, удаление и повторный импорт определяются серверной логикой и соответствующими offline handlers.

## Theory

- `@theory` отдельной строкой в FRONT задаёт `card_type: theory`. Маркер остаётся в исходнике для редактирования и экспорта. `exerciseContentParser.js` / `input_parser.py` исключают его из визуального и TTS-представления, возвращая `isTheory` / `is_theory`; буквальное упоминание внутри непрерывного информационного блока не задаёт тип.
- `detectCardType` определяет обозначение типа для списка, редакторского сохранения и batch import. `detectExerciseType` оставляет Theory на обычном неинтерактивном пути Standard, даже при вопросах и cloze-примерах. Другие приоритеты типов сохранены.
- Список использует существующий `CardTypeBadge` с 📚 Theory. Online/offline сохраняют существующее поле `card_type`; миграций нет. Канонический экспорт «Автора» сохраняет FRONT с маркером, серверная модель обновления текста принимает `theory`.
- Правила агентов: `lerne-card-prompts/types/theory.md`; одиночное и пакетное AI-обогащение сохраняют исходный FRONT Theory.
- Регрессии: `theoryCards.test.js`, `scripts/tests/test_theory_cards.py`, Theory cases в `test_ai_batch_contract.py`, `scripts/tests/browser/theory-cards.spec.cjs`.


## Common symptoms

| Симптом | Первый участок проверки |
| --- | --- |
| Команда вставляется не у курсора, пропадает выделение | CardContentEditor + `insertEditorCommand`; проверьте перевод LF/CRLF offsets |
| Переключение Simple/Raw меняет текст или теряет блоки | `cardEditorSyntax.js` и вход/выход CardContentEditor |
| `::source`, `::task`, `::exercise` отображаются неверно | `parseExerciseContent`, затем study renderer |
| Парсер верен, но Puzzle/Word Bank ответ оценивается неверно | Перейдите в [study](study.md) |
| После таймаута повтор импорта создаёт дубликаты | Pending import → bulk-save → квитанция `import_id` |
| После возврата список прыгает вверх | CardList, `lastSelectedCardId`, `cardsScrollTop`, navigation |
| Карточка сохранена, но отсутствует в списке | Store `cardsByDeck`, принадлежность колоде, фильтры и `is_deleted` |

## Search anchors

Запускайте из корня; результат указывает диапазон для чтения.

```sh
rg -n 'insertEditorCommand|editorSourceOffset|parseExerciseContent' app/src/utils/cardEditorSyntax.js app/src/components/common/CardContentEditor.jsx
rg -n 'lastSelectedCardId|cardsScrollTop|visibleCount' app/src/components/deckgrid/CardList.jsx app/src/utils/navigation.js
rg -n 'bulk_save_cards|import_id|TMAOfflineBatch' api/routers/cards.py api/services/cards.py
```

## Relevant tests

- Синтаксис/парсеры: `app/src/utils/__tests__/cardEditorSyntax.test.js`, `app/src/utils/__tests__/exerciseParsers.test.js`.
- Редактор в браузере: `scripts/tests/browser/card-editor-source.spec.cjs`, `scripts/tests/browser/card-editor.spec.cjs`.
- Batch: `scripts/tests/test_bulk_import_idempotency.py`, `scripts/tests/test_bulk_save_partial_failure.py`.
- Возврат в список: `scripts/tests/test_card_scroll_restoration.mjs`.
Перед запуском integration/browser scripts проверяйте окружение и fixtures.

## Related docs

- [Study: renderer и feedback](study.md), [Decks: владение и навигация](decks.md), [Sync](sync.md), [AI](ai.md).
- [USER_MANUAL](../../docs/USER_MANUAL.md) — пользовательские сценарии; точные контракты сверяйте с парсерами.
- [Architectural integrity](../rules/architectural_integrity.md), [UI skill](../skills/tma-ui/SKILL.md).

## Экспорт учебного текста

- Канонический сериализатор: `app/src/utils/cardTextSerializer.js`; использует существующий `batchCardParser.js` для границ, проверки секций и round-trip, не пересобирает исходный `FRONT`.
- Чтение online/offline и скачивание UTF-8: `app/src/services/cardTextExport.js`; UI состояния: `app/src/hooks/useCardTextExport.js`.
- Сохраняет front/back/context, эффективный CEFR и topics. Ответ чтения карточек в `api/services/cards.py` включает topics. Стабильные card_id/deck_id записываются до FRONT; SRS, история, timestamps и аудио исключены.
- Тесты: `app/src/utils/__tests__/cardTextSerializer.test.js`, `scripts/tests/browser/card-text-export.spec.cjs`, проверка topics в `scripts/tests/test_study_latency.py`.
- Ограничения действующего импорта, формат папки и сценарий использования: [CARD_TEXT_EXPORT](../../docs/CARD_TEXT_EXPORT.md). Изображения/видео, произвольные теги и нормализация CONTEXT/пустого BACK сопровождаются явным сообщением и преамбулой файла; конфликт границ останавливает экспорт.

## Обновление контента по ID

- Извлечение служебных ID: `cardTextMetadata.js`; `cardTextUpdateParser.js` передаёт содержимое существующему batch/exercise parser, собирает все ошибки и сохраняет пустой BACK/формат CONTEXT. Обычный импорт по-прежнему создаёт новые карточки и игнорирует ID в преамбуле.
- Сервер: `api/services/card_text_update.py`; preview сравнивает только front/back/context, CEFR и topics. Apply проверяет роль owner/editor, принадлежность card_id/deck_id, fingerprint текущего контента и выполняет content UPDATE одной транзакцией. SRS/история/медиа сохраняются, отсутствующие в файле карточки не удаляются.
- UI: `DeckTextUpdateModal.jsx`; online service `cardTextUpdate.js` сохраняет точный запрос в account-scoped Dexie syncState до HTTP apply. Квитанция TMAOfflineBatch защищает повтор после потерянного ответа; новые карточки требуют отдельного флажка.
- Тесты: `cardTextUpdate.test.js`, `scripts/tests/test_card_text_update.py`, `scripts/tests/browser/card-text-update.spec.cjs`. Формат, поведение и ограничения: [CARD_TEXT_UPDATE](../../docs/CARD_TEXT_UPDATE.md).

## Обновление карточек в дереве папки

- Folder mode того же `cardTextUpdateParser.js` требует deck_id каждой карточки; metadata extractor/serializer и обычный импорт сохранены. Служебные IDs до FRONT не становятся контентом, повтор deck_id между карточками допустим, повтор card_id между любыми группами критичен.
- `card_text_update.py` теперь общий для deck/folder compare/write/idempotency; folder scope валидируется отдельно. Одна транзакция нескольких колод сохраняет SRS/history/media/provenance/ownership/позиции. Пропущенные карточки/колоды не удаляются, названия/структура не меняются.
- Folder apply оставляет deck/folder timestamps прежними; deck apply сохраняет свой существующий touch ancestors. Общий client сохраняет payload в Dexie до запроса и блокирует overlapping pending updates, UI группирует diff по колодам.
- Доказательства сохранности и compatibility: [FOLDER_TEXT_UPDATE](../../docs/FOLDER_TEXT_UPDATE.md).

## Границы интерактивных блоков и паспорт

- `exerciseContentParser.js` и серверный `api/services/input_parser.py` разбирают
  отдельные строки `@puzzle`, `@match`, `@wordbank`, `@free` до следующего
  структурного маркера или конца FRONT; пустые строки сохраняются, `@options`
  остаётся частью Word Bank. `::exercise` необязателен для этих директив.
- Информационные блоки непрозрачны для определения типа: директива внутри
  непрерывного `::task`, `::source`, `::example` остаётся текстом. Пустая строка
  перед отдельной директивой завершает информационный блок независимо от
  `::exercise` в другом месте. Старые границы обычного текста и многоабзацный
  source с явным `::exercise` сохранены.
- `getInteractiveExerciseContent` выбирает один блок для Match, Free Text,
  Word Bank и Puzzle, исключая соседние упражнения и информационные блоки.
- Документы с паспортом принадлежат `api/services/author_service.py` («Автор» /
  CLI): отсутствующие level/topics наследуются независимо из intro своей колоды,
  явные значения CONTEXT важнее. Существующий save записывает CEFR metadata/tags
  и topics карточки. `serialize_deck` ставит `<<<LERNE_CARD>>>` перед каждой
  карточкой, включая первую после паспорта; старые файлы без первого разделителя
  и с `---` принимаются. Колодный ID до разделителя сохраняет область действия.
- Регрессии: `app/src/utils/__tests__/interactiveMarkers.test.js`,
  `scripts/tests/test_interactive_markers.py`, `scripts/tests/test_deck_passport.py`
  (наследование, приоритет, область колоды, изолированное сохранение, round-trip и
  оба формата первой карточки).
- Формат и правила генерации: [DECK_PASSPORT](../../docs/DECK_PASSPORT.md),
  [common.md](../../lerne-card-prompts/common.md), [validation.md](../../lerne-card-prompts/validation.md).

## Lesson QA и регрессии Relativsätze

- Read-only операторский CLI: `scripts/lesson_qa.py`; frontend diagnostics `app/src/utils/lessonQa.js`, Node adapter `tools/lesson_qa.mjs`. Использует текущие parsers/evaluator и канонический `deck_passport.py`, принимает folder/deck ID, snapshot или импорт «Автора».
- До API-import отключает legacy bootstrap/migrations; ID-режим открывает PostgreSQL-транзакцию `SET TRANSACTION READ ONLY`. Не читает learner history и не обновляет контент, SRS или metadata.
- `ExerciseRenderer` выбирает действительный directive block для Puzzle/Match/Free/Word Bank. Другие интерактивные exercise blocks не выводятся как information: иначе raw target/ключи становятся видимыми до ответа. Обычные инструкции и информационные блоки сохраняются.
- `clozeParser` отделяет bracket syntax до удаления Markdown, сохраняя несколько starred answers вместо ошибочной интерпретации как курсива.
- Инструкция: [LESSON_QA](../../docs/LESSON_QA.md). Реальные fixtures и отдельные неисполненные предложения: `reports/lesson-qa/`. Regression: `lessonQa.test.js`, `test_lesson_qa.py`, `test_lesson_qa_database.py`, `browser/lesson-qa.spec.cjs`.

## Structured cards V2 (opt-in)

- Contract: `api/services/structured_cards_v2.py` validates explicit type/data for all eight types; JSON Schema is generated from the models. Existing passport and grading-policy validators remain authoritative.
- One-way preview: `api/services/structured_cards_legacy.py` converts Theory, Standard, mixed Trainer, Match, Puzzle and single-correct Quiz to derived legacy fields, rejects unsupported/lossy cases, and never writes storage. Match preserves ordered pairs/duplicates as `@match` + `left => right`, rejecting lossy separators, edge whitespace, newlines and Markdown/control markup with pair/side paths. Puzzle preserves token occurrences/punctuation/translation; whitespace-bearing or lossy tokens fail by index. Quiz requires exactly one correct answer and rejects lossy question/option syntax by field. Multi-correct Quiz remains valid V2 but unrepresentable. V2 is not stored alongside editable FRONT.
- Offline CLI: `scripts/structured_cards_v2.py` (`validate`, `schema`, `to-legacy`). Admin «Автор» also has an isolated JSON V2 preview via `POST /api/admin/author/v2-preview`, `tools/admin/services/structured_preview.py` and `static/js/author.js`: authoritative loader, indexed field errors, all eight V2 types and independent per-card legacy projections through `to_legacy_card`. Unsupported/lossy projection is separate from V2 validity. No save/publish, learner import/UI/sync integration or migrations.
- Tests: `scripts/tests/test_structured_cards_v2.py` plus `tools/structured_cards_v2_compat.mjs` against actual frontend parsers and Trainer/Match/Puzzle/Quiz evaluators (Match exact pairs, interchangeable normalized right values, tile single-use, completion); `scripts/tests/test_structured_preview.py` and `scripts/tests/browser/structured-preview.spec.cjs` exercise upload, validation, mixed types, Match/Puzzle/Quiz legacy success/refusal, multi-correct refusal, XSS, error/retry/loading and mobile layout with a database-free server fixture; actual Puzzle/Quiz components also consume the generated projections in an isolated browser harness. Examples: `project_docs/examples/structured_cards_v2/match.json`, `puzzle_quiz.json`.
- Format, examples and staged transition: [STRUCTURED_CARDS_V2](../../project_docs/STRUCTURED_CARDS_V2.md).
