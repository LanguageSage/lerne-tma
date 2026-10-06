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
- Категории команд редактора — `exercise`, `marker`, `edit`; все работают с текущим выделением исходного текста. Восстановление фокуса/selection/scroll находится в CardContentEditor.
- В online-режиме результат сохраняет сервер, в offline — Dexie; перенос данных описан в [sync](sync.md).
- Порядок карточек, удаление и повторный импорт определяются серверной логикой и соответствующими offline handlers.

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
