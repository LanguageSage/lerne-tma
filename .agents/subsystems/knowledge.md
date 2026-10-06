# Knowledge: KI, Attempts и mastery

## Scope

Knowledge Items, связь карточки с primary KI, capture Attempts, отдельный outbox/sync, mastery-v1 и read-only diagnostics.
SRS-прогресс карточки — [study](study.md); free-text verdict — [ai](ai.md); entity sync — [sync](sync.md).

## Primary entry points

| Задача | Файлы от корня репозитория |
| --- | --- |
| Capture после grade | `app/src/hooks/useStudySession.js`, `app/src/services/knowledgeCaptureService.js` |
| Локальные KI / mappings / Attempts | `app/src/services/knowledgeDbService.js`, `app/src/services/localDb.js` |
| Отправка и lifecycle | `app/src/services/knowledgeSyncService.js`, `app/src/services/knowledgeSyncOrchestrator.js`, `app/src/hooks/useKnowledgeSync.js` |
| Diagnostics UI/client | `app/src/components/settings/KnowledgeDiagnostics.jsx`, `app/src/services/knowledgeDiagnosticsService.js`, `app/src/services/knowledgeDiagnosticsClient.js` |
| Sync / diagnostics API | `api/routers/knowledge.py` |
| Mastery / diagnostics projections | `api/services/knowledge_mastery.py`, `api/services/knowledge_diagnostics.py` |
| Схема | `api/models.py`, `api/migrations.py` |

## Data flow

1. Завершённое упражнение передаёт evidence в study session; grade вызывает `captureStudyKnowledgeAttempt`.
2. Capture находит primary KI, формирует self-rating или hybrid `evaluation_data` и ставит событие в Dexie outbox.
3. useKnowledgeSync запускает orchestrator для аккаунта; startup/online/visibility/periodic triggers инициируют drain.
4. knowledgeSyncService → `/knowledge/attempts/sync`; сервер проверяет payload, ownership и идемпотентность `client_event_id`.
5. Созданный raw Attempt обновляет mastery-v1 projection; duplicate не должен повторно добавлять contribution.
6. Подтверждённые created/duplicate события удаляются из outbox; транспортная ошибка возвращает batch в pending.
7. Diagnostics API читает raw Attempts и projections; rebuild вычисляет state из истории Attempts.

## Source of truth

- Схема сервера: `TMAKnowledgeItem`, `TMACardKnowledgeItem`, `TMAKnowledgeAttempt`, `TMAUserKnowledgeState` в `api/models.py`.
- Схема клиента: Dexie `knowledge_items`, `card_knowledge_items`, `knowledge_attempt_outbox`, `user_knowledge_state`.
- Primary mapping определяет, какой KI получает evidence; без него capture не создаёт Attempt.
- Raw `TMAKnowledgeAttempt.evaluation_data` — исходное evidence; `TMAUserKnowledgeState` — пересчитываемая mastery projection.
- `knowledge_mastery.py` владеет scoring и rebuild; feedback/grading summary не вводит отдельный mastery algorithm.
- Counters приходят из exercise lifecycle, self-rating — из grade; `interaction_count` остаётся описательным evidence.
- Capture failures не должны блокировать обучение; feature flag `VITE_KNOWLEDGE_LAYER_ENABLED` управляет клиентским слоем.
- Очередь Attempts и orchestrator отделены от `/sync/v2/*`; lifecycle должен учитывать смену аккаунта.

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
- Transport/lifecycle: `app/src/services/__tests__/knowledgeSyncService.test.js`, `app/src/services/__tests__/knowledgeSyncOrchestrator.test.js`.
- Diagnostics client: `app/src/services/__tests__/knowledgeDiagnosticsService.test.js`.
Не все service tests входят в `app/package.json` test script; выбирайте нужный файл и проверяйте его setup.

## Related docs

- Evidence/feedback: [KI-08.1](../../docs/KI-08.1.md), [KI-08.2](../../docs/KI-08.2.md), [KI-08.3](../../docs/KI-08.3.md).
- [Study](study.md), [AI](ai.md), [Sync](sync.md), [Auth](auth.md).
- [DB skill](../skills/db-mgmt/SKILL.md), [Verification skill](../skills/ai-harness-eval/SKILL.md).
