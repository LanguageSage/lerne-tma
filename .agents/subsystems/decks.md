# Decks: колоды, папки и жизненный цикл

## Scope

Иерархия папок, колоды, порядок и видимость, learning toggle, sharing, библиотека, импорт и корзина.
Содержимое карточки — [cards](cards.md); выбор следующей карточки/SRS — [study](study.md).

## Primary entry points

| Задача | Файлы от корня репозитория |
| --- | --- |
| Сетка и навигация | `app/src/components/deckgrid/DeckGrid.jsx`, `app/src/components/deckgrid/DeckCardItem.jsx`, `app/src/components/deckgrid/FolderTreeNav.jsx` |
| Модальные действия и импорт | `app/src/components/modals/DeckModals.jsx`, `app/src/components/modals/ImportModal.jsx`, `app/src/components/modals/TrashManager.jsx` |
| Состояние | `app/src/store/useDeckStore.js`, `app/src/store/slices/createDeckSlice.js`, `app/src/store/slices/createFolderSlice.js` |
| Библиотека / sharing / trash | `app/src/store/slices/createLibrarySlice.js`, `app/src/store/slices/createShareSlice.js`, `app/src/store/slices/createTrashSlice.js` |
| Колоды и папки на сервере | `api/routers/decks.py`, `api/services/decks.py`, `api/routers/folders.py`, `api/services/folders.py` |
| Sharing / trash / collaboration | `api/routers/share.py`, `api/services/sharing_service.py`, `api/routers/trash.py`, `api/services/trash.py`, `api/routers/collaborative.py`, `api/services/collaborative_service.py` |

## Data flow

1. DeckGrid / DeckModals → действия slices, собранных в `useDeckStore.js`.
2. Действия используют `app/src/services/api.js`: online routes либо `offlineApi.js` и Dexie.
3. Колоды/папки сохраняются в `TMA_Deck` / `TMA_Folder`; порядок и learning status возвращаются в store.
4. Библиотечные данные `Deck` / `Card` импортируются через отдельные library/share действия.
5. Soft delete и восстановление проходят через trash; совместный доступ — через collaborator permissions.
6. Запуск обучения передаёт контекст в `app/src/hooks/useStudyNavigation.js`; дальнейший поток — [study](study.md).

## Source of truth

- `useDeckStore.js` объединяет доменные slices; состояние папок/колод не принадлежит отдельной модалке.
- `api/models.py`: `TMA_Deck`, `TMA_Folder`, `TMA_Card`, `TMA_Collaborator`; библиотека — `LibraryCategory`, `Deck`, `Card`.
- `folder_id`, `parent_id`, `position`, `is_deleted` и learning status проверяйте на записи и при фильтрации.
- Язык обучения принадлежит `app/src/store/useLanguageStore.js`; язык интерфейса — `app/src/i18n/i18nContext.jsx`.
- Study completion использует общий порядок/видимость колод через `app/src/utils/studyFlow.js`.
- Серверные permissions определяют право записи; наличие колоды в UI не даёт права изменять её.

## Common symptoms

| Симптом | Первый участок проверки |
| --- | --- |
| Колода пропала или попала в другую папку | DeckGrid filters → folder/deck slice → `folder_id` / `is_deleted` |
| Кнопка «Учить» не меняет статус | DeckCardItem → `toggleDeckLearning` → deck router / offline handler |
| После сортировки порядок откатывается | `reorderDecks`, `position`, результат API и [sync](sync.md) |
| Следующая колода после занятия неверна | `studyFlow.js` и [study](study.md), затем видимость в DeckGrid |
| Импорт/копия/шаринг теряет данные | Соответствующий slice → share/deck services |
| Соавтор видит колоду, но не может изменить | Collaborative permissions и роль `TMA_Collaborator` |
| Удалённая колода появляется снова | Trash flow, soft delete и синхронизация tombstones |

## Search anchors

```sh
rg -n 'toggleDeckLearning|reorderDecks|folder_id' app/src/store/slices/createDeckSlice.js app/src/components/deckgrid/DeckGrid.jsx
rg -n 'parent_id|position|is_deleted' api/services/folders.py api/services/decks.py
rg -n 'TMA_Collaborator|permission|role' api/routers/collaborative.py api/services/collaborative_service.py
```

## Relevant tests

- Learning toggle: `scripts/tests/browser/deck-learning.spec.cjs`.
- Общая видимость/следующая колода: `app/src/utils/__tests__/studyFlow.test.js`.
- Позиции: `tests/test_deck_position.py`.
- Permissions: `scripts/tests/test_collaborative_permissions.py`, `scripts/tests/test_collaborative_fixes.py`.
Integration/browser scripts могут менять данные; сначала проверяйте setup.

## Related docs

- [Cards](cards.md), [Study](study.md), [Sync](sync.md).
- [USER_MANUAL](../../docs/USER_MANUAL.md) — колоды, папки, импорт и корзина.
- [Admin architecture](../ADMIN_ARCHITECTURE.md) — отдельные админские операции над колодами.
