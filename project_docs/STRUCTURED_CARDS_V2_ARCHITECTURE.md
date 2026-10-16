# Structured Cards V2: нативное хранение и редактирование

Статус: **этапы 1 и 3A реализованы; этап 2 подготовлен** — неактивная схема,
Dexie v5 и guards основных legacy writers. В этапе 3B защищены операции
с отдельными карточками; остальные пути этапа 3B ещё не выполнены.
Нативные записи запрещены; native API, transport и обучение остаются планом этапов 4–9.
Аудит выполнен по ветке `feat/structured-cards-v2`, исходный HEAD `e812cb8`.
Контракты этапа 1 подготовлены после `3be89f7`, схема этапа 2 — после `5c077d3`.
Серверная миграция выполнялась только на одноразовой SQLite в тестах;
этот документ не разрешает её применение к рабочей БД или создание реальных V2 rows.
Контракт авторства: [STRUCTURED_CARDS_V2](STRUCTURED_CARDS_V2.md).

## 1. Решение и обязательные инварианты

Хранить структурированное содержимое непосредственно в существующей строке
`TMA_Card`, в отдельном `content_v2`. Добавить явный `content_version` и
серверную `card_revision`. Не создавать таблицу карточек V2, таблицу частей,
универсальное хранилище документов или второй механизм синхронизации.

- У legacy (`content_version = 1`) источником остаются прежние поля. Никакой
  автоматической конвертации существующих уроков, изменения их ID или поведения.
- У V2 (`content_version = 2`) единственный источник содержимого — `content_v2`:
  явные `type`, `data`, `info`, `explanation`, `level`, `topics`, авторские `metadata`, `id`.
- Текстовые поля строки V2 — только воспроизводимая проекция для списка/поиска.
  В ней нельзя редактировать содержание, проверять ответы или определять тип.
- Сохранение V2 не зависит от возможности `to_legacy_card`. Валидный multi-correct
  Quiz и буквальные legacy-маркеры должны сохраняться без потерь.
- Любой путь записи либо сохраняет весь V2 с проверкой ревизии, либо меняет строго
  перечисленные служебные поля, либо явно отказывает. Отсутствие V2 в запросе
  никогда не означает очистку, downgrade или разрешение заменить его FRONT.
- Старая ревизия, неизвестная версия и невалидный JSON не превращаются в legacy.
  Ошибка оставляет серверный оригинал и локальный черновик целыми.

## 2. Что действительно работает сейчас

Ниже пути относительно корня репозитория. Это результаты чтения кода, а не
описание уже существующей нативной поддержки. Pydantic V2 и preview сейчас
изолированы от хранилища.
Таблица фиксирует исходный аудит до этапов 1–2; подготовленные изменения схемы
и их ограничения описаны в разделе «Реализация этапа 2».

| Операция | Реальный путь и важное свойство | Что потребуется для V2 |
| --- | --- | --- |
| Серверное хранение | `api/models.py`: `TMA_Card` / `tma_card`; `front_text`, `back_text`, `context`, `metadata`, `topics`, `card_type`, media paths, deck FK. `metadata` — текст JSON. Отдельно существуют библиотечные `Card` / `card` и `Deck` / `deck`. | Расширить существующую строку, различать пользовательскую карточку и библиотечную копию. |
| Создание/правка | `useCardEditor.js` → `api.js` → `POST /cards/save`, `PUT/PATCH /cards/{id}` → `api/services/cards.py:save_card`. Клиент заново вызывает `detectCardType(front)`. Сервис частично обновляет поля, может переставлять стороны, извлекает CEFR/topics из CONTEXT, меняет TTS и history. Неизвестный ID может создать новую строку. | Новый строгий вход V2; запрет старого content-write для V2; никаких legacy-эвристик в нативной записи. |
| Чтение | `cards.py:_build_card_dict`, `format_card_for_study`, `get_cards_for_study`, `get_next_card`; часть запросов выбирает фиксированный набор колонок. Есть отдельный сериализатор `api/routers/study.py:_card_to_response`, search/duplicates/trash/share responses. | Расширить и SELECT, и сериализаторы. Успех одного GET не доказывает поддержку всех путей. |
| Учебный runtime | `ExerciseRenderer.jsx`, `exerciseDetector.js` и parsers получают FRONT. Puzzle дополнительно разбирается в компоненте. `answer_evaluation.py:load_answer_context` определяет Free Text по FRONT, читает ключи из `metadata` и BACK. | Для V2 выбирать ветку по версии и `content_v2.type`, подавать типизированные данные прямо в renderer/evaluator. |
| Dexie | `localDb.js`: отдельная `LerneLocalDB_<user>`, схема до v4; `cards` индексирует `id, deck_id, front_text, is_deleted, is_dirty`. Неиндексируемые свойства сохраняются без нового store. | Хранить V2-объект и ревизии в той же записи; upgrade без удаления данных. |
| Offline CRUD | `offlineApi.js`: `cardView`, `/cards/save`, batch move/copy/delete, restore, review. Save делает spread предыдущей строки, но не принимает произвольный V2; copy/overwrite явно перечисляют поля. `dirtyFields()` создаёт `local_revision` UUID. | Локальные валидатор, discriminator и запреты; сохранить envelope во всех копиях, не путать local_revision с серверной ревизией. |
| Выбор транспорта | `api.js`: online идёт в сеть; offline mode и network fallback используют `offlineApi`. Неподдерживаемый offline endpoint при доступной сети может перейти в online после sync. | Для V2 редактирования зафиксировать Dexie-first путь даже при online; не допустить обхода локальной записи fallback-логикой. |
| Основной sync | `syncService.js`: immutable `syncState.pending`, `payloadFor`, `acknowledge`, mappings/aliases, `applySnapshot`; `/sync/v2/push,pull` → `offline_sync.py`. Сервер пишет по `FIELDS` напрямую, последняя зафиксированная запись побеждает; поля topics/source отсутствуют в card allowlist. `OfflineCardItem` требует front/back, не описывает V2. | Расширение простым добавлением JSON недостаточно: нужны CAS, новый согласованный transport и полный envelope. |
| Другой sync | `/sync/push,pull` → `sync_service.py` содержит самостоятельные записи с timestamp comparison. `/sync/collab-pull` и `useCollaborativeSync.js` используют отдельную фиксированную проекцию. Хук делает `bulkPut` без проверки dirty и способен стереть новые поля. | Оградить старый push, обновить collaborative read/apply, защищать dirty/drafts. |
| Bulk import | `BatchCardModal.jsx`, `batchCardParser.js`, `usePendingImport.js` → `/cards/bulk-save` → `cards.py:bulk_save_cards`. `import_id` и `TMAOfflineBatch` обеспечивают повтор, но отдельные карточки пишутся с savepoints и возможен частичный успех. | Нативный документ валидировать целиком, сохранять атомарно; не наследовать partial-success контракт молча. |
| JSON import | `/decks/import-json` → `decks.py:import_deck_from_json`: читает `name/cards/front/back`, не V2, ищет колоду по имени и вставляет сокращённый набор полей. | Явно отклонять V2 на старом входе; отдельный native import, target ID и preview. |
| Автор / паспорт / TXT | `author_service.py`: parse/publish → bulk-save; `serialize_card/deck/folder`, export CLI/`tools/admin/routers/author.py`; паспорт находится в `TMA_Deck.metadata.intro/pedagogy`. `card_text_update.py` — общий preview/apply deck/folder с fingerprint, locks и receipt. | Не отправлять V2 через текстовый UPDATE; экспортировать нативный JSON, TXT делать только явной совместимой производной. |
| Перемещение/копирование | `cards.py:batch_move_cards/batch_copy_cards` и offline counterparts ищут совпадения по нормализованному FRONT; overwrite заменяет контент, move-overwrite удаляет исходник. `decks.py:copy_deck_to_folder` перечисляет поля и не копирует даже все текущие metadata/type/topics. | Не использовать FRONT как идентичность V2; блокировать опасный overwrite, копировать envelope и паспорт целиком. |
| Sharing / библиотека | `sharing_service.py:_clone_cards_batch`, single-card accept и replace; `decks.py:import_deck`, `sync_deck_with_library`, `promote_to_library`, starter imports. Сейчас используются списки полей, front/back equality, merge/replace и hard-delete/reinsert. | Полный перенос формата либо явный отказ до обновления пути. Замена колоды также способна уничтожить V2. |
| Удаление/восстановление | `cards.py`, `decks.py`, `folders.py`, `collaborative_service.py`: tombstones; `trash.py`: restore и окончательный hard delete. Dexie хранит dirty tombstones; полный snapshot удаляет clean записи, которых нет на сервере. | Сохранять JSON при soft delete/restore; не выдавать отфильтрованный snapshot за полный. |
| SRS/ответы | `TMAProgress` — `(user_id, card_id)`; `TMAReviewHistory` — rating/time/interval, без снимка контента. `study.py:update_card_progress` и offline review рассчитывают SRS отдельно. Knowledge mappings/attempts и свой outbox находятся в существующих моделях и `knowledge*Service.js`. | Сохранить card ID, не сбрасывать SRS, не переоценивать старые ответы по новому контенту. |
| Медиа | Paths/`image_data`, `TMAMedia`, `mediaCache.js`; `media.py:ensure_card_audio` сохраняет целую ORM-модель, а `/media/card-audio` в `routers/media.py` пишет отдельные поля после генерации. `useVoicePicker.js` отдельно обновляет Dexie audio paths. | Защитить от stale whole-row save и позднего TTS, сохранить references и permissions. |
| Админские обходы | `tools/admin/routers/cards.py`, `decks.py`, `folders.py`, `services/regen_worker.py`, `deck_helpers.py` напрямую меняют/клонируют карточки, иногда по совпадению FRONT между колодами. | Перед первой V2-записью каждый путь поддержать или закрыть для V2 и mixed-целей. |
| Операторские скрипты | `scripts/regenerate_deck_single.py`, `scripts/migrate_lesson_cards.py`, `scripts/fix_b1_quiz_db.py` присваивают FRONT/type и вызывают ORM save; в `scripts/archive/migrations/` есть прямые UPDATE/delete/create. | Активным инструментам — явный legacy-only guard и отказ для mixed scope до apply; архивные инструменты не считать совместимыми и не допускать к native данным. |
| Backup/restore | `backup_service.py:create_deck_backup/create_folder_backup` копирует `__data__`, но preview и restore собирают сокращённый legacy payload; replace сначала удаляет строки. Full backup — `tools/admin/routers/backups.py`. | Проверить не только JSON-файл, но восстановление V2 до допуска данных; старый restore блокировать. |

В документах подсистем встречаются frontend `cardTextExport.js`, `cardTextSerializer.js`
и другие `cardText*` entry points, которых **нет в дереве этого HEAD**. Реальный
текстовый экспорт здесь подтверждён через `author_service.py` и admin/CLI;
серверные text-update routes существуют. Не планировать интеграцию по отсутствующим файлам.

`api/models.py` при импорте может инициализировать БД и миграции. Для этого аудита
читались файлы; API/БД не запускались. `api/database.py` связывает оба DB proxy
с одним PostgreSQL connection owner; это не отменяет различия таблиц `card/tma_card`.

## 3. Сравнение хранения

| Вариант | Плюсы | Цена / причина выбора |
| --- | --- | --- |
| V2 в `metadata` рядом с FRONT | Нет новых колонок | Обычное сохранение/CEFR/AI может заменить metadata; формат не является явным контрактом строки. Высокий риск двух редактируемых оригиналов. Отклонён. |
| Только JSON в FRONT | Нет новой колонки содержимого | Ломает search, TTS, parsers, экспорт и старые клиенты; требует угадывать JSON по тексту или переопределять поле. Отклонён. |
| Новая таблица V2 или нормализация каждого parts/options/pairs | SQL-связи на элементы | Две схемы идентичности, joins, отдельные delete/copy/sync, сложнее атомарность; элементы пока не имеют независимого жизненного цикла. Отклонён. |
| Полный V2 + независимо изменяемый legacy | Можно оставить старый редактор | Нет однозначного способа объединить правки. Запрещён. |
| **V2 в отдельной колонке существующей карточки + производные поля** | Прежние ID/FK/SRS/медиа; одна атомарная запись; минимальное расширение | Выбран. Все writer paths обязаны соблюдать ownership; проекции полностью пересоздаются из JSON. |

Для первой реализации `content_v2` — nullable **TextField с каноническим JSON**,
как существующие JSON-поля проекта. В API/Dexie это объект, сериализация в строку
только на границе Peewee. Нет текущей потребности в SQL-запросах к parts/options;
JSONB не даёт нужного функционального выигрыша, но добавляет driver/SQLite-test
различия. JSONB можно выбрать позднее при измеримой необходимости поиска внутри
структуры; ни API, ни контракт редактирования от этого не меняются.

Подготовленные opt-in колонки в `tma_card` (не применены к рабочей БД):

| Поле | Контракт |
| --- | --- |
| `content_version` | SmallInteger, NOT NULL, DEFAULT 1; допустимы 1 и 2. Это версия содержимого, не sync protocol. |
| `content_v2` | Text, NULL для legacy; для 2 — сериализованный объект **одной** `Card` из `structured_cards_v2.py`, без deck/cards envelope. |
| `card_revision` | BigInteger, NOT NULL, DEFAULT 1, > 0; серверный монотонный номер всей общей записи карточки. |

DB CHECK фиксирует `(content_version=1 AND content_v2 IS NULL) OR
(content_version=2 AND content_v2 IS NOT NULL)`, положительную ревизию и допустимые версии.
Полную семантику JSON проверяет существующий Pydantic owner, не SQL-копия модели.
`content_version` выбирает валидатор; на диске не дублируется `schema_version`
каждого документа. Документ авторства по-прежнему имеет `schema_version: 2`.
Авторский строковый `Card.id` остаётся внутри JSON и не становится PK/FK.

Ревизия меняется при content, media reference, deck membership, position,
soft-delete/restore и общих metadata изменениях. Отдельные `TMAProgress`, ratings,
Knowledge attempts и настройки её не меняют. `updated_at` остаётся сигналом
доставки, а не защитой от конкурентного редактирования. Старые записи получают
version/revision по default без изменения FRONT, SRS и timestamps контента.

Библиотечная `card` пока остаётся legacy. До её расширения запрещены promotion,
default distribution и другие маршруты, которые переводят V2 в `card`. При
реальной необходимости нативной библиотеки добавить те же поля в **существующую**
таблицу и обновить её copy/merge paths отдельным этапом; новую таблицу не вводить.

### Производные поля и metadata

У V2 `front_text/back_text/context`, `card_type`, представление topics и CEFR в
старых колонках строятся одной детерминированной функцией из нормализованного V2.
Это display/search projection, **не** результат кодирования упражнения в legacy:

- front: `info` в порядке и видимый prompt/text/parts/pairs/tokens; пропуски
  заменены нейтральным знаком без правильных ответов;
- back: answer/summary/sample, ключи и варианты в читаемом виде для поиска автора;
  не используется как учебный ответ; context = explanation;
- порядок, Markdown и исходные значения в JSON остаются точными; строка поиска
  может склеивать значения, поэтому никогда не является ключом равенства карточек;
- `card_type = content_v2.type`. Нативная ветка не вызывает detector ни в списке,
  ни в renderer, ни в Knowledge capture, ни на сервере Free Text;
- extension metadata автора живут только в `content_v2.metadata`. Внешнее
  `TMA_Card.metadata` V2 содержит только отдельно разрешённые технические данные
  и производную CEFR-проекцию, без ключей ответов/второго экземпляра JSON.

Типовые правила проекции для всех восьми типов тестируются отдельно; cache
можно пересоздать без потери JSON. На любой native read следует возвращать
производное представление из актуального JSON либо проверенного cache той же
ревизии. Старая машина не получает эти поля как пригодный к учебе legacy.
Legacy exporter использует только явный `to_legacy_card`, отдельно от cache.
Нельзя возвращать авторский back/ключи в information blocks до ответа.

Исключение из самодостаточности одной карточки уже задано контрактом авторства:
`level/topics = null` наследуют паспорт колоды. Сохранять эти null в оригинале,
эффективные значения вычислять отдельно из V2 + актуального паспорта. Не заполнять
JSON наследованными значениями молча: это меняет поведение последующей правки
паспорта и нарушает round-trip. В DTO отдельно возвращать effective level/topics;
производные колонки не являются явными авторскими значениями.

## 4. Контракт записи и редактирования

Новый endpoint `POST /cards/v2/save` (проектируемый) использует существующие auth,
card service, permissions и media owners. Отдельный URL нужен, чтобы старый
сервер с permissive `dict` не проигнорировал V2 и не создал пустую legacy-карточку.
Он не заменяет текущие routes legacy. Content-save не делает move или media edit.

Пример обновления:

```json
{
  "request_id": "b1c1aab2-c89b-4f4a-9ff2-faa84d0ab7aa",
  "card_id": 125,
  "deck_id": 20,
  "base_revision": 7,
  "content_version": 2,
  "content_v2": {
    "id": "relative-1",
    "type": "standard",
    "info": [],
    "data": {"prompt": "Wer ist das?", "answer": "Das ist Anna."},
    "explanation": "",
    "level": "A1",
    "topics": ["Personen"],
    "metadata": {}
  }
}
```

На создание `card_id = null`, `base_revision = null`, target deck обязателен;
в sync используются отрицательные ID. Обновление отсутствующего/удалённого ID
возвращает 404/409, **не создаёт** новую запись. Числовой ID только во внешнем
envelope; `content_v2.id` не адресует существующую карточку. Неизвестные ключи,
включая `front/back/context/card_type/cefr` в этом запросе, отклоняются, а не игнорируются.

Последовательность в одном DB connection/transaction:

1. Строго загрузить JSON, отклонить duplicate keys, NaN/Infinity, неизвестную версию,
   проверить размер. Первичный предел — 256 KiB UTF-8 на карточку, 10 MiB на документ,
   1000 карточек на native bulk request; превышение 413 без записи.
   Duplicate keys проверять по raw request bytes до обычного JSON body parsing;
   после превращения тела в `dict` обнаружить их уже нельзя.
2. Проверить guest/access/deck membership, owner/editor по существующим правилам.
   Права на другие колоды из авторского metadata не принимаются.
3. Проверить receipt `TMAOfflineBatch` в namespace `card-v2:<user>:<request_id>`.
   Тот же UUID и payload hash возвращают тот же ответ; другой payload — 409.
   Повтор проверяется **до CAS**, иначе потерянный ответ будет ложным конфликтом.
4. Валидировать discriminated union `Card` существующими моделями. Для документа
   применять `load_document/validate_document`, passport/duplicate author IDs и
   межкарточные проверки. Не конструировать фиктивную колоду ради single-card validation.
5. Сохранить авторские level/topics, включая null. Для проекции на create/update
   независимо разрешать отсутствие/null через паспорт, как в действующем V2;
   `topics: []` явно отключает темы. Preview и форма показывают «из паспорта» рядом
   с effective values. «Зафиксировать текущее значение» явно записывает его в JSON;
   отсутствие уровня при непустом passport.level не маскируется под отдельный override:
   существующая схема такого состояния не выражает.
6. При UPDATE сравнить `card_revision = base_revision`, version=2 и активность;
   использовать conditional UPDATE с increment, проверить affected row count.
   Проверка только перед обычным `card.save()` не защищает от гонки. Для bulk/lifecycle
   использовать row locks в стабильном порядке и те же условия.
7. Записать нормализованный JSON и всю display projection вместе, увеличить revision,
   обновить timestamps/deck/ancestor notifications существующим механизмом. Не вызывать
   перестановку сторон, CONTEXT extraction или detectors из legacy `save_card`.
8. Записать receipt с каноническим ответом в той же транзакции; вернуть card DTO с
   `id`, `deck_id`, `content_version:2`, `content_v2`, `card_revision:8`, derived
   display, media references и прежними per-user SRS/annotations.

Single save, native bulk и sync вызывают один validation/CAS write core внутри
своей внешней транзакции. Sync/bulk имеют одну квитанцию на пакет, без независимых
покарточных commits/receipts. Namespace v3 (`sync-v3:<user>:<request_id>`) не меняет
hash или ответы уже существующих квитанций `/sync/v2`; старые pending можно закончить
по прежнему протоколу только для legacy, новые native pending создаются отдельно.

Нормализация добавляет объявленные моделью defaults, не trim/reorder/deduplicate
содержимое. JSON key order/whitespace файла не являются оригиналом; значения,
порядок массивов, повторения токенов/пар/вариантов и авторский ID сохраняются.

Ошибки: 422 с `code: invalid_content` и массивом `{path,message}` относительно
`content_v2`/`cards[i]`; 409 `card_revision_conflict` с актуальной ревизией и
серверным DTO после проверки доступа; 409 `content_format_conflict` при попытке
legacy-write/downgrade; 426 `structured_cards_client_required` для неподдерживаемого
клиента; 403 — права. Ничего не сохраняется частично. `content_v2:null` при version=2
не удаляет оригинал. Неизвестные версии дают unsupported-content state, без fallback.

### Редактор и границы черновика

Редактор выбирается **до** создания формы по content_version. V2 draft — копия
JSON, формы частей меняют эту копию. Сырой режим, если нужен, редактирует тот же
JSON и проходит тот же validator; FRONT не является альтернативным режимом V2.
Переключение типа — явная замена структуры с preview потерянных полей и возможностью
отмены до сохранения; универсального автоматического преобразования типов нет.

Локальная валидация использует генерируемую JSON Schema плюс необходимые
семантические проверки (references, unique options и т. п.); сервер всегда
авторитетен. Ошибка оставляет draft и подсвечивает path. При успехе UI принимает
канонический объект целиком, обновляет карточку в store/редакторе/study cache;
не пересобирает его из отправленного FRONT и не подставляет draft при неполном ответе.
Сохранение offline сообщает «на устройстве», серверное подтверждение — отдельно.
Возврат к списку сохраняет существующие scroll/selection invariants.

Пока V2-редактор не готов, V2 можно только просматривать/экспортировать нативно;
старую форму для него открывать нельзя. Legacy → V2 и V2 → legacy как изменение
формата существующей записи не входят в этот этап. Возможный будущий upgrade
потребует отдельного preview, явного решения пользователя и CAS; downgrade не
является обработкой ошибки сохранения.

## 5. Offline и протокол доставки

`/sync/v2` сейчас — legacy transport version 2. Ввести `/sync/v3/push,pull` для
native-capable клиента, переиспользуя существующие `offline_sync.py`, pending,
receipts и mappings. Новая версия wire contract оправдана тем, что старые Pydantic
модели игнорируют неизвестные поля, а старый push применяет full-row last-write-wins.
Отдельного движка sync, outbox таблицы или параллельного источника контента нет.

Клиент сначала проверяет capabilities сервера (`structured_cards: [2]`,
`sync_protocols: [3]`). Не считать HTTP 200 произвольного endpoint подтверждением
поддержки. Native save URL и v3 transport никогда не fallback на старые write routes.

В Dexie та же `cards` запись содержит content_version, content_v2 **как объект**,
последний `base_revision`, dirty/local_revision и derived fields. Серверная
card_revision не вычисляется из времени/UUID. Новый локальный объект до ack имеет
base_revision=null. Existing pending/dirty записи legacy сохраняются при upgrade;
отсутствующая версия в старом локальном объекте означает 1 только в legacy-контексте.
Новый DTO не может опустить discriminator. Новые индексы/таблицы не нужны; upgrade
нужен для инициализации локальных полей и сохранения совместимости pending payloads.

1. Native create/edit даже online сначала коммитит draft в Dexie-транзакции с
   dirty/local_revision. Если локального полного envelope/base нет, сначала загрузить
   карточку; не сохранять неполный online объект поверх кеша.
2. `pending` фиксирует точный запрос, UUID, base_revision и содержимое. Сериализовать
   JSON как объект на wire, не строкой двойного JSON. Media и lifecycle mutations
   передаются отдельно от content intent с allowlist; полный echo DTO не является PATCH.
3. Сервер v3 проверяет CAS для V2, в одной транзакции сохраняет entities, reviews,
   receipt и mappings. Ответ дополнительно содержит принятые card revisions и
   канонические V2 DTO. Без них клиент не очищает dirty. При любой content ошибке
   пакет полностью откатывается, reviews и mappings также не считаются доставленными.
4. Ack переводит временные ID во всех существующих местах (карты, deck links,
   progress, review events, aliases, Knowledge references при наличии), не авторский
   строковый `content_v2.id`. Если local_revision равна отправленной — принять
   канонический объект/ревизию и очистить dirty. Если пользователь успел изменить
   draft — сохранить новый JSON, обновить base_revision до принятой ревизии предка,
   оставить dirty; следующий пакет отправит новую правку. В одной карточке не может
   быть двух независимых неупорядоченных in-flight writers.
5. Pull/applySnapshot и collaborative apply принимают полный envelope. Dirty и
   конфликтные записи не заменяются серверным snapshot; конфликт хранит обе версии
   в существующем `syncState` (`card-conflict:<id>`). Нельзя partial `bulkPut` карточек
   по старому allowlist, а затем ставить is_dirty=0. При неполном delta дочитать DTO
   либо отложить применение, не догадаться о формате по FRONT.
6. CAS 409 требует выбора/ручного объединения локального и серверного JSON. Авто-
   merge частей, last-write-wins и молчаливый «сервер победил» запрещены. После
   разрешения — новый UUID и актуальный base_revision. Не менять payload старого UUID.
7. При timeout повторять **тот же** pending. Только после определённого ответа об
   откате можно заменить pending транзакционно. Чтобы конфликт не блокировал SRS
   навсегда, UI может отделить reviews/progress в новый пакет после такого отказа;
   перенести события, не копировать их в две живые очереди. Удалять review:* только
   после ack именно доставившего их пакета, проверяя review_count. Не пересчитывать
   SRS при серверном приёме уже рассчитанного offline progress.

Независимый Knowledge outbox продолжает свою idempotency по client_event_id.
Версия JSON Knowledge evidence не равна content_version или sync protocol.
Logout/switch account не удаляет unsent drafts; recovery UI доступен даже при
отзыве доступа, но не разрешает запись в чужую колоду.

## 6. Старые клиенты и полнота развёртывания

Безопасный минимум — **отказ**, а не выдача V2 как якобы редактируемого legacy.
У старого UI нет надёжного способа навязать read-only и multi-correct semantics.

| Запрос старого клиента | Политика после допуска native rows |
| --- | --- |
| Чтение/редактирование существующей legacy | Прежнее поведение и поля; внутреннее увеличение card_revision не требует поля от старого клиента. |
| Чтение V2 через cards/study/share/trash/export | 426 для затронутой операции. Совместимый клиент явно запрашивает поддержку content version 2 и получает полный DTO. |
| Full sync pull при наличии V2 в доступной области | Отказ всего snapshot, не фильтрация массива cards. Иначе старый applySnapshot удалит пропущенные локальные записи как hard-deleted. |
| Incremental/collab pull с V2 | Ошибка до выдачи/продвижения cursor, без частичного списка; после обновления клиента полный согласованный pull. |
| Старый save, PATCH, bulk, text-update, AI/admin write в V2 | Отказ до любых записей, даже если FRONT выглядит таким же. Нет извлечения структуры из входящего текста. |
| Старый `/sync/push` или `/sync/v2/push` с существующим V2 ID | Откат всего пакета с format/client conflict, включая tombstone/full-row echo. Missing JSON не очищает поле. |
| Старый точечный flag/review для доступного ID | Допустим по существующим правилам доступа: меняет только per-user progress/history. Никогда не пишет общий контент. |
| Старый move/copy/delete/restore/replace, затрагивающий V2 | Отказ до native-aware lifecycle контракта с revision. Проверять не только переданный ID, но все затронутые строки колоды/папки. |

Гарантия проверяется по **сохранённому** discriminator и целевым rows; client
capability не является авторизацией и не снимает validation/CAS. Запрос legacy
на создание с замаскированным V2 JSON не принимается как native.

На этапе совместного rollout старые клиенты ещё могут создавать legacy по старому
контракту; это явно ограниченный переходный период. **Финальный cutover**: новые
авторские карточки принимаются только как V2, старые create/bulk legacy получают
426. Правки существующих legacy продолжают работать. Копирование старой карточки
сохраняет её legacy-формат как копию старого контента, а не пытается угадать V2.
Legacy TXT/JSON создание после cutover возможно только через отдельный явный
conversion preview с выбором структуры; пока такого конвертера нет — отказ,
а не скрытое продолжение legacy-авторства. Это ограничение надо показать до cutover.

Перед первой настоящей V2-записью все серверные instances, админка и background
workers должны уже иметь guards. Нельзя одновременно обслуживать такие данные
старым build, который проигнорирует поля или сохранит stale ORM-модель. Отключение
feature flag останавливает создание, **не отключает** защиту и native reads.
Откат приложения к build до guards после появления V2 недопустим; recovery —
исправляющий релиз с сохранением колонок/данных, не DROP и не downgrade в FRONT.

## 7. Совместимость соседних данных и операций

### SRS, история и Knowledge

Обновление содержимого сохраняет числовой card ID, deck linkage, `TMAProgress`,
`TMAReviewHistory`, mappings KI и attempts. Не делает reset расписания и не
копирует пользовательскую историю в content_v2. Смена типа сама по себе не
доказывает изменение знания и не пересчитывает mastery.

Текущая history rating не содержит снимок старого вопроса: не обещать возможность
восстановить старый текст по review. Для новых Knowledge evidence добавлять
content_version/card_revision в разрешённый evidence contract; part references
трактовать только внутри этой ревизии. Не сопоставлять индекс gap из старого
ответа с новым массивом после edit. UI session state привязать к `(id, revision)`:
редактирование инвалидирует сохранённое решение, но не уже записанные ratings.
Исторические payloads остаются читаемыми без backfill. Таблица истории контента
для данного этапа не нужна; резервная копия и draft не заменяют audit log.

V2 Free Text context loader читает sample/accepted_answers/grading_policy из
`data`, task/source/example — из `info`, explanation — из своего поля. Переиспользует
`answer_contract.py`, deterministic/AI evaluator и права, не `detect_ai_input_type`.
Offline доступность AI остаётся прежним отдельным ограничением, не поводом
переписать V2 в legacy. Native Quiz с несколькими correct требует настоящего
выбора/оценки нескольких ответов до допуска к учебе; single-choice fallback неверен.

### Медиа

В V2 authoring schema сейчас нет attachment model. Поэтому файлы и references
остаются в прежних media columns/`TMAMedia`/cache, не добавляются в metadata JSON
карточки. Content-save не обнуляет paths и не принимает временные blob URLs за
постоянные references. Медиа-операции используют собственный allowlist, permissions
(включая can_edit_audio) и card_revision; не сохраняют whole-row stale model.

TTS-текст получается из типизированных данных, отдельно для сторон, без разбора
маркеров и без произнесения ключей в вопросе. При изменении соответствующего
spoken text content-save очищает reference только заведомо generated audio.
Новая генерация фиксирует origin и source fingerprint в техническом card metadata
для каждой стороны; старое аудио без provenance считается пользовательским,
сохраняется и получает видимое уведомление о необходимости проверки/перегенерации.
Файлы при content-save не удаляются. Генератор после I/O повторно проверяет revision/source fingerprint:
поздний результат не прикрепляется к уже изменённому вопросу. Очистка shared файлов
возможна лишь после проверки references, вне транзакции контента и без удаления
ресурса, ещё используемого копией. Визуальный media fallback остаётся существующим.

### Папки, колоды, паспорта, доступ

FK/ownership остаются прежними. Паспорт единожды хранится в deck.metadata, проходит
`deck_passport.py`, не копируется в каждую карточку. Native passport update показывает
изменение effective level/topics наследующих карточек; в той же транзакции обновляет
их derived fields и увеличивает card_revision, не меняя content_v2. Legacy passport
write в колоду с V2 до поддержки этой проверки отклоняется. При native import паспорт,
колода, порядок и карточки коммитятся вместе; диапазоны stages проверяются по
фактическому порядку/количеству. Перестановка, удаление, перенос и добавление,
меняющие применимость диапазонов, требуют preview/проверки паспорта под lock;
не переписывать stage ranges автоматически по догадке. Пока native lifecycle
не умеет показать результат — блокировать затронутую операцию.

Перемещение сохраняет card ID/JSON/progress; явные level/topics остаются прежними,
наследуемые пересчитываются из целевого паспорта и показываются в preview; derived
fields меняются вместе с membership/revision. Копия получает новый DB ID/revision=1, полный JSON,
media references и разрешённый provenance; новый share_id, никакого переноса чужого
progress/history. Копия колоды/папки сохраняет passport/metadata/language/order.
Наследованные авторские строковые IDs уникальны в документе, не глобальны; при
добавлении копии в тот же native document collision решается явным remap в preview.

Для V2 duplicate detection не использует front normalization. Можно сравнить
канонические version/type/info/data/explanation/level/topics (без авторского id и
provenance metadata), но это только предложение о совпадении, не право перезаписи.
На первом lifecycle этапе доступны keep/copy и skip подтверждённого структурного
совпадения. `overwrite` с любым V2 source/target запрещён; будущий overwrite требует
явного target ID/base_revision, preview обеих структур и политики identity/history.
Нельзя soft-delete source до подтверждённого атомарного сохранения target.

Co-op остаётся ссылкой на ту же строку с owner/editor/viewer и server permissions.
Share accept создаёт полную копию, не legacy-проекцию; share replace, library merge,
guest merge, default distribution и backup replace сначала проверяют **весь**
target scope на V2. Неподдерживаемый путь останавливается до удаления/замены колоды.
Soft delete/restore не трогает JSON. Hard delete остаётся явным действием корзины,
удаляет строку вместе с её содержимым и доставляется как прежде; проверка доступа
и зависимостей обязательна, автоматической «очистки старого V2» нет.

## 8. Импорт, экспорт и резервное восстановление

- Native authoring import принимает существующий `schema_version:2` документ,
  strict loader, все восемь типов, паспорт и порядок. Target deck/folder определяется
  явным ID/созданием из preview, не совпадением имени и не `Card.id` из JSON.
  `import_id`/receipt переиспользуются; один документ и receipt — одна транзакция,
  без частичного успеха. Metadata provenance не становится содержимым упражнения.
  Для добавления в существующую колоду preview дополнительно проверяет коллизии
  author IDs и паспорт относительно **итогового** состава/порядка. Коллизия — отказ
  или явный remap в редактируемом preview; молчаливого переименования нет. До
  реализации этой проверки первый native import разрешает только новую колоду.
- Повтор с тем же request_id/hash воспроизводит результат; update-by-ID — отдельная
  операция с DB IDs/base revisions. Обычный импорт всегда создаёт, а не обновляет
  карточку по совпадению авторского ID или FRONT.
- Native export одной V2-колоды возвращает существующий authoring document со
  всеми info/data/explanation/metadata и исходными level/topics (включая null), паспортом.
  Export → validate → import сохраняет структуру, повторения и политику проверки;
  SRS и DB identity не являются частью этого формата.
- Для mixed legacy/V2, папки, DB identity и media references нужен **архивный
  envelope** `archive_version:1`: дерево folders/decks с passport/metadata и
  упорядоченные card DTO `{id, deck_id, content_version, content_v2 | legacy,
  media, position}`. Это упаковка существующих DTO, не третья редактируемая модель
  содержания. Legacy содержит исходные поля без обратной конвертации; V2 — JSON.
  По умолчанию архив не переносит private reviews/progress. Файлы медиатеки —
  отдельный manifest/вложения, ссылки сами по себе не гарантируют наличие байтов.
- Экспорт TXT/MD для V2 — явный совместимый экспорт через `to_legacy_card`, с
  предупреждением о производности. Unrepresentable хотя бы одной карточки —
  полный отказ с paths, без пропуска карточки/частичного скачивания. TXT не backup V2.
- Legacy text-update (deck/folder/Автор) отклоняет каждый указанный V2 target,
  включая якобы unchanged запись, до apply. Fingerprint native update охватывает
  version, JSON, revision, membership и затронутый паспорт, не только FRONT.
- Старый `/decks/import-json` обязан отклонить native document/archive по версии
  до `get_or_create` и вставок. AI generation/enrichment V2 возвращает валидный V2
  draft с теми же CAS, а старый AI/regeneration не пишет V2 даже в админке.
- Backup должен содержать discriminator, полный JSON/revision, deck passport и
  прежние media fields. Существующий generic dump может собрать новые колонки,
  но этого недостаточно: preview/restore тоже проверяются. Старый сокращённый
  restore и replace в scope с V2 запрещены до реализации round-trip восстановления.
  Restore в копию назначает новые IDs/revision и mappings; восстановление на месте
  требует отдельного административного контракта, блокировки writers и проверки
  всех зависимостей. Не обещать сохранение SRS при текущем delete/reinsert restore.

## 9. Поэтапное внедрение и отдельные коммиты

Каждый этап допускает самостоятельный commit с указанными проверками. Наличие
колонок, успешный preview и feature flag по отдельности не разрешают native writes.

| Этап | Содержание отдельного изменения | Критерий проверки / допуск |
| --- | --- | --- |
| 1. Чистый контракт хранения — **реализован** | Single-card validator и строгие wire envelopes, normalizer/display projection и unit fixtures в существующем V2 module. Никаких подключений моделей/БД, routes, UI или миграций. | Все 8 типов; валидный unrepresentable V2 проходит; literals/повторы/пустые optional/metadata сохраняются; двойной normalize стабилен; invalid version/path/size отклоняются; input не изменяется. См. реализацию ниже. |
| 2. Неактивная схема — **подготовлен** | Explicit migration 87, opt-in model fields/CHECK, Dexie v5 с сохранением dirty/pending. Native creation запрещён в БД и Dexie. | SQLite fixtures: rerun/rollback, старые rows/counts/front/timestamps/SRS прежние, constraints работают. Fake IndexedDB: upgrade v1–v4, pending/reviews/aliases/outbox сохранены. PostgreSQL: проверен model DDL, реальное исполнение ещё не проверено. Live migration — только отдельная согласованная работа. |
| 3. Guards записи | Старые cards/bulk/text-update/sync, admin/regen/library/share/restore writer paths закрыты для V2. Разделить whole-row media saves. | В disposable fixtures каждый перечисленный bypass отказывает до записи/удаления; batch rollback проверяет JSON, SRS и receipts. Legacy happy paths прежние. Native создание всё ещё выключено. |
| 4. Полное чтение и backup | SELECT/DTO/поиск/duplicates/trash/share, capabilities и read guards; native/mixed export и restore в тестовую копию. | Ни один read/cache copier не теряет envelope; backup round-trip всех типов, unknown version fail closed; TXT refusal без частичного файла. Старый full pull не маскирует фильтрацию под полный snapshot. |
| 5. Доставка без потерь | v3 transport с CAS/receipts; Dexie-first, pending/ack/pull/remap, collaborative conflict apply; recovery UI данных синхронизации. | Edit A/B, retry после timeout, edit во время ack, reboot, отрицательные ID, stale delete/media, revoked access, old-client pushes и mixed batch с reviews; обе конфликтующие версии доступны. Feature flag прежний. |
| 6. Нативное обучение | Native typed adapters/renderers/evaluators и Free Text context, revision-keyed session/Knowledge evidence. Можно разбить по типам на отдельные коммиты, не меняя SRS. | Те же вердикты для представимых примеров; независимые V2 cases для multi-correct Quiz, литералов, repeats и grading policies. У V2 нет detector/parser FRONT calls. UI доказательства states/ширин; legacy regressions. Не включать тип до полного runtime покрытия. |
| 7. Нативный импорт под флагом | Новый atomic bulk save/import и разрешённые native lifecycle operations; остальные явно заблокированы. | Импорт всех типов и паспорта, retry/rollback/permissions, полный export/restore, обучение, два устройства и offline. Только после 2–6 и обновления всех writers можно разрешить реальные V2 rows. |
| 8. Редактор и cutover | Формы V2, JSON draft/error/conflict UX, типы и медиа; затем default new-card V2, запрет legacy create и старого AI/import создания. | Save/read/edit/reload/offline цикл всех типов, stale editor не перезаписывает JSON; legacy editing без изменений; старые клиенты получают объяснимый upgrade error. Cutover не включать, пока не определён доступный путь для нужных legacy imports. |
| 9. Необязательное расширение | Поддержать существующую библиотечную `card`, безопасный overwrite и явный upgrade legacy после отдельного аудита. | Полный clone/merge/default-distribution round-trip; отсутствие unsupported блокировок только там, где уже доказана сохранность. Без массового backfill старых карточек. |

Рекомендуемый следующий implementation шаг — **этап 3B**, guards оставшихся writer paths
на disposable fixtures при сохранении запрета native writes. Перед применением
схемы отдельно требуется execution-проверка на одноразовом PostgreSQL;
миграция рабочей БД и переключение schema-ready требуют отдельного согласования.
Нельзя считать всеобщее новое авторство готовым на этапе 7: это контролируемый opt-in;
цель «все новые авторские карточки — V2» достигается cutover этапа 8.

### Реализация этапа 1

Все модели и функции находятся в `api/services/structured_cards_v2.py`.
Схема содержимого по-прежнему одна: discriminated union `Card`, используемый
как `Document.cards`, так и `NativeContent.content_v2` и `validate_card`.

| Контракт | Реализованное поведение |
| --- | --- |
| `validate_card(value)`, `load_card(str \| bytes)` | Проверяют одну карточку без фиктивной колоды; тот же union и существующие владельцы passport/grading policy. |
| `normalize_card(value)` | Возвращает отделённый JSON-объект, добавляет defaults, сохраняет null, пустые optional, значения/порядок массивов, metadata и авторский id. Не trim/reorder/deduplicate. |
| `serialize_card(value)` | UTF-8-совместимый JSON: `ensure_ascii=False`, сортировка ключей, компактные разделители, запрет NaN/Infinity; повторная нормализация/сериализация стабильна. Форматирование и порядок ключей входного файла не сохраняются. |
| `project_card(value, passport=None) -> CardDisplay` | Литеральные display/search `front_text/back_text/context`, явный `card_type`, отдельные `effective_level/effective_topics`. Никаких legacy parser/detector/converter. |
| `CardSaveRequest`, `load_save_request(str \| bytes)` | Обязательны UUID-строка `request_id`, `deck_id`, `content_version:2`, полная `content_v2`, nullable `card_id/base_revision`. Create: оба null; update: оба положительные целые. Версия требует именно int. Отрицательные sync IDs не принадлежат этому single-save контракту. |
| `CardResponse` | Положительные числовые `id/deck_id/card_revision`, `content_version:2`, `content_v2`, `display:CardDisplay`, `media:CardMedia` (image_path/audio_path/audio_path_back). Авторский `content_v2.id` остаётся строкой/null. |
| `CardSaveResponse` | UUID-строка `request_id` и `card:CardResponse`. Это подготовленный content DTO; per-user SRS/annotations, lifecycle и transport responses ещё не подключены. |

Projection сохраняет порядок info; Trainer/Word Bank заменяют gap нейтральным `…`.
Quiz выводит prompt/варианты, back содержит все правильные. Match front содержит
левые элементы, back — упорядоченные пары; Puzzle — токены и перевод на back.
Trainer back содержит допустимые input answers, все choice-варианты и правильные
ключи; Free Text — sample и accepted answers. Это авторский cache, не учебный
payload: Puzzle может содержать правильный порядок, back — ключи. Нельзя подавать
его в legacy runtime или показывать back как information до ответа.

В отсутствие явных level/topics наследование берётся независимо из
`passport.intro`; `topics:[]` отключает наследование тем. Паспорт валидируется
существующим `validate_passport`, исходные карточка/паспорт не меняются.
Повторы токенов, пар, Word Bank options, info items, accepted answers и topics
сохраняются. Прежние требования уникальных Quiz/Trainer option.text и Trainer
input.answers действуют без ослабления: невалидные повторы отклоняются, не удаляются.

Размеры: 256 KiB на каноническую карточку с defaults (включая dict/model входы),
также 256 KiB на raw `load_card`; 10 MiB на raw document/save request и канонический
document, не более 1000 cards/document. Проверка raw размера выполняется до JSON
parsing; bytes декодируются строго UTF-8. Raw loaders отклоняют duplicate keys
на любой глубине и NaN/Infinity; после dict parsing duplicate keys уже недоступны.
Все wire models запрещают неизвестные поля, в частности независимые FRONT/BACK,
context, card_type, media и card_revision в save request. `content_v2:null` запрещён.
Pydantic ошибки сохраняют `loc` (включая discriminator tags), позволяющий указать
конкретный путь, например `content_v2.word_bank.data.parts[3].gap.option`.
Ошибки raw JSON — ValueError, превышение размера — `content_too_large`;
HTTP-коды 413/422, permissions/CAS/idempotency предстоит реализовать в routes/write core.

Изолированные проверки: `scripts/tests/test_structured_cards_v2_storage.py`,
21 test method с cases всех восьми типов. Fixture-loader обходит eager
`api.services.__init__`, блокирует imports `api.models/api.database` и legacy
конвертера; реальная БД, сервер и внешние сервисы не нужны.
Команда: `venv/Scripts/python.exe -m unittest scripts.tests.test_structured_cards_v2_storage -v`.

### Реализация этапа 2

- `api/migrations.py:run_structured_cards_v2_migration(database)` — явная миграция
  87, отсутствует в `MIGRATIONS`, fallback и startup `create_all_tables`.
  Принимает выбранный caller-ом DB object, не импортирует models/database и не
  читает connection secrets. Нужна отдельная транзакция; PostgreSQL использует
  advisory/table locks и local timeouts, SQLite — IMMEDIATE transaction.
- Добавляет только `content_version SMALLINT NOT NULL DEFAULT 1`, `content_v2 TEXT NULL`,
  `card_revision BIGINT NOT NULL DEFAULT 1`. Строки не UPDATE-ятся; старые значения,
  PK/FK, история, timestamps, media и SRS остаются прежними. CHECK проверяют
  связку version/JSON и положительную revision. Дополнительный именованный CHECK
  `tma_card_v2_creation_disabled` требует version=1: подготовленная схема ещё не
  допускает V2 rows даже при обходе API. `STRUCTURED_CARDS_V2_NATIVE_WRITES_ENABLED=False`
  не является переключателем через env; снять DB gate можно лишь отдельным будущим изменением.
- DDL и history marker коммитятся вместе. Повтор сверяет колонки, defaults и CHECK;
  неполные/untracked колонки или расхождение history/schema вызывают отказ без
  автоматического исправления. В SQLite CHECK добавляются вместе с последней
  колонкой без rebuild таблицы; индексы/триггеры/FK сохраняются.
- `api/models.py` подключает эти поля/CHECK к существующей `TMA_Card` только при
  `STRUCTURED_CARDS_V2_SCHEMA_READY=true` (или `1`). Default=false оставляет прежний
  SELECT/INSERT до явной подготовки БД. Флаг сам ничего не мигрирует и не разрешает
  native authoring. Порядок будущей активации схемы: существующая legacy таблица →
  отдельно согласованная миграция → проверка → restart с schema-ready; flag-off
  не удаляет колонки/данные. Библиотечная `Card/card` не расширялась.
- `app/src/services/localDb.js` объявляет Dexie v5: добавляет отсутствующие
  `content_version:1`, `content_v2:null`, `card_revision:1` в cards. Остальные stores
  и поля не меняются, local_revision не заменяется серверной ревизией. Существующие
  V2/unknown envelopes сохраняются при upgrade без downgrade. Pending request,
  payload и aliases/reviews/outbox не переписываются, включая старый payload без
  новых defaults; retry fingerprint остаётся прежним.
- Флаг native writes в Dexie также фиксирован false: hooks запрещают add/put/update
  V2/unknown содержимого, включая dotted updates и смешанные транзакции. Это
  временный запрет создания/изменения, не реализация guards/transport/runtime следующих
  этапов. Новые/перезаписанные legacy rows получают те же defaults. Полная обработка
  неподдерживаемого содержимого при чтении ещё не реализована.

Проверки этапа 2: 12 Python tests в `scripts/tests/test_structured_cards_v2_schema.py`
(SQLite in-memory, реальные opt-in/default модели с подменённым DB owner; PostgreSQL
DDL compilation без подключения); 6 Node tests в
`app/src/services/__tests__/localDbStructuredCards.test.js` (Dexie + fake-indexeddb,
upgrade v1–v4, повторное открытие, отказ/rollback upgrade и retry, flags/atomic writes).
Legacy offline sync дополнительно проверен существующими 10 тестами в обоих режимах
schema-ready. На реальном PostgreSQL и в браузере upgrade не исполнялся.
Рабочая БД, routes, SRS logic, protocol sync, учебный UI и deployment не менялись.

### Реализация этапа 3A

- Общий owner `api/services/legacy_card_writes.py:require_legacy_cards` читает
  **сохранённый** `content_version` отдельным SELECT, независимо от optional ORM
  fields и `STRUCTURED_CARDS_V2_SCHEMA_READY`. Отсутствие колонки в старой БД
  сохраняет legacy-поведение; V2 и неизвестные версии получают HTTP 409 с
  `detail.code=legacy_card_write_blocked`. FRONT и JSON для решения не разбираются.
  Проверка не кэширует schema readiness; неожиданные DB errors не превращаются в legacy.
- `cards.py:save_card` проверяет/блокирует строку до любых побочных записей в той же
  транзакции. Это закрывает POST `/cards/save` и PUT/PATCH `/cards/{id}`; для
  PUT/PATCH target задаётся URL, body `card_id` больше не перенаправляет запись.
- `bulk_save_cards` проверяет все разрешённые по старым правилам ID до квитанции,
  сохранений и форматирования. V2 — отказ всего запроса; поздний guard exception
  также откатывает пакет, не попадает в per-item `failed`. Legacy-only импорт
  сохраняет partial success, placement и idempotency. Replay проверяет и ID
  карточек из сохранённого результата, включая первоначально idless create.
- `/sync/v2/push` и `/sync/push` проверяют все положительные card ID перед
  folders/decks/cards/progress/reviews. Отказ включает full-row echo, tombstone,
  старый timestamp, повторяющиеся ID и mixed multideck batch. V2 receipt replay
  дополнительно проверяет реальные ID в temp-ID mappings. Чистые per-user
  progress/reviews разрешены по прежним permissions, общий контент не меняется.
- `card_text_update.py` проверяет ссылки на карточки в deck/folder preview/apply,
  в том числе unchanged, stale preview и успешный receipt replay. Guard вызывается
  до legacy-разбора текста. PostgreSQL writer checks используют упорядоченные
  row locks в транзакции записи; SQLite fixtures проверяют отказ/rollback.

Проверки: `scripts/tests/test_structured_cards_v2_guards.py` — 20 tests при
schema-ready=false; 19 passed и 1 ожидаемый skip старой схемы при true. Все БД
одноразовые SQLite in-memory; fixture DDL допускает V2 только внутри теста,
production native gate и миграции не меняются/не выполняются. Снимки всех таблиц
проверяют JSON/revision/media/history, SRS, review history, deck/folder timestamps
и receipts; SQL trace подтверждает отсутствие DML до mixed-batch отказа.
Четыре guard regression tests также запущены с исходниками writers из `a92efc9`
через in-memory import hook: все четыре обнаруживают прежние небезопасные записи.

Дополнительно: offline sync — 10 tests в каждом режиме schema-ready, bulk import —
10 tests (включая concurrent retry), native storage contracts — 21 tests;
text-update backend — 14 deck и 27 folder tests. Два прежних JS export round-trip
tests падают из-за отсутствующих уже в `a92efc9` `cardTextSerializer.js` и
`cardTextUpdateParser.js`; это ограничение дерева, не исправление этапа 3A.
PostgreSQL execution/concurrency ещё не проверены. Рабочая БД, UI, формат карточек,
миграции, merge и deploy не затрагивались.

### Этап 3B: операции с отдельными карточками

- `cards.py:batch_move_cards/batch_copy_cards/batch_delete_cards/delete_card`
  и `trash.py:restore_card` используют существующий `require_legacy_cards`.
  Проверяется сохранённая версия, включая schema-ready=false; неизвестная/null
  версия также получает 409 `legacy_card_write_blocked`. Старая схема без колонки
  продолжает работать. Native writes и DB/Dexie/sync/UI не изменены.
- Scope операции охватывает чтение, permissions, проверку версий и все записи.
  PostgreSQL блокирует исходники и целевые строки по ID до загрузки ORM-содержимого;
  повторный target SELECT FOR UPDATE закрывает и новые совпадения, вставленные
  после первой блокировки. Guard держит row locks до commit. SQLite использует
  BEGIN IMMEDIATE до чтений. Изменение версии между проверкой и записью исключено.
- Copy/move проверяют все разрешённые исходники и при overwrite — существующие
  цели совпадений по тому же нормализованному FRONT. Проверка всего набора идёт
  до INSERT/UPDATE/delete исходника и touch timestamps; mixed request не даёт
  частичного результата. Unrelated V2 и цели skip/keep не блокируют legacy writes,
  поскольку эти строки не меняются. Повторные ID обрабатываются один раз с
  сохранением порядка выбора. Viewer не может использовать creator_id для move/delete.
- HTTP routes сохраняют 409 и существующие проверки прав; services повторно
  определяют допустимые исходники внутри scope. Single restore остаётся owner-only,
  может вернуть родительскую колоду по прежним правилам, но не восстанавливает
  sibling cards. Проверка V2 предшествует и этому изменению родительской колоды.

Проверки `scripts/tests/test_structured_cards_v2_operations.py`: **26 tests** при
schema-ready=false; **25 passed, 1 expected skip** старой схемы при true. Все БД —
одноразовые SQLite; snapshot всех fixture-таблиц и SQL trace подтверждают отсутствие
DML и сохранность JSON/revision/deck membership/SRS/history/media при отказе.
Есть HTTP success/conflict/permissions, legacy overwrite и rollback позднего сбоя,
реальная конкуренция независимых SQLite connections; FOR UPDATE SQL и его порядок
проверены через fixture executor, **не на реальном PostgreSQL**. Пять регрессионных
тестов обнаруживают прежнее небезопасное поведение исходников `264cb6c` через
in-memory import, без изменения исходных файлов.

Существующие guards 3A: 20 passed при false, 19 passed + 1 expected skip при true;
bulk-import idempotency: 10 passed; collaborative delete: существующий сценарий
прошёл с подменённым до imports DB owner и отключённым bootstrap. Итого 101
успешное исполнение тестов/сценариев, 2 ожидаемых пропуска. Старый
`test_bulk_save_partial_failure.py` падает на ожидании текста ошибки
(ожидает «Нет прав»/PermissionError, получает `403: Access denied`); тот же отказ
воспроизведён на `264cb6c`, partial-success поведение и новый набор guards проходят.
Миграции и рабочие БД не запускались, merge/deploy не выполнялись.

**Остаток этапа 3B:** admin CRUD/bulk/regen и активные операторские скрипты,
deck/folder lifecycle, library/share/import-json,
backup restore/replace и stale whole-row media saves. Их проверки обязаны охватить
все затронутые source/target rows до удаления/копирования/записи. Этап 3 в целом
не завершён: никаких реальных V2 rows до закрытия этих путей и последующих допусков.

## 10. Риски и критерии приёмки

| Риск | Обязательное доказательство |
| --- | --- |
| Stale legacy/editor/admin silently overwrites V2 | Отрицательные тесты каждого writer из аудита; bytes/canonical JSON до и после равны, нет побочных delete/receipt/progress writes. |
| Две правки V2 теряют оригинал | Одинаковая base_revision: ровно один CAS succeeds, другой 409; draft и серверный JSON доступны для сравнения. Автоперезаписи нет. |
| Старый сервер игнорирует новое поле | Native URL/v3 недоступны → операция не отправляется на legacy path, локальный draft остаётся; смешанный deployment запрещён до native creation. |
| Pull/collab/ack уничтожает JSON | Fixtures с dirty rows, delayed ack, unknown version, incomplete delta и revoked grants; pending/local changes остаются после restart. |
| Legacy projection ограничивает V2 | Multi-correct Quiz и непредставимые литералы сохраняются/экспортируются/редактируются нативно; только совместимый TXT отказывает. |
| Copy/merge/restore теряет structure, passport или media | Сравнение канонического JSON, metadata/passport/order/media manifest после каждого разрешённого round-trip; неподдерживаемые пути не пишут ничего. |
| Изменение содержания сбрасывает обучение | Снимок всех progress/history/KI/attempts до/после edit одинаков; новые answers/evidence используют зафиксированную revision. |
| Native type снова выводится из текста | Fixtures с `@quiz`, `@free`, `[[...]]` как обычным текстом других типов; spies/контрактные тесты подтверждают отсутствие legacy detector/parser на V2 ветке. |
| TTS после долгого I/O прикрепляет старый звук | Конкурентная правка между start/finish отклоняет устаревший media result без whole-row save; shared file не удаляется. |
| Отказ пакета задерживает ratings | Retry того же request_id ровно один review; после явного abort/rebuild reviews не теряются и не дублируются. |
| Откат релиза уничтожает native data | Flag-off сохраняет native read/guards/экспорт, проверенный backup восстанавливается в отдельную копию; колонки не удаляются. |

Проверки следующих этапов выполняются на изолированной БД/fixtures; не импортировать
production models для «чистых» тестов без отключения bootstrap. Для документации
достаточны сверка с кодом, проверка путей/ссылок и diff. На этапе 1 runtime,
миграции, API, UI, SRS и sync **не меняются и не тестируются как реализованная V2-система**.
