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

- `fetchDeckCards` связывает запрос с `getUserId()` и существующим
  `libraryRequestId` (включая его увеличение в `resetDeckStore`). Дедупликация
  действует только для актуального запроса; устаревшие success/error/retry не
  меняют карточки и loading нового контекста. Очистка pending принадлежит
  конкретному запросу, а не только ID колоды. Регрессии смены аккаунта, сброса,
  повторной загрузки и loader: `scripts/tests/library_store_regression.mjs`;
  реальный Dexie/offline API и обычный запуск обучения:
  `scripts/tests/browser/offline.spec.cjs`, `scripts/tests/browser/study-finished.spec.cjs`.

- Android browser library loading: `scripts/tests/browser/library-mobile.spec.cjs`
  (`critical`, Pixel 7 Chromium, isolated APIs) and
  `scripts/tests/library_store_regression.mjs`. Zustand owns `libraryStatus`
  (`idle`, `ready`, `cached`, `error`) and safe `libraryError.status`;
  `isFetchingDecks` tracks requests independently. Only validated server arrays
  confirm an empty account. The paired deck/folder refresh preserves previous
  data on either failure; error and cached states offer retry. A failed `/init`
  may recover through the existing `/decks` + `/folders` endpoints.
  Account ownership accepts `user_id` or legacy `user_info.user_id`; unknown or
  mismatched caches are ignored in place. Missing cached root `parent_id` is
  treated as null. Diagnostic evidence and limits:
  [LIBRARY_ANDROID_DIAGNOSTIC](../../docs/LIBRARY_ANDROID_DIAGNOSTIC.md).

- Аудит permissions 1.4: [отчёт](../../docs/MATERIAL_PERMISSIONS_AUDIT.md).
  `python scripts/test_backend.py scripts/tests/test_material_permissions.py`:
  owner/editor/viewer/outsider, inherited/global access, copy/import/trash и sync.
  Copy использует чтение источника и запись назначения; авторство сохраняется.

- Learning toggle: `scripts/tests/browser/deck-learning.spec.cjs`.
- Общая видимость/следующая колода: `app/src/utils/__tests__/studyFlow.test.js`.
- Позиции: `tests/test_deck_position.py`.
- Permissions: `scripts/tests/test_collaborative_permissions.py`, `scripts/tests/test_collaborative_fixes.py`.
Integration/browser scripts могут менять данные; сначала проверяйте setup.

## Related docs

- [Cards](cards.md), [Study](study.md), [Sync](sync.md).
- [USER_MANUAL](../../docs/USER_MANUAL.md) — колоды, папки, импорт и корзина.
- [Admin architecture](../ADMIN_ARCHITECTURE.md) — отдельные админские операции над колодами.

## Экспорт колоды / папки

- Пункты существующих меню в `DeckCardItem.jsx` и `FolderTreeNav.jsx` вызывают `useCardTextExport`; доступны также viewer, поскольку экспорт только читает данные.
- Папка включает все вложенные папки, в порядке полностью раскрытого дерева навигации и store; читаются полные списки карточек через существующий API-клиент без смены текущей колоды.
- Заголовки `# Deck:` перед FRONT уже совместимы с парсером. Они не создают колоды: обычный импорт добавляет весь файл в выбранную колоду.
- При ошибке любой колоды частичный файл не скачивается; пустое содержимое и повторное нажатие во время загрузки обработаны.
- Формат, ограничения и тесты: [CARD_TEXT_EXPORT](../../docs/CARD_TEXT_EXPORT.md).

## Обновить колоду из файла

- Отдельный пункт DeckCardItem открывает `DeckTextUpdateModal` через useUiStore/App/navigation. Для viewer действие отключено; сервер независимо проверяет collaborative permissions.
- POST `/decks/{id}/text-update/preview` и `/apply` в `api/routers/decks.py`: строгие контентные модели, авторизация, синхронный сервис в собственном connection context. Учебный контент принадлежит существующей колоде; обновление не меняет SRS/пользовательский прогресс.
- Только одна online-колода. Локальные dirty изменения сначала синхронизировать; применение неизвестного/чужого ID, критических ошибок и устаревшего preview блокируется целиком. Новые карточки без ID добавляются только явно; отсутствующие не удаляются.
- Идентификация, транзакции, retry и тесты: [CARD_TEXT_UPDATE](../../docs/CARD_TEXT_UPDATE.md).

## Обновить папку из файла

- Пункт FolderTreeNav вызывает тот же DeckTextUpdateModal, с folder target в useUiStore/App/navigation. Preview показывает общие счётчики и группы колод; карточки раскрываются с «было/стало». Новые требуют явного флажка.
- POST `/folders/{id}/text-update/preview` и `/apply` в `api/routers/folders.py`. Pydantic-проекции общие с deck-router: `api/routers/card_text_update_models.py`. Общий сервис `api/services/card_text_update.py` переиспользует compare, content UPDATE и receipt.
- Backend проверяет owner/editor папки и каждой колоды, а также цепочку parent_id от колоды до выбранной папки. Apply всех групп — одна транзакция, на PostgreSQL stable row locks. Fingerprint охватывает только затронутые колоды/их контент/состав и relevant пути; SRS и колоды вне файла его не меняют.
- Account-scoped Dexie `folder-text-update:{id}` хранит exact request до HTTP apply. Shared TMAOfflineBatch receipt делает повтор безопасным; pending пересекающийся deck/folder запрос нужно разрешить до нового обслуживания. Миграций нет.
- Тесты: `folderTextUpdate.test.js`, `test_folder_text_update.py`, `browser/folder-text-update.spec.cjs`. Размер/совместимость/транзакция/limitations: [FOLDER_TEXT_UPDATE](../../docs/FOLDER_TEXT_UPDATE.md).


## Classic: глобальный дизайн и предпросмотр

- `app/src/components/settings/DesignTab.jsx` остаётся встроенной административной вкладкой. В «Общее» находятся фон, панели, кнопки, типографика интерфейса и независимые акценты.
- Новые поля принадлежат `global.background`, `global.panels`, `global.buttons`, `global.typography`, `global.details` в `DEFAULT_DESIGN_CONFIG_V2`. Нормализация дополняет старые V2, ограничивает новые числа/цвета и не меняет front/back/exercises/cardList.
- `background.mode: legacy` сохраняет старый `appBg`; пустые цвета panels сохраняют `glassBg`/`glassBorder` вместе с их исходной прозрачностью. Новый цвет и alpha генерируются независимо. Общие кнопки используют `designUi.css`; SRS `.btn-grade` и отдельные семантические exercise-токены исключены.
- `useSettingsStore` сохраняет черновик в кеш `lerne:admin-draft:v2` и `/admin/design/draft`. Для администратора редактирование черновика автоматически активирует локальный предпросмотр (`isLocalDesignPreviewActive`), применяя токены ко всему приложению в текущем браузере с плавающим бейджем `LocalDesignBadge` («Дизайн: только у меня») и кнопкой быстрого отключения; не-администраторы видят только опубликованный дизайн.
- Пресеты применяют настройки исключительно к разделам `['front', 'back', 'cardList']`, не затрагивая раздел «Общее» и упражнения; поддерживается кнопка «Отменить». Доступно восстановление черновика с сервера (`loadAdminDraftFromServer`) и перенос прежних личных настроек браузера (`importLegacyPersonalDesign`).
- Все 247 CSS-токенов подключены к реальным компонентам (квиз, банк слов, свободный ввод, match, puzzle, кнопки, карточки списка, разделители, обратная сторона) с сохранением дефолтных стилей через выровненные значения `DEFAULT_DESIGN_CONFIG_V2`.
- `GeneralDesignPreview` использует `DesignPreviewScope`, реальные FolderCardItem/DeckCardItem, DeckIntro с необязательным `previewData` и LessonCompletion с демонстрационными props. Данные колод/сессии не записываются в store; capture-обработчики блокируют навигацию и запись из preview. Доступная ширина ограничивает выбранный размер. Примеры кнопок позволяют проверить hover/pressed/disabled.
- Учебные карточки и CardList читают опубликованный V2 (или черновик при включённом локальном просмотре); личные typography/front/back настройки и SRS/статистика не изменяются.
- Проверки: `app/src/design/__tests__/designConfig.test.js`, `designTokens.test.js`; `scripts/tests/browser/design-editor.spec.cjs` перехватывает API и внешние запросы, покрывает JSON, черновик, confirm/cancel, локальный просмотр, ошибки, восстановление, реальные CSS-значения и 320/375/430/768/1080px. Внешние данные и production-публикация в тестах не используются.

## Импорт папки с медиа (локальная Windows-админка)

- Контракт манифеста, ограничения и команды проверок: [ADMIN_FOLDER_IMPORT](../../docs/ADMIN_FOLDER_IMPORT.md).
- `/api/admin/author/folder-import/preview` и `/apply` в `lerne-admin:src/lerne_admin/routers/deck_import.py`; отдельные модули `lerne-admin:src/lerne_admin/services/deck_import{,_sources,_media,_limits}.py`, интерфейс `static/js/folder_import.js`. Выбор TXT/MD/JSON-файлов из папки, подтверждение и отдельный media-only режим; ZIP исключён.
- Идентификация использует существующий `card_id` и `TMAOfflineBatch` receipts. Неоднозначные строки требуют ручного выбора. Новые карточки создаёт прежний bulk-save; существующие получают только медиа-поля/updated_at. Авторство, владельцы, ответы, metadata карточек, SRS/история не меняются. Права повторно проверяются на сервере; подготовка Storage идёт вне транзакции привязок.
- Проверки: `lerne-admin:tests/test_admin_folder_import.py`, `lerne-admin:tests/browser/admin-folder-import.desktop.cjs`; одноразовая SQLite, Storage подменён, браузерный стенд на 8059. Только настольная компоновка ПК/ноутбука. Код `tools/` и `scripts/` исключён из deploy через `.vercelignore`.

## Методический паспорт (локальный Автор)

- Контракт и инструкция: [DECK_PASSPORT](../../docs/DECK_PASSPORT.md).
- `api/services/deck_passport.py` — чистая валидация и объединение только переданных intro/pedagogy; `author_service.parse_document` извлекает отдельные блоки паспорта до разбора карточек. `parse_cards_text` сохраняет прежнюю проекцию карточек и явно отклоняет неверный паспорт.
- `metadata.intro` совместим с существующим редактором; `metadata.pedagogy.schema_version: 1` хранит план, компетенции, критерии и явные условные рекомендации. Другие ключи metadata сохраняются, миграций нет.
- Локальная админка «Автор»: parse/preview, структурированный черновик основных полей и этапов, JSON остальных полей, сравнение с текущей колодой; `passport_only` обновляет только существующие колоды выбранной папки без записи карточек/SRS. Обычная публикация по-прежнему добавляет карточки при повторе, что явно показано в интерфейсе.
- Все колоды, паспорта, карточки и новая папка публикуются в общей транзакции; partial bulk-save отменяет весь импорт. Обновление карточек с паспортом использует внешний fingerprint/receipt и существующие card update permissions/транзакции.
- Экспорт Автора сохраняет индивидуальные паспорта, включая пустые колоды, и author order position/id. CLI поддерживает паспорт вместе с карточками и publish --passport-only.
- DeckIntro показывает сворачиваемый авторский маршрут, LessonCompletion — учебное описание и рекомендации без вывода об освоении. Метрики занятия остаются в sessionStats; пользовательские настройки и offline metadata API сохранены.
- Проверки: `scripts/tests/test_deck_passport.py`, `app/src/utils/__tests__/deckPedagogy.test.js`, `scripts/tests/browser/deck-passport.spec.cjs`; DB одноразовая SQLite, browser API подменены.

## Связанные изображения в импорте Автора

- При выборе нескольких файлов `lerne-admin:src/lerne_admin/routers/author.py` отделяет изображения JPEG/PNG/WebP/GIF от документов. Markdown-ссылка `![описание](путь/файл.png)` или строка `::image путь/файл.png` в карточке задаёт явную связь. Structured Cards V2 поддерживает поле карточки `image` с относительным именем файла.
- Манифест `*.images.json` содержит `{"images":[{"deck":"Название колоды","card":1,"file":"файл.png"}]}`. `card` — глобальный номер карточки в загруженных документах (с 1) или строковый `id` карточки V2. Название колоды должно совпадать точно.
- `resolve_import_images` сначала ищет точный относительный путь, затем уникальное совпадение по имени файла. Отсутствующие, неоднозначные и не привязанные к карточке записи манифеста показываются в предпросмотре и блокируют публикацию. После успешного сопоставления текстовая ссылка удаляется из содержимого карточки, а исходная ссылка остаётся в `image_ref` для проверки при публикации.
- `POST /api/admin/author/publish-images` получает исходные файлы и проверенную проекцию карточек, оптимизирует связанные изображения в WebP и сохраняет `TMAMedia` вместе с карточками в одной DB-транзакции. Обычный `/publish` остаётся для документов без изображений. Файлы изображений ограничены 10 МБ каждый.
- Проверки: `lerne-admin:tests/test_author_router.py` покрывает Markdown, V2, манифест, отсутствие и неоднозначность, а также сохранение изображения.

## Защита повторной загрузки библиотеки

- `createDeckSlice.runLibraryLoad` координирует `/init`, парную загрузку `/decks` + `/folders` и отдельную загрузку папок. Повторные запросы одного вида используют ожидающий Promise; `fetchFolders` присоединяется к уже выполняющейся парной загрузке. После удаления папки выполняется только парная загрузка.
- `libraryRequestId` и ID аккаунта запрещают устаревшим ответам, ошибкам и завершениям менять новое состояние. `resetDeckStore` увеличивает поколение даже при повторном входе той же учётной записи. Устаревший `/init` прекращает retries и fallback.
- Fallback из кеша заполняет отсутствующие коллекции независимо: имеющиеся колоды не блокируют восстановление папок и наоборот. Серверный init-кеш при этом не перезаписывается.
- `local` init восстанавливает текущую колоду/экран и запрашивает её карточки до раннего выхода; серверные настройки, профиль и init-кеш не применяются.
- Регрессии: `node scripts/tests/library_store_regression.mjs`; синтетические API/storage и deferred Promise, без сети и БД.
- Если `/init` устарел и завершился раньше нового обновления библиотеки, его завершение ожидает актуальную загрузку в той же сессии, после чего снимает `loading` и выставляет `hasInitialized`. Адресная регрессия: `superseded init completes initialization when the newer library refresh finishes last` в `library_store_regression.mjs`.


## Персональное изучение и Telegram-напоминания

- `DECK_LEARNING_{user_id}_{deck_id}` в `TMASetting` — единственный серверный источник личного `is_learning`. Отсутствие записи означает false; metadata не источник и не место записи. API выдаёт личное поле отдельно, очищает старое metadata-поле в проекции; offline использует прежние per-account Dexie и `learning_dirty`.
- `DeckCardItem` показывает действие опубликованным/shared viewer колодам; права записи контента остаются прежними. `LearningShortcutsBar` видна и в папках, открывает deck_intro мышью/клавиатурой, сохраняет SRS counters.
- `api/services/reminder_service.py` читает персональные flags только доступных колод через существующий collaborative resolver и агрегирует `TMAProgress` текущего пользователя. Default reminders off; существующие явно сохранённые настройки сохраняются. Получатель только Telegram identity активного auth account, без fallback на account ID.
- Cron использует атомарный `LAST_REMINDER_ATTEMPT_{user_id}` перед I/O, успешные слоты остаются в `LAST_REMINDER_SLOTS_{user_id}`. Неопределённую отправку одного слота автоматически не повторяем; следующий слот независим. Схема не меняется.
- Контракт, changed files, LOCAL/PostgreSQL/browser checks и production prerequisites: [LEARNING_REMINDERS](../../docs/LEARNING_REMINDERS.md). Изолированный suite: `scripts/tests/test_learning_reminders.py`; одноразовый LOCAL PG: `scripts/tests/learning_reminders_postgres.py`; browser: `deck-learning.spec.cjs` и адресный offline-viewer regression.


## Personal learning contract (review 2026-10-29)

The source of `is_learning` is `TMASetting.DECK_LEARNING_<user_id>_<deck_id>`;
missing or explicit 0 means false, 1 means true. Deck metadata cannot opt any user
in, including the owner. A viewer/editor may change only their own preference.
`toggle_deck_learning`, `/decks`, offline-v2 pull and reminders follow this rule.
Changing the preference does not change cards, SRS or review history. Regression
matrix and unchanged-progress snapshots: `scripts/tests/test_sync_read_queries.py`
and `scripts/tests/test_learning_reminders.py`. Review:
`docs/ADMIN_CONTRACT_REVIEW_20261029.md`.
