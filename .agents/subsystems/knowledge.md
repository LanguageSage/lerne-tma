# Knowledge: KI, Attempts и mastery

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
