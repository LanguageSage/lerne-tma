# AI: генерация, промпты и оценка свободного ответа

## Scope

Генерация/обогащение карточек, batch contract, провайдеры, промпты и server-side free-text evaluation.
TTS — [media](media.md); feedback lifecycle — [study](study.md); persistence Attempts — [knowledge](knowledge.md).

## Primary entry points

| Задача | Файлы от корня репозитория |
| --- | --- |
| Генерация из формы | `app/src/hooks/useAiActions.js`, `app/src/components/common/CardForm.jsx`, `app/src/utils/aiCardResult.js` |
| Batch generation / enrichment | `app/src/components/modals/BatchCardModal.jsx`, `app/src/utils/batchAiResult.js`, `app/src/hooks/usePendingImport.js` |
| AI settings / prompts | `app/src/components/settings/AITab.jsx`, `app/src/components/settings/PromptsTab.jsx`, `app/src/store/useSettingsStore.js` |
| Сервер генерации | `api/routers/ai.py`, `api/ai_service.py`, `api/ai_clients.py`, `api/services/prompt_builders.py`, `api/services/input_parser.py` |
| Batch persistence | `api/services/cards.py` |
| Free-text клиент | `app/src/components/study/StudyCardFreeText.jsx`, `app/src/hooks/useFreeTextEvaluation.js`, `app/src/utils/freeTextEvaluationState.js`, `app/src/services/answerEvaluationService.js` |
| Free-text сервер | `api/services/answer_contract.py`, `api/services/answer_rules.py`, `api/services/answer_ai.py`, `api/services/answer_evaluation.py` |

## Data flow

1. Одиночная форма → useAiActions → `/cards/ai-generate` (alias `/ai/generate`) → ai_service → prompt/provider/parser.
2. Ответ обновляет черновик карточки; сохранение проходит через существующий cards flow.
3. BatchCardModal → generate-batch/enrich-batch → prepare_ai_batch → AI → save_ai_batch_result → результат по исходным строкам.
4. Pending import удерживает payload/`import_id` при неизвестном результате запроса; серверная квитанция позволяет повтор.
5. Free-text клиент → `/ai/evaluate-answer`; сервер загружает карточку, accepted answers, grading policy и primary KI.
6. Детерминированные правила пробуют exact/typo; затем bounded AI fallback возвращает валидированный verdict или unavailable.
7. Verdict идёт в существующий study lifecycle; Attempt сохраняется при grade через Knowledge capture.

## Source of truth

- Генерация и конфигурация: `api/ai_service.py`, клиенты провайдеров: `api/ai_clients.py`, сборка промптов: `prompt_builders.py`.
- Модели в `api/models.py`: `TMASetting`, `TMAUserPrompt`, `TMACustomPrompt`; выбор конкретного промпта проверяйте в caller.
- Формат результата и восстановление authored структуры определены input_parser, aiCardResult и batchAiResult.
- Batch receipt и карточки сохраняет `api/services/cards.py`; таймаут клиента не доказывает отсутствие серверного результата.
- Free-text result/policy определены `answer_contract.py`; эталон и `accepted_answers` / `grading_policy` берутся с сервера.
- `answer_evaluation.py` не записывает mastery и не создаёт новый канал persistence; grading summary переносится в Attempt evidence.

## Common symptoms

| Симптом | Первый участок проверки |
| --- | --- |
| AI переписал task/source или потерял тип упражнения | input_parser / prompt_builders / restore_exercise_content |
| Перевод или поля одиночной карточки неверны | useAiActions → aiCardResult → generate_card_fields |
| Batch rows перепутаны, частичный результат потерян | batchAiResult + batch contract + save_ai_batch_result |
| Повтор после таймаута создаёт карточки дважды | import_id/pending import и серверная AI receipt |
| Неверный free-text verdict / typo policy | load_answer_context → answer_rules → answer_ai |
| Free-text не завершает упражнение или считает попытку дважды | useFreeTextEvaluation / freeTextEvaluationState; см. [study](study.md) |
| Verdict верен, mastery не обновляется | [Knowledge capture/sync](knowledge.md) |
| Не стартует локальная AI-студия администратора | [Admin architecture](../ADMIN_ARCHITECTURE.md) |

## Search anchors

```sh
rg -n 'generate_card_fields|generate_batch_card_fields|enrich_batch_quiz_fields' api/ai_service.py api/routers/ai.py
rg -n 'prepare_ai_batch|save_ai_batch_result|import_id' api/services/cards.py app/src/components/modals/BatchCardModal.jsx
rg -n 'load_answer_context|evaluate_answer|evaluate_deterministic' api/services/answer_evaluation.py api/services/answer_rules.py
```

## Relevant tests

- Batch: `scripts/tests/test_ai_batch_contract.py`, `scripts/tests/test_batch_ai_generation.py`, `app/src/utils/__tests__/batchAiResult.test.js`, `scripts/tests/browser/batch-ai.spec.cjs`.
- Evaluation: `tests/test_answer_evaluation.py`, `app/src/services/__tests__/answerEvaluationService.test.js`.
- Lifecycle: `app/src/utils/__tests__/freeTextEvaluationState.test.js`, `app/src/utils/__tests__/freeTextLifecycle.test.js`, `scripts/tests/browser/free-text-evaluation.spec.cjs`.
Перед запуском проверяйте, подменены ли провайдеры и БД: часть scripts может вызвать внешние сервисы.

## Related docs

- [Cards](cards.md), [Study](study.md), [Knowledge](knowledge.md), [Media](media.md).
- [Backend skill](../skills/fastapi-backend/SKILL.md), [Verification skill](../skills/ai-harness-eval/SKILL.md).
- [Admin architecture](../ADMIN_ARCHITECTURE.md) — отдельные workers регенерации и bulk creator.
