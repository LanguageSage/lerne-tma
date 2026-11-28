# Knowledge: KI, Attempts и mastery

## Android Offline A1

`materialKnowledge.js` валидирует необязательную секцию
`deck.values.metadata.knowledge` формата `{version: 1, items, mappings}` в текущем ZIP.
Идентификатор локального KI — стабильный `rule_code` с префиксом языка.
`parent_key` задаёт учебную иерархию, `prerequisite_keys` задаёт зависимости
между навыками. Импорт проверяет замкнутость и циклы обоих графов.
Две колоды могут объявить один ключ с идентичным определением. Изменение
определения требует увеличения `revision`, старый импорт не откатывает новую
ревизию. Повтор ключа в одной колоде либо конфликт определений отклоняется.

Привязки используют ID карточек текущего архива. Разрешены одна primary-связь и
несколько secondary-связей, с опциональными `complexity`, `ability` и `example_key`.
Импорт преобразует ID карточек и сохраняет привязки в транзакции импорта.
Переданный список `mappings` заменяет привязки
импортируемых карточек, включая пустой список. ZIP без списка сохраняет прежнюю
разметку и может объявлять узлы каталога. Экспорт
строит секции из актуальных связей, включая перемещённые карточки и нужные
узлы каталога. История и SRS в архив материалов не входят.
Перенос между языками удаляет несовместимые действующие привязки в транзакции
карточки и сохраняет исторические Attempts. Экспорт и сбор свидетельств
пропускают устаревшие связи с другим языком.
Для защищённых локальных правок импорт обновляет привязки после сравнения
типа, задания, текстовой опоры и данных упражнения. Правки медиа и оформления
сохраняются. Явный пустой набор снимает связи в том же языке. Изменение самого
задания при локальном сохранении снимает прежнюю методическую привязку.

Android Offline хранит каталог и привязки в канонических таблицах SQLite.
Проверка ZIP с привязками к новым карточкам отложена из-за порядка записи
при активных внешних ключах. Ограничения обмена и восстановления описаны
в [документе миграции SQLite](../../docs/SQLITE_MIGRATION.md).

При интеграции с параллельной работой сверить валидацию, транзакцию импорта и
снимок экспорта в `app/src/pilot/materialArchive.js`. Пересечение с Antigravity
включает импорт валидатора Native V2. При объединении сохранить позднюю запись
медиа, обработку защищённых карточек и нативный rollback.
Регрессию импорта и
повторного экспорта проверяет `standaloneMaterialArchive.test.js`.

## Android Offline A2

Обычное обучение передаёт замороженное свидетельство проверяющего в локальный
`/study/grade`. Транзакция сохраняет SRS, квитанцию и запись Knowledge
по UUID `action_id` основного навыка. Android использует `knowledge_attempts`
в SQLite, а браузер Standalone использует `knowledge_attempt_outbox` в Dexie.
Запись с тем же ID
защищает SRS и после очистки ограниченного списка квитанций. Переносимая часть
Attempt хранит стабильные ключи навыка и задания, отпечаток задания, результат,
оценку и фактически наблюдавшиеся поля помощи и проверяющего. Теория и
неразмеченные карточки проходят обычный SRS без Attempt. `writeLocalKnowledgeAttempt`
можно вызвать в транзакции будущей диагностики с идентификатором её действия.
Новые отпечатки grade включают нормализованные данные проверяющего.
Для старой операции сравниваются поля, присутствовавшие в прежнем формате
свидетельства. В исходном Attempt хранятся IDs ошибочных частей, типы и коды
ошибок, точка фиксации помощи и номер наблюдавшейся попытки.

Если отдельная операция Knowledge даёт сбой, откат транзакции позволяет сохранить
SRS с замороженным событием в квитанции. Startup и экспорт прогресса повторяют
запись; ожидающие квитанции остаются при обрезке и восстановлении. Успешное
восстановление записи и снятие флага атомарны. Если экспорт не может завершить
восстановление квитанции, он сообщает об ошибке, чтобы не создать неполную копию.
При сбое чтения разметки квитанция сохраняет наблюдение без навыка и профиль
показывает `historical_binding_required`. Recovery принимает подтверждённую
историческую primary-привязку по ID события, ключу и отпечатку задания.

Резервная копия с событиями использует область целостности `full-v3` и включает
исходные Attempts без локальных PK. Restore объединяет их по ID и отклоняет
конфликт содержимого в общей транзакции с SRS. Навыки и их привязки доставляет ZIP
материалов. События сохраняются и без установленной карточки. Старые `core-v1`,
`full-v1` и `full-v2` остаются читаемыми. Knowledge и SRS восстанавливают
ссылку на карточку общим сопоставлением основного и архивного ключей
(`material_key`). При конфликте ключей Attempt сохраняется без локальной ссылки.
Регрессия в
`standaloneOfflinePilot.test.js` проверяет откат, сбой записи, повторный запуск,
дубликаты, контрольную сумму и восстановление.

## Android Offline A3

Локальный `api.get('/knowledge/profile')` возвращает каталог, измерения навыков,
слабости и число ожидающих записи свидетельств. Чтение вызывает
`projectKnowledgeMastery({ skills, attempts, now })` из `utils/knowledgeMastery.js`.
Расчёт не использует Dexie или платформенные API. Проекция вычисляется по запросу
из исходных Attempts. Ссылки на доступные карточки получаются по индексу привязок
только для выявленных слабостей.

Политика `offline-mastery-v1` определена в `KNOWLEDGE_MASTERY_POLICY` и тестируется
в `knowledgeMastery.test.js`:

- Quiz, Match и наблюдаемый режим Trainer choice дают распознавание.
  Trainer input/mixed, WordBank, Puzzle и Editable Text дают применение
  с опорой. Старое наблюдение Trainer без известного режима учитывается
  консервативно. Проверенный ответ Free Text
  даёт свидетельство воспроизведения. Самостоятельное применение требует явной
  разметки, явного отсутствия каждого вида статической опоры и наблюдаемых нулей
  по всем видам помощи.
  Текущий обычный Free Text наблюдает помощь частично. Несовпадение с образцом
  остаётся неопределённым результатом.
  Фактический режим Trainer записывается в standalone после выбора режима
  каждого пропуска, включая переход на ввод. Формат Web callback прежний.
  При интеграции с Antigravity сохранить вычисление режима из итоговых
  `gaps` в `structuredStudyCard.js`.
- Вес проверенного свидетельства зависит от измерения (0,85–1,00).
  Наблюдаемая помощь умножает вес на 0,60, неполное наблюдение — на 0,80.
  Самооценка имеет отдельное измерение с весом 0,25. Раскрытие ответа
  исключает объективный вклад. Успех после ошибки в детерминированном
  упражнении даёт 0,40 и сохраняет сигнал о трудности.
- Повторы события, карточки, одинакового содержимого задания и авторской
  группы примеров не увеличивают разнообразие. Вклад группы определяется
  её последним проверенным наблюдением в данном измерении.
- Два независимых примера позволяют оценить измерение. Подтверждение требует
  трёх квалифицирующих успехов и среднего результата от 0,80. Для слабости
  нужны ошибки на двух независимых примерах и средний результат до 0,55.
  Сравнение порогов использует целочисленные тысячные доли весов и оценок.
  Confidence — сумма весов, делённая на три с ограничением до единицы.
  После 90 дней без подтверждения или актуального свидетельства confidence
  уменьшается вдвое. Подтверждённое освоение и слабость получают статус
  повторной проверки. Proficiency от давности не меняется.

Пилот `scripts/tests/browser/standalone-knowledge.check.cjs` использует внешний
снимок Native V2 по явному пути. Он читает сохранённые `content_v2`
для D14 (358375, 358377) и D10 (358530), загружает
три карточки в чистом браузерном профиле и проходит реальные Trainer/SRS формы
без внешней сети. Повторная установка материала и восстановление проверяют
пересчёт истории при иных локальных ID. Материалы в Git и в CI не попадают.
Запуск из корня через `node scripts/tests/browser/standalone-knowledge.check.cjs <snapshot> [python]`.

Серверный Web остаётся на `mastery-v1`. Синхронизация локальных Attempts с ним
и унификация оценок между контурами остаются отдельной работой.

- A4 — передавать оценённые попытки в `writeLocalKnowledgeAttempt` из
  транзакции диагностики. Начальную самооценку хранить отдельно от Attempt.
- A5 — читать `/knowledge/profile` вместе с SRS и целями ученика, используя
  предпосылки и доступность материалов как входы маршрута.
- A6 — выбирать примеры по привязкам навыка и группе задания, возвращать
  проверенные результаты практики и поздней перепроверки в те же Attempts.

## Scope

Knowledge Items, связь карточки с primary KI, capture Attempts, отдельный outbox/sync, mastery-v1 и read-only diagnostics.
SRS-прогресс карточки — [study](study.md); free-text verdict — [ai](ai.md); entity sync — [sync](sync.md).

## Primary entry points

| Задача | Файлы от корня репозитория |
| --- | --- |
| Capture после grade | `app/src/hooks/useStudySession.js`, `app/src/services/knowledgeCaptureService.js` |
| Локальные KI / mappings / Attempts | `app/src/services/knowledgeDbService.js`, `app/src/services/localDb.js` |
| Загрузка KI перед обычным study / assessment | `app/src/services/knowledgeContentService.js`, `app/src/hooks/useStudyNavigation.js` |
| Отправка и lifecycle | `app/src/services/knowledgeSyncService.js`, `app/src/services/knowledgeSyncOrchestrator.js`, `app/src/hooks/useKnowledgeSync.js` |
| Diagnostics UI/client | `app/src/components/settings/KnowledgeDiagnostics.jsx`, `app/src/services/knowledgeDiagnosticsService.js`, `app/src/services/knowledgeDiagnosticsClient.js` |
| Sync / diagnostics API | `api/routers/knowledge.py` |
| Mastery / diagnostics projections | `api/services/knowledge_mastery.py`, `api/services/knowledge_diagnostics.py` |
| Схема | `api/models.py`, `api/migrations.py` |

## Data flow

Все шесть Knowledge API выполняют SQL и собирают ответы внутри `db_worker`.
Auth освобождает своё соединение отдельно. В sync границей записи остаётся
транзакция одного события с advisory lock на пару пользователь–KI. Она
объединяет вставку Attempt и обновление Mastery, а повтор обрабатывается по
существующему event ID. Worker освобождает соединение и при ошибке транзакции.
Study grade сохраняет SRS отдельно от доставки Knowledge.

1. Обычный `startStudy` / `startStudyCard` и assessment загружают KI/mappings через общий `prepareDeckKnowledge`. Offline использует кэш; ошибка Knowledge не блокирует обычное обучение. Завершённое упражнение передаёт evidence в study session; только подтверждённый grade вызывает `captureStudyKnowledgeAttempt`.
2. Capture находит primary KI, формирует self-rating или hybrid `evaluation_data` и ставит событие в Dexie outbox.
3. useKnowledgeSync запускает orchestrator для аккаунта; startup/online/visibility/periodic triggers инициируют drain.
4. knowledgeSyncService → `/knowledge/attempts/sync`; для нового события сервер проверяет активную карточку, доступ к её колоде и точное primary KI для всех типов evidence. Если указан review, он должен принадлежать этому пользователю и карточке. Новые cardless события отклоняются; формат v1/v2/v3 не меняется. Идентичный повтор уже принятого события подтверждается даже после снятия mapping/доступа, изменённый payload возвращает `event_conflict`.
5. Созданный raw Attempt обновляет mastery-v1 projection; duplicate не должен повторно добавлять contribution.
6. Подтверждённые created/duplicate события удаляются из outbox; транспортная ошибка возвращает batch в pending.
7. Diagnostics API читает raw Attempts и projections; rebuild вычисляет state из истории Attempts.

## Source of truth

- Optional `support_evidence`/`task_support` подключены к Free Text и Trainer choice/input: общий владелец `utils/supportEvidence.js` внутри `freeTextEvaluationState` либо opt-in `exerciseEvaluation`; остальные exercise sessions не включают наблюдение. Trainer регистрирует реальные открытия перевода и inline hints по пропускам, заданные позиции/лексика хранятся отдельно (`trainerTaskSupport`). v2 фиксирует до feedback завершающей проверки, v3 — до feedback первого classified результата (`assessmentTrainerEvidence` сохраняет прежнюю correctness policy). Покрытие неполное; ноль не означает самостоятельность. При resume незавершённого Assessment без live истории текущая карточка получает unknown prefix через `supportHistoryUnknownCardId`, передаваемый обоим типам. Старые события не дополняются; Mastery/SRS не читают поля. Контракты, источники, проверки и ограничения: [Free Text](../../docs/LERNE_ADAPTIVE_SUPPORT_EVIDENCE.md), [Trainer / локальный D14](../../docs/LERNE_ADAPTIVE_TRAINER_SUPPORT_EVIDENCE.md).

- v2 Free Text сохраняет последний classified `target_relevance` как optional `exercise_evidence.grading_summary.final_target_relevance` (primary/secondary/none). Missing не заменяется none; none может быть default checker. Поле не используется scoring, не backfill-ится в старый outbox и не добавлено в v3. Проверки и ограничения: [отчёт](../../docs/LERNE_ADAPTIVE_FINAL_TARGET_RELEVANCE.md).

- Схема сервера: `TMAKnowledgeItem`, `TMACardKnowledgeItem`, `TMAKnowledgeAttempt`, `TMAUserKnowledgeState` в `api/models.py`.
- Схема клиента: Dexie `knowledge_items`, `card_knowledge_items`, `knowledge_attempt_outbox`, `user_knowledge_state`.
- Primary mapping определяет, какой KI получает evidence; без него capture не создаёт Attempt.
- Native V2 card/deck copy retains authored `TMACardKnowledgeItem` mappings (primary/secondary, complexity, weight) via the existing transactional `structured_card_api._clone`. Personal Attempts, mastery records and SRS are never cloned. Edit/move/soft delete/restore retain source IDs and linked records. All-nine-type Chromium/HTTP/PostgreSQL regression: `structured_cards_postgres.py --learning-browser`; details and remote-checker offline limits: `project_docs/STRUCTURED_CARDS_V2.md`, stage 6B.6.
- Raw `TMAKnowledgeAttempt.evaluation_data` — исходное evidence; `TMAUserKnowledgeState` — пересчитываемая mastery projection.
- `knowledge_mastery.py` владеет scoring и rebuild; feedback/grading summary не вводит отдельный mastery algorithm.
- Counters приходят из exercise lifecycle, self-rating — из grade; `interaction_count` остаётся описательным evidence.
- Capture failures не должны блокировать обучение; feature flag `VITE_KNOWLEDGE_LAYER_ENABLED` управляет клиентским слоем.
- Очередь Attempts и orchestrator отделены от `/sync/v2/*`; lifecycle должен учитывать смену аккаунта.
- Загрузка контента и операции capture/outbox закрепляют исходную Dexie-базу до первого await; sync передаёт `_expectedUserId` существующему auth interceptor. После logout закрытая база сохраняет syncing-события для существующего stale recovery при следующем входе. Ответ sync обрабатывает только IDs отправленного batch; отсутствующие результаты возвращаются в pending.
- GET `/knowledge/decks/{deck_id}` дополнительно отдаёт `card_ids` активных карточек, включая неразмеченные. Загрузчик атомарно заменяет mappings этих и локально кэшированных карточек колоды, не удаляя outbox. Старый ответ без `card_ids` поддерживается по локальным карточкам и возвращённым mappings. KI обновляются при наличии сети также в offline-first/native режиме.

## Common symptoms

| Симптом | Первый участок проверки |
| --- | --- |
| После grade нет Attempt | Capture call → feature flag → primary KI mapping → enqueue |
| Exercise errors не попали в grading summary | Study evidence → knowledgeCaptureService evaluation_data |
| Outbox растёт, события не доходят | useKnowledgeSync → orchestrator → auth → HTTP/results statuses |
| Повтор сети увеличивает mastery дважды | client_event_id, duplicate path и apply_created_attempt |
| Mastery расходится с историей | score_knowledge_attempt / rebuild и валидность raw evidence |
| После смены аккаунта отправляются старые события | Lifecycle generation/user ID и Dexie ownership |
| Diagnostics показывает расхождение | knowledgeDiagnosticsService → diagnostics API → stored/recomputed projection |

## Search anchors

```sh
rg -n 'captureStudyKnowledgeAttempt|exercise_evidence|grading_summary' app/src/services/knowledgeCaptureService.js app/src/hooks/useStudySession.js
rg -n 'client_event_id|duplicate|apply_created_attempt' api/routers/knowledge.py api/services/knowledge_mastery.py
rg -n 'startKnowledgeSync|stopKnowledgeSync|currentGeneration|pending' app/src/services/knowledgeSyncOrchestrator.js app/src/services/knowledgeSyncService.js
```

## Relevant tests

- Schema/server: `tests/test_knowledge_item_schema.py`, `tests/test_knowledge_sync.py`, `tests/test_knowledge_mastery.py`, `tests/test_knowledge_diagnostics.py`.
- Capture/outbox: `app/src/services/__tests__/knowledgeCaptureService.test.js`, `app/src/services/__tests__/knowledgeDbService.test.js`.
- Сквозные client-service регрессии: `app/src/services/__tests__/knowledgeFlow.test.js` (cold cache, offline, missing KI, remapping, rollback, late response, logout/account switch, partial sync).
- Реальный study hook → API adapter/Dexie → capture: синтетические Knowledge-сценарии в `scripts/tests/browser/study-latency.spec.cjs`. API transport изолирован; это не browser → PostgreSQL E2E.
- Opt-in Chromium/hooks → TCP HTTP/Uvicorn с настоящими routers/auth → одноразовая native PostgreSQL: `python scripts/tests/run_knowledge_http_postgres.py --bin-dir <PG-bin>`. Проверяет grade/capture/mastery, offline entity+Knowledge sync, восемь конкурентных отправок с наблюдением PG advisory waiters, подмену происхождения, remapping/unmapping и смену аккаунта с поздним ответом. Не входит в изолированный `npm run check`; требует PostgreSQL binaries и Chromium. Границы и доказательства: [HTTP/PostgreSQL отчёт](../../docs/LERNE_ADAPTIVE_HTTP_POSTGRES.md).
- Transport/lifecycle: `app/src/services/__tests__/knowledgeSyncService.test.js`, `app/src/services/__tests__/knowledgeSyncOrchestrator.test.js`.
- Diagnostics client: `app/src/services/__tests__/knowledgeDiagnosticsService.test.js`.
- D14 draft diagnostic contract: [rubrics и границы](../../docs/LERNE_ADAPTIVE_D14_DIAGNOSTIC_CONTRACT.md), `app/src/services/__tests__/adaptiveDiagnosticContract.test.js` (отдельно test-only reference semantics и текущие capture/assessment), golden compatibility в `tests/test_knowledge_mastery.py`. Никакого runtime diagnostic admission/scoring эти тесты не добавляют.
Не все service tests входят в `app/package.json` test script; выбирайте нужный файл и проверяйте его setup.

## Related docs

- Evidence/feedback: [KI-08.1](../../docs/KI-08.1.md), [KI-08.2](../../docs/KI-08.2.md), [KI-08.3](../../docs/KI-08.3.md).
- [Study](study.md), [AI](ai.md), [Sync](sync.md), [Auth](auth.md).
- [DB skill](../skills/db-mgmt/SKILL.md), [Verification skill](../skills/ai-harness-eval/SKILL.md).

## Objective assessment evidence

GET /knowledge/decks/{deck_id} отдаёт разрешённые KI/mappings активных карточек для кэша. assessmentService атомарно записывает локальную сессию и schema_version=3/evaluation_type=assessment в существующий outbox. Sync проверяет доступ, primary KI, payload и stable session:card event ID. Верный/неверный ответ даёт objective evidence, skipped хранится без mastery; self-rating отсутствует. Legacy v1/v2 не изменены. Контракт: [ASSESSMENT](../../docs/ASSESSMENT.md). Optional raw `target_relevance` переносится из checker первой зафиксированной Free Text проверки; whitelist primary/secondary/none, unknown опускается, skip/unavailable не получают диагностику. Это заявление checker, не доверенное доказательство ошибки; Mastery v1 игнорирует поле. Frozen outbox/event ID не меняются. Детали: [v3 relevance](../../docs/LERNE_ADAPTIVE_ASSESSMENT_TARGET_RELEVANCE.md). Регрессии: assessmentEvidence.test.js, knowledgeFlow.test.js, test_knowledge_sync.py и test_knowledge_mastery.py; настоящий HTTP/PG — scripts/tests/run_knowledge_http_postgres.py.


## Единая проверка регрессий (этап 1.1)

Из корня: `npm run check`. Команды, перечень изолированных suites, CI gate,
матрица покрытия и ограничения: [TESTING](../../docs/TESTING.md).
Отдельный backend suite запускайте через `scripts/test_backend.py`, чтобы
сохранить блокировку production-сервисов и загрузки `.env`.


## Conditional Study content cache

`GET /knowledge/decks/{deck_id}?revision=...` checks current permissions first,
then fingerprints sorted active card IDs, mappings and linked KI values. Any
mapping/item edit, deletion, reassignment or active-card membership change
invalidates the fingerprint. Equal revisions return only `revision` and
`unchanged: true`; SQL reads remain necessary because no new schema/counters
are introduced. This is content validation, not an HTTP permission cache.

The existing account-scoped Dexie `syncState` stores `knowledge-content:{deckId}`
in the same transaction as content replacement; non-rejected cache keys are
ignored by `cardCutoverPreflight` so cached content never blocks `syncService.sync()`. An unchanged response performs
no content writes. Pending loads coalesce by database instance/deck; a confirmed
Study capture waits for the original database's pending load before looking up
primary KI. It does not block card presentation or grade navigation. Account
changes still prevent capture in another account. Outbox contents are never
replaced with the content cache. Missing KI or unavailable content retains the
existing non-blocking/no-fabricated-evidence policy.

Regression coverage: `knowledgeFlow.test.js`, `test_knowledge_sync.py`,
`study-latency.spec.cjs`, and the disposable Study performance harness.


A confirmed grade accepted while content is loading first persists its frozen
Knowledge evidence in the existing outbox with `sync_status: awaiting_content`,
a stable event ID and the owning deck ID. Such rows never enter HTTP sync with
an unknown KI. A successful (including unchanged) content read atomically
promotes them to pending using the primary mapping, or removes them when the
authoritative content has no primary KI. Failed/interrupted loads retain them.
Knowledge sync revalidates the referenced decks on its existing startup/online/
periodic triggers, so closing/reopening the database does not lose early evidence.
No new Dexie store or schema migration is introduced. Regression:
`early confirmed evidence survives interrupted content load and database reopen, then syncs once`.
