# Lerne Adaptive — архитектурная основа перед паузой диагностики

Дата фиксации: **01.11.2026**. Ветка: **`codex/adaptive-knowledge`**.
Состояние checkout при итоговой сверке: `df39e7482bbe9f3e7cfac4bfd12bda34eb0d445a`
**плюс существующие
незакоммиченные изменения Free Text/Trainer/supportEvidence**. Описанное состояние
не следует приписывать одному этому commit или работающему deployment.

## 1. Назначение, статус и границы

Это единая актуальная фиксация технической основы, условий интерпретации evidence
и требований к последующему расширению. Документ закрывает подготовительный этап;
он не является планом немедленного внедрения общей диагностики.

Используются три статуса:

- **Реализовано** — существует в текущем рабочем дереве; ключевые владельцы сверены
  с кодом. Это не утверждение о включении в production.
- **Проверенное ограничение** — установлено кодом, локальными снимками или
  указанным отчётом. Пределы выполненных ранее проверок перечислены в разделе 10.
- **Будущее требование / решение** — архитектурное условие следующей конкретной
  механики; сейчас не является полем API, runtime-классификатором или scoring.

В этом этапе добавлен только этот документ. Runtime, БД, схемы, KI/mappings,
Mastery, SRS и интерфейс не изменяются; миграции и deploy не выполняются.
Существующие изменения рабочего дерева сохранены.

### Основания и приоритет источников

Текущее поведение определяется кодом и последующими отчётами, а ранние отчёты
сохраняют исторический смысл. Этот baseline уточняет их статус, не переписывая их.

| Источник | Что закрепляет / как читать сейчас |
| --- | --- |
| [Карта архитектуры](../.agents/ARCHITECTURE.md), [Knowledge](../.agents/subsystems/knowledge.md) | Владельцы данных и действующий поток KI → Attempt → projection |
| [Foundation](LERNE_ADAPTIVE_FOUNDATION.md), [HTTP/PostgreSQL](LERNE_ADAPTIVE_HTTP_POSTGRES.md) | Card-bound capture, outbox, account isolation, серверное происхождение и идемпотентность |
| [Диагностический аудит](LERNE_ADAPTIVE_DIAGNOSTIC_AUDIT.md) | Разделение способности/механики, ограничения checker и состояние отдельного Game-прототипа; его единый логический контракт остаётся предложением |
| [D14 draft contract](LERNE_ADAPTIVE_D14_DIAGNOSTIC_CONTRACT.md) | Экспертная `d14-diagnostic-draft-1`, шесть карточек, тестовая reference-семантика; runtime admission/scoring по rubric отсутствует |
| [v2 relevance](LERNE_ADAPTIVE_FINAL_TARGET_RELEVANCE.md), [v3 relevance](LERNE_ADAPTIVE_ASSESSMENT_TARGET_RELEVANCE.md) | Предложенный в D14 leaf уже сохраняется в v2 и затем v3; прежнее утверждение «relevance теряется» историческое |
| [Free Text support](LERNE_ADAPTIVE_SUPPORT_EVIDENCE.md), [Trainer support](LERNE_ADAPTIVE_TRAINER_SUPPORT_EVIDENCE.md) | Частичное наблюдение помощи уже реализовано для Free Text и Trainer choice/input; прежнее «учёта помощи нет» уточнено, полнота всё ещё не достигнута |
| [KI-08.1](KI-08.1.md), [KI-08.2](KI-08.2.md), [KI-08.3](KI-08.3.md) | Общие feedback/lifecycle/counters, Trainer/WordBank, Match/Quiz, Puzzle; результаты тестов относятся к датам этапов |
| [Assessment](ASSESSMENT.md), [Free Text reliability](FREE_TEXT_RELIABILITY.md) | Первый результат экзамена, локальное сохранение, evaluator/unavailable и границы проверки диктовки |
| [Trainer endings / Design V2 audit](DESIGN_V2_ENDINGS_CONTRACT_AUDIT.md) | Последующее исправление устаревших browser fixtures; прежние failures в support-отчётах не объявляются текущими failures |

Внешние архитектурные документы и production-сведения, приведённые в этих
отчётах, здесь не проверялись заново. Новых чтений production, внешнего AI или
актуального deployment нет. Локальные D14-снимки не доказывают применённый контент.

## 2. Устойчивые границы: навык, упражнение и режим

**Архитектурный инвариант:** навык описывает измеряемое умение, независимо от типа
карточки и режима предъявления. Quiz, Trainer, Free Text, урок, Game Mode и диалог
не должны создавать разные сущности навыка только из-за смены поверхности.
Один навык может наблюдаться разными упражнениями; одна сложная задача может
содержать несколько умений, но не даёт автоматически evidence по каждому из них.

**Реализовано:** KI — отдельная сущность, карточка связана с ним через mapping.
Capture создаёт один Attempt для primary KI; secondary остаются контекстными
связями без автоматического contribution. Сервер не разрешает подставить secondary
или произвольный KI. Raw Attempts — источник evidence; `TMAUserKnowledgeState` —
единственная текущая пересчитываемая проекция на `(user, KI)`.

**Проверенное ограничение:** в модели нет отдельной оси ability/modality;
`rule_code` nullable и не unique, отдельного гарантированного `skill_key` нет.
Числовые PK нельзя переносить между окружениями как семантические ключи.
Primary mapping определяет адрес evidence, но не доказывает, что упражнение
реально проверило заявленную цель.

### Recognition и application

| Понятие для интерпретации | Условия и граница вывода |
| --- | --- |
| `recognition` | Распознать/выбрать предоставленную форму или соответствие. Выбор правильного варианта не подтверждает самостоятельное порождение |
| `guided_application` | Ввести/построить ответ с данным каркасом, лексикой, фиксированными слотами или существенной помощью. Это характеристика наблюдения, не обязательный третий KI |
| `independent_application` | Самостоятельно произвести целевую конструкцию в указанном канале при реальной возможности её проверки, применимой rubric, надёжном результате и полном наблюдении помощи без существенной опоры/раскрытия |
| `unknown` | Возможность или условия не установлены. Не заменяется recognition, guided или independent по одному `card_type`, `first_try_correct` либо authored `support=independent` |

Recognition и application должны различаться в будущих диагностических выводах.
**Способ их хранения как раздельных измерений пока не выбран:** reviewed каталог
отдельных измеряемых KI либо эволюция единственной projection требуют отдельного
решения. Сейчас нет раздельных процентов recognition/application, переноса
старой general mastery в independent или новых автоматически созданных KI.
Исходные смыслы KI и прежняя история сохраняются.

Письменная продукция не доказывает говорение, произношение или listening.
Диктовка с редактированием даёт итоговый текст; без ASR/modality evidence нельзя
делать из него вывод о самостоятельно произнесённой грамматике.

## 3. Реализованный контур Knowledge

```text
Обычный study:
prepareDeckKnowledge → account-scoped KI/mappings cache
exercise lifecycle → evidence → подтверждённый grade
  → captureStudyKnowledgeAttempt → v1 self_rating / v2 hybrid → Dexie outbox

Assessment:
тот же KI loader → первый classified result / explicit skip
  → recordAssessmentResult → saveAssessment: session + v3 outbox атомарно

Оба пути:
Knowledge Sync → /knowledge/attempts/sync → auth + card/primary validation
  → raw TMAKnowledgeAttempt + mastery-v1 update в одной транзакции
  → diagnostics / rebuild из raw history
```

Владельцы: [capture](../app/src/services/knowledgeCaptureService.js),
[content loader](../app/src/services/knowledgeContentService.js),
[study session](../app/src/hooks/useStudySession.js),
[Assessment conversion](../app/src/utils/assessment.js),
[Assessment save](../app/src/services/assessmentService.js),
[Knowledge Sync](../app/src/services/knowledgeSyncService.js),
[orchestrator](../app/src/services/knowledgeSyncOrchestrator.js),
[router](../api/routers/knowledge.py), [модели](../api/models.py),
[mastery/rebuild](../api/services/knowledge_mastery.py).

Реализованные гарантии и границы:

- Обычный capture требует включённого Knowledge, текущего аккаунта, карточки и
  кэшированного primary KI. Ошибка Knowledge не блокирует обучение. Успешный grade
  и enqueue Attempt **не атомарны**: SRS review может существовать без Attempt.
- Assessment сохраняет session/result и outbox одной Dexie-транзакцией; без
  primary mapping сохранение результата выдаёт ошибку. Его балл и authored
  review routes не являются долгосрочным mastery. SRS grade/review не создаётся.
- Knowledge outbox отделён от entity `/sync/v2/*`; операции закрепляют исходную
  account-scoped Dexie-базу, запрос — ожидаемого пользователя. Позднее подтверждение
  аккаунта A не должно изменять очередь B. Подтверждаются только IDs отправленного
  batch; transport failure/неполный ответ сохраняют возможность повтора.
- Новое событие требует активной доступной карточки и точного primary mapping;
  optional review должен принадлежать тому же пользователю и карточке.
  **Новые cardless события API отвергает**, хотя модель допускает null card_id.
- Идентичный `(user, client_event_id)` возвращает duplicate без второго вклада,
  изменённый payload — `event_conflict`. Duplicate принятой истории проверяется
  до новых guards и остаётся допустимым после revoke/unmapping. Raw не дополняется
  новыми полями при replay. Remapping не переназначает pending evidence другому KI.
- Insert и projection update атомарны; PostgreSQL lock сериализует user/KI.
  Rebuild использует ту же историю и scorer. Это гарантия сохранности и
  происхождения, **не серверная перепроверка истинности клиентского verdict**.

## 4. Действующий evidence: версии и сохранённые факты

`evaluation_data.schema_version` не означает Design V2, entity sync v2,
content revision или версию диагностических критериев.

| Формат | Что действительно хранится | Текущее значение для mastery-v1 |
| --- | --- | --- |
| v1 / `self_rating` | Rating и тип, `correct=null`; объективного результата нет | Rating со своей шкалой, weight=0.5; не objective ability |
| v2 / `hybrid` | Self rating + completed/first try/check/mistake counters, optional grading summary; support/task поля у подключённых механик | Только валидное completed auto-evaluated evidence: `0.8*objective(attempt_count)+0.2*self`, weight=1 |
| v3 / `assessment` | Первый result: status correct/incorrect/skipped, boolean correct, session/deck/ordinal/required_count/competency_ids, error aggregates; optional relevance/support/task | Correct=1, incorrect=0, weight=1; skipped не даёт contribution. Читать status до correct=false |

В v2 большинство детерминированных упражнений отдают evidence только после
успеха. Free Text отдаёт accepted либо exhausted; exhausted incorrect имеет
`completed=false` и **игнорируется текущим scorer**, даже если raw сохранён.
Unavailable не расходует classified attempt и не является ошибкой ученика;
в Assessment не фиксирует result. Отсутствие Attempt не объясняет причину:
возможны выход, отсутствие grade/KI, выключенный capture или сбой записи.

Полного ответа, вариантов предъявления и всей последовательности проверок в raw
нет. `mistake_count` — число неуспешных checks, не число грамматических ошибок.
Match считает attempts как неверные пары + финальный успех, а interaction_count
отдельно; один check Trainer может включать несколько неверных gaps. Такие
счётчики нельзя считать сопоставимыми между механиками без policy semantics.
Capture определяет `card_type` в classic-режиме; он не гарантирует фактическую
механику предъявления при переключении study mode.

В v3 не переносятся final evaluator/verdict, checker confidence и полный part
summary; в v2 evaluator/verdict опциональны в summary, но confidence не сохраняется.
Тип карточки не восстанавливает качество проверки.

### Target relevance

**Реализовано:** Free Text сохраняет literal `primary / secondary / none`:

- v2: последний classified result →
  `exercise_evidence.grading_summary.final_target_relevance`;
- v3: первый зафиксированный result → `evaluation_data.target_relevance`.

Missing/null/неизвестное значение на клиенте не создаёт поля. Старые события не
обогащаются. Поздний результат v3 не заменяет и не дополняет первый; skip и
unavailable не получают такую диагностику. Trainer без заявления checker поля
не получает. `none` может быть default checker: это не unknown и не доказательство
отсутствия целевой ошибки. История ранних relevance в v2 не восстанавливается
из финального correct/none.

Relevance — заявление о связи ошибки с целью, не quality receipt, не список
проверенных навыков и не автоматическое основание для положительного/отрицательного
вклада. Mastery v1 игнорирует relevance, support/task поля и rubric-метки;
они не меняют admission/scoring старых completed v2 или incorrect v3.
Mastery confidence зависит от массы evidence, а не точности checker;
retention/decay и подтверждение самостоятельности в нём не реализованы.

## 5. Помощь, статическая опора и неизвестные данные

**Реализовано:** общий [supportEvidence](../app/src/utils/supportEvidence.js),
один владелец в [Free Text session](../app/src/utils/freeTextEvaluationState.js)
либо opt-in [exercise session](../app/src/utils/exerciseEvaluation.js).
[Серверная validation](../api/services/knowledge_support.py) проверяет форму
optional полей, а не истинность наблюдения.

`support_evidence` хранит `tracking_complete`, `hint_count`,
`translation_view_count`, `answer_reveal_count`, `other_help_count`,
`capture_point`, `answer_attempt_count`. `task_support` отдельно хранит bool/null:
`answer_options_present`, `source_text_present`, `authored_example_present`,
`sentence_frame_present`, `source_vocabulary_present`.

| Механика | Подключённое наблюдение | Неизвестно / неполно |
| --- | --- | --- |
| Free Text | Показ содержательного hint/explanation после ошибочной classified проверки; открытие примера после exhausted; явные options/source/example blocks | Translation/other help=null; frame/vocabulary=null; back, notes, audio, AI question и произвольный Markdown не охвачены полностью |
| Trainer choice/input | Реальные открытия скрытого перевода; per-gap inline hints после check; варианты, фиксированные слоты, видимые фрагменты/source/example | Reveal/other help=null; внешний переворот/back/context/notes/audio/AI и поддержка закреплёнными correct parts не сведены в полный учёт |
| Остальные упражнения, включая editable_text | Новый support tracking не подключён | Не наследуют полноту лишь из-за общего компонента/hook; missing остаётся unknown |

У всех новых Free Text/Trainer snapshots **`tracking_complete=false`**. Счётчики
описывают показы подключённых источников, не чтение и не любую внешнюю помощь.
Наблюдаемый ноль конкретного источника при неполном общем покрытии допустим,
но не доказывает самостоятельность. Неизвестный префикс истории не исправляется
последующим кликом: его count остаётся null.

Граница результата общая: снять условия **при отправке ответа, до feedback
этой проверки**. v2 выбирает snapshot завершающей accepted/exhausted проверки
(`exercise_completion`); v3 — первой classified (`first_assessment_result`,
answer_attempt_count=1). В v2 поля внутри exercise_evidence, в v3 — прямо в
evaluation_data. Hint после первой ошибки относится к следующему ответу.
Поздний reveal/перевод меняет live history, но не frozen result.

SavedState сохраняет live историю и скопированный result snapshot в пределах
существующего lifecycle. Старый savedState без support даёт unknown. Полный
reload незавершённого Assessment не восстанавливает live draft; текущая карточка
помечается `supportHistoryUnknownCardId` для обоих типов, потерянные данные — null.
Следующая ещё не открытая карточка начинает новое наблюдение. Старые results и
outbox не дополняются; rerender/StrictMode/remount старого feedback не являются
новым показом помощи.

**Будущее условие independent:** применимая rubric и opportunity, надёжный
целевой результат, отсутствие готового решения/существенного каркаса, полностью
наблюдаемое окно всех существенных источников и известное отсутствие помощи.
Одного `tracking_complete=true` из клиентского JSON недостаточно: нужны проверка
реального покрытия и доверие к источнику. Текущие поля такой вывод не разрешают.

Даже полный внутренний учёт устанавливает лишь «без зарегистрированной помощи
в приложении» в объявленном окне: приложение не наблюдает всю внешнюю помощь.
Будущий вывод independent должен сохранять это ограничение.

## 6. Единый смысл будущего диагностического события

**Будущее требование, не действующий wire format:** любая новая механика должна
описывать наблюдение одинаково. Не вводится schema v4 или новая таблица этим
документом. JSON-вместимость не означает поддержку admission и scorer.

| Группа | Обязательный смысл для будущего контракта |
| --- | --- |
| Identity / origin | Стабильный event ID, authenticated subject, время; реальная card revision либо разрешённая server-owned activity/task/unit; источник и режим раздельно |
| Цель | Один проверяемый primary KI на diagnostic unit, разрешённый versioned mapping; secondary без автоматического вклада |
| Наблюдение | Recognition/application и modality; opportunity present/absent/unknown с причиной; task correctness отдельно от результата именно цели |
| Результат цели | correct / incorrect / not_observed / unverified, причина и completed отдельно; self-rating отдельно от objective |
| Условия | Статическая опора, действия помощи и полнота истории, граница snapshot до feedback; missing/null не превращаются в ноль |
| Checker | Метод rules/AI/human/self, версия evaluator/policy/rubric, качество verified/provisional/unavailable, uncertainty и target relevance; авторитетный result reference при заявлении доверенного результата |
| Сопоставимость | Content/task revision, семантика counters, variant/equivalence group, при повторной проверке — ссылка на новое независимое наблюдение |

Правила интерпретации будущего результата:

- `correct`: подтверждён успех именно целевого действия в применимой rubric,
  включая допустимые альтернативы. Task-correct не всегда target-observed.
- `incorrect`: была реальная target opportunity и надёжно установлена целевая
  ошибка. Generic mismatch, ошибка другого правила и низкая ASR quality этого
  не доказывают; отрицательные оценки не распространяются на secondary.
- `not_observed`: известный skip/abandonment, раскрытие до ответа, решение уже
  сделано каркасом или допустимый обход необязательной конструкции.
- `unverified`: неизвестная версия/возможность, unavailable, спорная альтернатива,
  AI provisional либо ASR doubt. Это не «не знает».

Если rubric явно требует Relativsatz, невыполнение обязательной инструкции
может быть неуспехом production-задачи. В свободном диалоге корректная фраза без
необязательного Relativsatz не даёт отрицательного evidence этого правила.
Ни один из этих исходов не является новым runtime-фильтром mastery-v1.
Неизвестный/неподдерживаемый новый тип должен быть явно неоцениваемым до отдельного
решения о scorer, а не маскироваться под completed hybrid или assessment.

## 7. Версии карточек и критериев: обязательное условие расширения

**Проверенное ограничение:** текущий Attempt не закрепляет content revision,
diagnostic rubric/mapping revision, версию checker/policy и точную механику
предъявления. `card_id`, updated_at, schema_version evidence и calculation_version
mastery не заменяют эти сведения. Локальные хеши D14 — идентификаторы эталонных
снимков, не реализованные поля Attempt. Сравнение карточек при resume Assessment
защищает возобновление сессии, но не версионирует историческое evidence на сервере.

**Требования к будущей реализации до интерпретации новых результатов:**

1. Разделять стабильную identity карточки/задания и неизменяемую revision
   предъявленного содержания. Revision должна охватывать диагностически значимые
   front/task/source/options/examples, gap structure, ответы/альтернативы, доступную
   опору и режим рендеринга. Точный способ хранения snapshot/hash/manifest ещё
   предстоит выбрать; одной ссылки на текущую редактируемую карточку недостаточно.
2. Отдельно версионировать rubric: цель, opportunity, ability/modality, допустимые
   альтернативы, критерии целевой ошибки, условия помощи и пороги доверия.
   Закреплять mapping revision и версию семантического каталога навыков; изменение
   значения KI не должно незаметно переопределять накопленную историю.
3. Закреплять применённые evaluator/grading policy и counter policy versions.
   Новая нормализация, принятие альтернативы или переработка Free Text checker
   могут менять verdict; новая модель/промпт сами по себе не делают серии сравнимыми.
4. Связывать событие с revision **на момент предъявления/ответа**, а не при sync
   по свежей карточке. UI state/savedState нельзя переносить между несовместимыми
   revisions как продолжение той же попытки. Для редактирования во время активной
   review, cached offline content и отзыва старой версии нужна явная policy.
5. Не менять frozen outbox, event ID и принятый raw ради новых полей/критериев.
   Старая запись остаётся в своей семантике; отсутствие revision/rubric означает
   unknown для нового анализа. Не вычислять её из сегодняшнего содержания.
6. При необходимости нового экспертного разбора хранить его как отдельную
   versioned annotation/reference к исходному событию с provenance. Это будущий
   механизм, не backfill correctness и не второй вклад за тот же ответ. Новая
   самостоятельная проверка ученика — новое наблюдение, связанное с исходным.
7. Сопоставимость версий объявлять только после review: тот же target, реальная
   opportunity, канал, difficulty и условия опоры. Новая карточка/новый ID не
   означает новый навык или равную трудность. Несопоставимые серии разделять в
   анализе; не выдавать смену механики/критериев за рост или потерю знания.
8. Admission старых cached revisions после remap/revoke определить отдельно.
   Сейчас сервер требует текущий primary для нового события; pending старой связи
   может быть rejected. Нельзя молча переназначить KI, обойти guard или подписать
   свежей rubric старый ответ. Принятый immutable duplicate сохраняет прежнее право
   на подтверждение.

При переработке Free Text сохраняются старые v1/v2/v3 payload и исходные результаты.
Изменения task/checker/rubric получают новые revisions и проверку совместимости.
Исторический rebuild остаётся воспроизведением старого scoring; переход к иной
интерпретации/projection требует отдельного versioned решения и regression gates.
Это требования к следующей механике, **не выполненная защита версий сегодня**.

### Контрольные примеры D14

| Карточка из исправленного локального снимка | Допустимый вывод / версия |
| --- | --- |
| 358363, 358365 | Choice Nominativ/Dativ: recognition с вариантами и заданной конструкцией |
| 358375 | Input предлога/местоимения в каркасе: guided; допустимая экспертная альтернатива может не совпасть с exact checker |
| 358385 | Ввод `spricht` в уже конечный слот: совпадение формы наблюдаемо, самостоятельное размещение глагола для word_order — not_observed в draft rubric |
| 358397 | Построение придаточного при двух немецких source и готовой matrix clause: guided production, без автоматических дополнительных KI |
| 358407 | В исправленном снимке Free Text; в исходном — Trainer. Free Text rubric не применяется к прежнему событию только по ID; самостоятельность текущего ответа unknown при неполной истории помощи |

Эти ограничения не меняют mapping или нынешний scoring 358385/358407.
D14 draft tests исполняют reference-семантику, а локальный Trainer-пилот проверил
транспорт/структурную опору трёх карточек. Ни то ни другое не является калибровкой
языкового grader, педагогической валидацией всего курса или runtime rubric engine.

## 8. Одна архитектура для уроков, Game Mode и диалогов

**Единое архитектурное решение:** все режимы используют один каталог смыслов
навыков, один контракт наблюдения и общую границу raw evidence → единственная
языковая projection. Режим не создаёт вторую mastery. SRS отвечает за повторение
карточек; игровые state/history/task outcomes/NPC memory остаются данными сценария.
Успех «получена книга» не является грамматическим успехом.

| Контекст | Фактический статус | Условие будущего подключения |
| --- | --- | --- |
| Classic / Assessment | Работают через описанные card-bound v1/v2/v3 | Сохранять контракты; новые диагностические смыслы вводить отдельно |
| Game Mode в текущем checkout | Есть кнопка/SSO identity perimeter; нет GameView case и игрового router/Knowledge bridge | Нельзя считать доступность кнопки готовым учебным flow |
| Отдельный `game-mode` прототип | По аудиту commit `15f91227de0c5586b3badfdd370c6cb2dec92035`: engine, attempts, shadow capture, provisional analysis, экспериментальный LanguageProgressService | Это другая ветка, не текущая интеграция и не проверенный deployment; experimental skills не подключать как параллельную языковую шкалу |
| Будущие учебные диалоги | Отдельного реализованного диагностического card type/adapter здесь нет | Реальные versioned tasks/units, opportunity, поддержка и quality результата; свободная реплика не получает произвольный KI |

Будущая интеграция карточного задания в Game использует реальную доступную
карточку. Нельзя фабриковать card_id, SRS grade/review или выдавать Game за v3
Assessment. Отдельный тип/валидатор источника необходимо согласовать до capture.

Для бескарточной реплики нужен альтернативный **серверный** admission: разрешённый
account-owned activity instance, versioned task/rubric, diagnostic unit → primary
KI, committed turn/result и authoritative verification/reference. Клиент не
назначает себе trusted/verified. Общие raw persistence, transaction/lock,
duplicate/conflict и единственный scorer переиспользуются после admission;
текущие card-bound guards не ослабляются. Много навыков в диалоге требуют отдельных
проверяемых units и устойчивых identities без повторного вклада за одно наблюдение.

Visitor ID/X-User-ID другой среды нельзя считать authenticated learner identity;
SSO подтверждает личность, не истинность результата. Межсервисный bridge должен
проверять issuer/audience/namespace, owner и доверенный result. Судьба experimental
skill history — отдельное решение без автоматического импорта в KI.
Первый пилот может быть online с authoritative commit. Offline scenarios потребуют
отдельного versioned admission/replay протокола; текущий outbox сам этого не даёт.
Полные тексты/голосовые записи не добавляются в него без решения о privacy,
retention, объёме и минимально достаточном evidence.

## 9. Точки расширения и gate нового типа карточки

| Ответственность | Существующая точка подключения | Что требуется новому типу |
| --- | --- | --- |
| Формат/разбор | [card-core](../api/card_core/lerne_card_core), [cards subsystem](../.agents/subsystems/cards.md), [detector](../app/src/utils/exerciseDetector.js) | Явный формат и parser/validator; согласованная совместимость с Admin, без скрытого угадывания diagnostic rubric |
| Предъявление | [ExerciseRenderer](../app/src/components/study/ExerciseRenderer.jsx), reviewKey/savedState в StudyCard | Реальная механика, чистый новый review, восстановление того же review, revision-aware lifecycle в будущем |
| Checker/feedback | exerciseEvaluation/useExerciseEvaluation либо Free Text session/useFreeTextEvaluation; узкие stateless adapters | Safe parts/error metadata без утечки expected/submitted answer в публичный feedback; явные completion, counters и допустимые альтернативы |
| Помощь | supportEvidence у существующего владельца lifecycle | Инвентаризация поверхностей, реальные callbacks, snapshot до feedback, статическая опора отдельно, unknown prefix и frozen result |
| Study evidence | onTrainerAnswer → StudyView → useStudySession → knowledgeCaptureService | Один completion callback по текущей study policy, capture после grade, primary mapping; не писать Attempt прямо из renderer |
| Assessment | AssessmentView + assessment converters/service | Подключение отдельное, не автоматическое; первый classified result/skip, unavailable без ошибки, атомарный session/outbox и стабильный ID |
| Сервер / projection | knowledge router, optional validators, knowledge_mastery | Проверяемый origin/primary/account, mixed-version validation, immutable replay, explicit scoring support; новый JSON leaf не создаёт семантику scorer |

До признания типа диагностически готовым нужен небольшой проверяемый контракт:

1. Назвать измеряемый target и фактическое действие ученика, различить recognition,
   guided/independent и unknown; показать, что цель не решена самим каркасом.
2. Зафиксировать revision/rubric/checker policy и реальные альтернативы; описать
   целевую ошибку, skip, unavailable, спорный verdict и отсутствие opportunity.
3. Определить единицу check/interaction/completion, границу результата и помощи.
   Для существующего v2 сохранить success-only policy; полный поток каждой
   диагностической проверки — отдельное будущее расширение, его нельзя выдумать
   из финального агрегата.
4. Пройти путь result → snapshot → capture/conversion → Dexie → sync → raw →
   projection с retries, потерей истории, offline/reopen, сменой аккаунта,
   duplicate/conflict, remap/revoke и rollback; проверить legacy golden scoring.
5. Разделить доказательство сохранности и педагогическую проверку checker.
   На эталонах разобрать целевые ошибки, корректные альтернативы, ошибки другого
   правила и недостаточные данные; для AI не принимать confidence за измеренную
   точность. До этого допустимы raw facts с честным unknown, не автоматический
   вывод об independent или маршрутизация ученика.

Это gate следующей **готовой учебной механики**, а не требование сейчас построить
универсальный framework, охватить все карточки или внедрить новые поля.

## 10. Оставшиеся технические ограничения и пределы проверки

| Ограничение на момент baseline | Практическое следствие |
| --- | --- |
| Нет закреплённых content/rubric/mapping/checker revisions в Attempt | Старое событие нельзя надёжно интерпретировать по новой карточке; требования раздела 7 ещё предстоит реализовать |
| Неполная помощь Free Text/Trainer; другие типы не подключены | Нули/first try не подтверждают самостоятельность; часть истории после reload unknown |
| Lossy evidence и bias к завершённым study | Нет полной истории checks/ответов; ранние ошибки и abandonments часто не видны; exhausted v2 ignored |
| Одна general projection без ability/modality | Нет отдельных mastery recognition/application; текущие баллы не доказывают перенос |
| Нет authoritative result receipt; AI/ASR не калиброваны | Auth/primary guards не подтверждают языковую правильность, hint reading или устную продукцию |
| Новые cardless origins не поддержаны; Game в другой ветке | Для Game/диалога нужны admission, identity и versioning, а не обход карточного guard |
| Grade и ordinary capture не атомарны; новый event UUID не равен replay | Возможен SRS без Attempt; повторная grade с новым ID не защищена сетевой идемпотентностью как то же учебное наблюдение |
| Локальный enqueue сравнивает лишь часть полей при совпавшем ID | Отличающийся evaluation_data может локально остаться без обнаруженного конфликта; серверное полное duplicate/conflict сравнение обязательно, локальная проверка слабее |
| Admission pending после remap зависит от текущего mapping | Новый старый payload может быть rejected; нельзя автоматически переназначать KI |
| Нет retention/decay/адаптивного scheduler и validated general diagnostic engine | Timestamp/evidence mass не доказывают сохранение знания; автоматический пропуск тем не обоснован |
| Полные Assessment reports локальны; часть тестов требует ignored snapshots | Нет server archive полного отчёта; не все локальные D14 checks воспроизводятся на чистом clone без подготовки |

Ранее выполненные проверки, на которые опирается baseline:

- Foundation/HTTP-PG: реальные hooks, Dexie, TCP HTTP/auth, raw PostgreSQL 17.11,
  origin guards, remap/unmap, account switch и конкурентный replay (1 created /
  7 duplicate). Это не нагрузочный или multi-instance тест.
- Relevance/support этапы: сохранение v2/v3 JSON offline/reopen → HTTP → SQL,
  frozen first result, duplicate/conflict, account isolation, неизменность scoring.
  Trainer-пилот использовал deterministic checker и три локальных D14 карточки
  в disposable PG; Free Text AI verdicts были синтетическими.
- UI/Node/backend suites и просмотр снимков описаны в соответствующих отчётах.
  Ранние support-отчёты фиксируют baseline failures Legacy/V2 fixtures;
  последующий Design V2 audit сообщает об их исправлении и прошедших целевых
  suites. Это не новый запуск здесь и не доказательство всех свойств приложения.

Эти результаты **не являются новым запуском тестов этого документа**. Здесь
выполнены статическая сверка ключевых владельцев и статусов, проверка локальных
ссылок/путей и diff. Не заявляются production startup/lifespan/migration chain,
актуальное покрытие KI, deployed Game, живой AI/ASR, физический микрофон,
Android/Telegram WebView, несколько вкладок или длительное закрытие приложения.
Педагогическая FP/FN-калибровка D14 и retention-эксперимент не выполнены.

## 11. Заключение и закрытие подготовки

**Техническая основа готова к последующему ограниченному расширению:** есть
единые KI, raw Attempts, account-scoped outbox, проверяемое карточное происхождение,
идемпотентная транзакционная запись и пересчитываемая Mastery. Частичные факты
relevance/помощи уже проходят этот контур. Известные пробелы имеют явные границы.

**Основа пока не готова к достоверной автоматической диагностике самостоятельного
применения и управлению адаптивным маршрутом.** Версии содержания/критериев,
полнота помощи, quality/provenance результата и новые origins остаются условиями
будущих конкретных механик, а не реализованными возможностями.

Подготовительный этап **закрыт этой фиксацией**. Дальнейшая диагностика развивается
только под конкретные готовые учебные механики с собственным проверяемым target,
условиями помощи, rubric/versioning и сквозным evidence gate. Самостоятельные
работы над универсальной диагностикой, новой шкалой Mastery, SRS, новыми KI,
картой/маршрутом или расширением UI из этого baseline не следуют.
