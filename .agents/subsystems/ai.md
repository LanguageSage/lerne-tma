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

## Одиночный разбор существующего Quiz

- В CardEditor у Quiz одна AI-кнопка «Разбор теста» (`quiz_analysis`); панель действий находится между FRONT и BACK. Генерация в CardCreator и остальные типы сохраняют прежние действия.
- `generate_card_fields` также направляет legacy `full_card` для распознанного Quiz в этот контракт. Используется существующий `build_quiz_prompt`: fallback на пользовательский промпт другого типа не подменяет разбор. Модель и провайдер берутся из существующего `get_ai_config`.
- Модель получает полный исходный FRONT с `::task`, `::source`, `::exercise`. Он не возвращается и не применяется; CardEditor меняет только back/context и отбрасывает ответ, если за время запроса сменились карточка или FRONT. CEFR, tags и медиа разбор не меняет.
- JSON модели содержит обычные текстовые `back/context`. Сервер проверяет перевод вопроса, нумерованные переводы и объяснения всех вариантов, непустые разделы «Объяснение», «Словарный запас», «Грамматика» из существующего промпта и отсутствие буквальных `\n`/`\r`. Принятый текст возвращается без пересборки. Проверка разделов не доказывает содержательную точность перевода.
- Строгий `extract_json_from_text` принимает полный JSON объект (допустимы ограждение ```json и конечный END_JSON). Повреждённые ответы больше не восстанавливаются regex; обрезка по токенам у провайдеров считается ошибкой.
- Для разбора: temperature=0.1, max_output_tokens=8192; максимум две попытки на сервере, по одному ключу и без вложенных transport retries. Клиент ждёт 100 секунд и не повторяет действие автоматически. После второй ошибки возвращается только `error`, черновик не меняется.
- Регрессии: `scripts/tests/test_single_quiz_analysis.py` (mock providers, JSON, полнота, лимиты, оба API alias, compact `*B)` и многоабзацный вопрос), `scripts/tests/browser/card-editor.spec.cjs` (`single quiz`: успех/ошибка/loading, неизменность FRONT, положение кнопок, 320–1330px).

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

## Контекст оценки заданий с источником

`load_answer_context` сохраняет в task все авторские `::task` и `::source` (Python parser называет source полем context), затем очищенный `@free` prompt. В диалоге реальная реплика часто находится только в source; оценивать один общий prompt недостаточно. BACK/accepted_answers/policy и проверка permissions остаются серверными. Regression на настоящей карточке 349555: `tests/test_answer_evaluation.py`.

В task оценки также передаётся авторский card.context с критериями; это сохраняет смысл после перехода длинных ответов на @free. aiCardResult сохраняет существующий ручной перевод, заполняя только пустой. Assessment подавляет reveal и фиксирует первый объективный verdict; unavailable не считается попыткой.

## Промпты и разбор ответа оценщика

- Все промпты карточек собирает `_compose` в `api/services/prompt_builders.py`: данные пользователя в блоке `<input>` (данные, не инструкции), JSON-шаблон строится `json.dumps`; доп. указание добавляет `with_user_request` перед шаблоном. Пакетная генерация — `build_batch_cards_prompt`; системные пресеты определяет `is_system_preset_name`. Имена пресетов стабильны: по ним сопоставляются сохранённые промпты.
- `answer_ai._parse_evaluation` терпит ограждение `json, END_JSON, текст вокруг, лишние поля, длинные hint/explanation и confidence в процентах; согласованность verdict/accepted/severity и порог confidence 0.85 остаются строгими. Запрос идёт с `max_output_tokens=4096` для моделей с рассуждением. Тесты: `scripts/tests/test_prompt_builders.py`, `tests/test_answer_ai_parsing.py`.

