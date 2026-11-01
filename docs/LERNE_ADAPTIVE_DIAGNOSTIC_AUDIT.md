# Lerne Adaptive: аудит диагностических сигналов и Game Mode

Дата: 1 ноября 2026. Статус: результаты анализа для обсуждения; предложенные изменения не реализованы.

## 0. Границы и основания

**Проверенная рабочая ветка TMA:** `codex/adaptive-knowledge`, commit `3498302b9d5e665e75bb82fe92fb7c8e2d5604b6`. Первоначально указанная `codex/design-v2-personal-migration` заменена пользователем на эту ветку. Рабочее дерево до аудита было чистым.

**Дополнительный источник Game Mode:** локальный Git ref `game-mode`, commit `15f91227de0c5586b3badfdd370c6cb2dec92035`. Файлы прочитаны через `git show`, без переключения на эту ветку, merge, запуска или миграций. Это отдельная реализация, отсутствующая в текущем checkout. Удалённое состояние после последнего fetch и работающий deployment не проверялись.

**Admin:** соседний checkout `LanguageSage/lerne-admin`, ветка `codex/standalone-admin`, HEAD `c6333ccc8d51045e64d2805a1306161496d6dda2`. В нём уже были пользовательские изменения в `.gitignore`, `README.md`, `docs/COMPATIBILITY.md`, `src/lerne_admin/static/js/api.js`, `tests/browser/admin-folder-import.desktop.cjs`; они не изменялись. Выводы относятся к прочитанному checkout, а не к состоянию всего удалённого репозитория.

Прочитан [архитектурный документ Lerne Adaptive](https://docs.google.com/document/d/1SWfQEfMFSwy8AOCI3itOi-Kyge3EdoSDRBasmsHrgB4/edit), редакция 31.10.2026, включая решения 13–16: отдельно оценивать recognition/application, сохранять единый Knowledge Layer, сначала диагностический контракт и Game Mode, затем новые учебные диалоги. Его сведения о production KI 9–16 и D14 — **сведения документа**, а не новый запрос к production в этом аудите.

Обозначения в отчёте:

- **Факт** — подтверждён прочитанной реализацией, локальными данными или выполненной изолированной проверкой; источник указан рядом.
- **Вывод** — диагностическая интерпретация механики, требующая педагогического согласования, а не гарантия измерения навыка.
- **Предложение** — будущий контракт или этап; сейчас не существует как реализованная функция.
- **Не установлено** — данных недостаточно. Это не отрицательный результат ученика.

Изменён только этот отчёт. БД, миграции, KI/mappings, SRS, Mastery v1, оформление Design V2 и учебные механики не менялись. Production, внешние AI и игровой сервер не запускались; deploy и запись учебных данных не выполнялись.

**Основной вывод:** существующие raw Attempts, outbox, sync и пересчитываемая Mastery подходят как единый контур хранения. Сейчас evidence не позволяет надёжно выделить три способности: не хватает полного учёта помощи, версии задания, диагностической возможности и качества проверки. Game Mode существует в другой ветке, но ещё не подключён к этому контуру.

## 1. Диагностическая матрица упражнений

### 1.1. Что означает «достоверность»

Различаются две вещи: корректность проверки конкретного ответа и сила вывода о навыке. Совпадение с authored ответом можно проверить точно, но оно не доказывает перенос в самостоятельную речь. `first_try_correct` означает первую учитываемую проверку, а не отсутствие подсказок, знакомства с ответом или помощи извне.

**Предлагаемые определения:**

- **Recognition:** распознать/выбрать форму или соответствие при наличии вариантов.
- **Guided application:** произвести часть ответа или собрать конструкцию при заданном каркасе, словах, локализации ошибки либо существенной помощи.
- **Independent application:** самостоятельно произвести требуемую конструкцию без предложенной формы/готового ответа и существенной помощи в наблюдаемом задании. Это утверждение ограничено конкретным заданием и каналом; письменный ответ не доказывает говорение.
- **Unknown:** способность или условия наблюдения не установлены. Нельзя автоматически назначать independent по типу `free_text` или authored метке `support: independent`.

### 1.2. Реальные механики и сохранность сигналов

В колонке «Attempts» ниже описан обычный study после **подтверждённой grade**, при включённом Knowledge и доступном primary KI. Исключения assessment, Speech и LiD указаны отдельно. Обозначение v2 — `evaluation_data.schema_version=2`, не Design V2 и не `/sync/v2`.

| Тип и реальная механика | Доступные сигналы → что достигает Attempts | Проверяемая способность — вывод | Достоверность | Пробелы и ограничения |
| --- | --- | --- | --- | --- |
| **Quiz**, один вариант, кнопка Check; любой starred вариант принимается. Ошибочный вариант исключается из следующих выборов | В UI: выбранный ID, итог, ошибочные option IDs, проверки и ошибки. После успеха: v2, `correct=true`, attempts/mistakes/first try, summary с кодом `exercise.wrong_choice` и incorrect parts | Recognition; повтор после исключения вариантов — распознавание с дополнительной опорой | Высокая для authored выбора; ограниченная для знания правила | До успеха evidence не отдаётся. Угадывание и исключение вариантов не различаются; нет числа исходных альтернатив в Attempt, времени, просмотра объяснения, полного порядка ответов. Не multi-select и не свободная продукция. [Q], [E] |
| **Match**, последовательное сопоставление пар; верные пары закрепляются, одинаковые нормализованные правые значения взаимозаменяемы | В UI: обе стороны, принятые пары, feedback. В v2: ошибки + финальное завершение; `interaction_count` сохраняется в summary, если отличается от attempts. Каждая верная промежуточная пара не увеличивает attempts; неверная пара увеличивает, финальный успех добавляет одну попытку | Recognition связей; сужение набора даёт опору | Высокая для заданных пар; ограниченная для самостоятельного использования | `attempt_count=1` возможен после многих правильных действий. Нельзя сравнивать его напрямую с числом проверок Trainer. Полная последовательность/пара ошибочного выбора не сохраняется. Сопоставление не проверяет построение фразы. [M], [E] |
| **Trainer choice**, `{...}`; выбор формы в готовой фразе, в том числе окончания | Проверка всех заполненных gaps; верные gaps закрепляются, неверные доступны для исправления. v2 сохраняет общий счёт проверок, ошибочных проверок, наборы gap IDs/ошибок, `exercise.wrong_choice` либо `exercise.affix_mismatch` | Обычно recognition формы в контексте, даже если карточка названа «применение» | Высокая для выбора authored формы; средняя/низкая для вывода о правиле | Нет способности на уровне gap, число ошибок — число неуспешных проверок, а не неверных gaps. Видимые варианты, перевод и feedback не отражены как помощь. Автогенерация distractors не является проверенной педагогической шкалой. [T], [C], [E] |
| **Trainer input**, `[[...]]`; ввод формы, словосочетания или придаточного | Те же counters/summary; сравнение нормализованного ввода с authored вариантами через `|`. `exercise.input_mismatch`, без языкового inference | Guided application для формы в каркасе; возможна ограниченная самостоятельная продукция целого придаточного, если это действительно требует задание | Высокая для совпадения с перечисленными вариантами; ограниченная для допустимых перефразировок | Нормализация игнорирует регистр, лишние пробелы, конечные `. ! ?`. Неизвестная грамматически верная альтернатива отвергается. Готовое положение gap уже подсказывает место глагола. Choice/input внутри одной карточки сворачиваются в один `card_type=trainer` и один primary Attempt. [T], [C], [E] |
| **WordBank**, общие варианты распределяются по numbered gaps; каждый option ID используется один раз | В UI: assignments и active gap. Check проверяет все gaps, фиксирует верные. v2: checks/mistakes/first try, incorrect gap IDs, `exercise.wrong_choice` | Recognition выбора; guided application при заполнении фразы готовыми словами | Высокая для authored gap/значения; ограниченная для свободной продукции | Отсутствует самостоятельное порождение формы. Оставшиеся слова и закреплённые gaps помогают следующему ответу. Нормализованное равенство не объясняет грамматическую причину. Распределение и число просмотров помощи не входят в Attempt. [W], [E] |
| **Puzzle**, сборка предложения из всех заданных токенов | UI сохраняет answer/pool order, перевод, evaluation state. Check сравнивает полный порядок authored token IDs; feedback по направленным соседствам. В v2: checks/mistakes и история boundary IDs/`exercise.word_order` | Guided application порядка слов при готовой лексике; не независимое построение | Высокая для одного authored порядка, ограниченная для естественного языка | Принимается только исходная последовательность; одинаковые слова различаются occurrence IDs. Другой допустимый порядок может быть отклонён. Одно неверное Check = одна ошибка независимо от числа границ. Просмотр перевода/ответа и количество перемещений не входят в Knowledge. [P], [E] |
| **Edit / editable_text**, `@edit`; исходный текст уже находится в поле, ученик его исправляет; reset возвращает source | Использует тот же Free Text component и evaluator. Успех/исчерпание retries → v2; сохраняются финальный verdict/evaluator, типы и коды ошибок, minor errors, counters | Guided application исправления текста; не доказательство самостоятельного построения целой фразы | Зависит от policy и набора альтернатив; AI требует отдельной калибровки | Сам факт ошибки и исходный каркас даны заранее. Reset, размер/состав правок, hints и confidence не сохраняются в Attempt. Сервер запрещает `open_text` для Edit, по умолчанию controlled + без typo tolerance. [F], [A] |
| **Free Text**, `@free`; написание ответа, возможна диктовка с последующим редактированием | UI хранит текст, lastAnswer, result, policy, retries/errors. Успех (`correct`/`accepted_minor`) или исчерпание лимита отдаёт evidence; в v2 — counters, completed, итог/evaluator и агрегаты ошибок. Transport/unavailable не увеличивают attempts | Кандидат на independent written application, если задание требует целевую конструкцию и помощь исключена; после hints — guided | Exact/rules подтверждают соответствие образцу; AI ≥0.85 — фильтр, не доказанная точность; независимость сейчас не установлена | Нет confidence/severity/target relevance/policy version в Attempt. Нет учёта диктовки/редактирования/подсказок. AI может пропустить ошибку или принять обход конструкции. До исчерпания retries незавершённые неудачи не доходят до Knowledge. Исчерпанный неверный v2 хранится raw, но **Mastery v1 его игнорирует** из-за `completed=false`. [F], [A], [K] |
| **Assessment**, оболочка Trainer / Free Text / Edit | Первый проверенный результат фиксируется, есть skip. Атомарно session + outbox; v3 хранит correct/incorrect/skipped, session/deck/ordinal/required/competency IDs, error types/codes | Способность определяется внутренним заданием, а не словом «экзамен» | Сильнее обычного retry по контролю первой попытки; checker остаётся тем же | Не поддерживает Quiz/Match/Puzzle/WordBank в AssessmentView. v3 теряет final evaluator/verdict, confidence, помощь, part details и исходные counters. `skipped`: 0 в балле экзамена/рекомендациях, но **нет отрицательного mastery evidence**. [AS], [K] |
| **Standard / Theory**, front/back, ручная grade | В Knowledge — v1 `self_rating`, rating, тип; `correct=null`. Theory приводится capture к `card_type=standard` | Субъективная оценка; объективная способность не наблюдалась | Низкая для диагностики; полезна как отдельная самооценка | Просмотр, чтение и понимание не различаются; факт раскрытия ответа не сохранён в Attempt. Нельзя получить objective recognition/application из grade. [D], [CAP] |
| **Speech / speak step / speech follow-up** | UI: transcript, targetText, matchRatio/success, настраиваемый порог; success завершает step. Не передаёт эти поля в `setExerciseEvidence`/Knowledge capture. Итоговая grade даёт v1 либо v2 от предшествующего письменного упражнения | Повторение заданной фразы, не самостоятельное говорение и не listening | Низкая как грамматическая диагностика: overlap слов не проверяет их порядок/роль | Порог по умолчанию 75; совпадение набора слов может принять иной порядок и пропуски. Нет error/retry/hint/ASR quality в Attempts. Успех устного шага не превращает предыдущий письменный результат в устное evidence. [S], [SV] |
| **LiD exam/practice**, отдельный quiz flow | Store хранит answers, correct/mistakes, время, результат билета; practice показывает feedback, доступен разбор. В проверенном LiD flow нет вызова Knowledge capture | Recognition ответа на конкретный LiD вопрос | Высокая для authored ключа; не диагностика грамматической продукции | Это отдельный existing exam result, не KI Attempt. Нельзя утверждать, что LiD уже покрыт Knowledge; потребуется отдельное решение о содержательном mapping. Пропуск считается неверным в локальном результате LiD, что нельзя переносить на диагностику KI. [L] |

Источники механик: [ExerciseRenderer](../app/src/components/study/ExerciseRenderer.jsx) выбирает перечисленные интерактивные renderer; [detectCardType / detectExerciseType][D] определяет тип по содержимому, с приоритетом директив и Trainer над Quiz, а не просто по `card.card_type`. `studyMode=puzzle` может дополнительно менять фактическую механику обычной карточки. Capture вызывает detector с `'classic'`, поэтому `card_type` в Attempt не гарантирует фактический способ предъявления. Не обнаружен отдельный реализованный card type «Диалог» в этой ветке.

Точные точки проверки и выдачи результата:

| Механика | Проверяющая функция | Откуда результат уходит в study |
| --- | --- | --- |
| Quiz | [evaluateQuizOption](../app/src/utils/quizEvaluation.js) | `StudyCardQuiz.handleVerifyAnswer` → `onTrainerAnswer` после `submission.evidence` |
| Match | [evaluateMatchPair][M] | [StudyCardMatch.handlePair](../app/src/components/study/StudyCardMatch.jsx) → completion evidence |
| Trainer | [evaluateTrainerGaps](../app/src/utils/trainerEvaluation.js) | `StudyCardTrainer.handleCheck`; в assessment — первый Check, в Classic — completion |
| WordBank | [checkWordBankAssignments][W] | [StudyCardWordBank](../app/src/components/study/StudyCardWordBank.jsx) → completion evidence |
| Puzzle | [evaluatePuzzleOrder][P] | [StudyCardPuzzle.handleCheck](../app/src/components/study/StudyCardPuzzle.jsx) → completion evidence |
| Free Text / Edit | [createFreeTextEvaluationSession.submit / evidence][F], [evaluateFreeTextAnswer](../app/src/services/answerEvaluationService.js) | [StudyCardFreeText.handleSubmit](../app/src/components/study/StudyCardFreeText.jsx) и восстановление сохранённого evidence через effect |
| Speech | [evaluateStudySpeech][S] | [StudyCardSpeech.evaluateSpeech](../app/src/components/study/StudyCardSpeech.jsx) → `onSuccess`, затем step completion; отдельного Knowledge evidence нет |

### 1.3. Что сохраняется, что теряется

**Факт:** [createExerciseEvaluationSession][E] хранит текущий feedback, `attemptCount`, `mistakeCount`, `interactionCount`, completed, объединённые `incorrectParts`, error types/codes. `evidence()` возвращает результат только после полного успешного completion. Верные части Trainer/WordBank/Match закрепляются; Puzzle сохраняет feedback по соседствам, не блокируя отдельные слова из-за правильной границы.

`mistake_count` не является количеством грамматических ошибок: пять неверных gaps за одно Check дадут одну ошибочную проверку. Наборы ошибок теряют частоту, порядок и связь конкретного ответа с конкретной подсказкой. Generic `exercise.input_mismatch` не означает установленную ошибку Dativ; `word_choice` не доказывает, что причиной было незнание падежа.

**Факт:** [captureStudyKnowledgeAttempt][CAP] переносит `isCorrect`, completed, first try, attempts/mistakes и опциональный `gradingSummary`; выставляет `auto_evaluated=true`, `score=null`, `partial_score=null`, `knowledge_difficulty=null`, `review_id=null`. Mapping complexity/weight при этом не становятся difficulty/весом evidence. Полный текст ответа, корректирующий ответ, вся серия verdicts и сама policy в raw Attempt не копируются. Это ограничивает диагностику, но также сокращает хранение личных текстов.

**Вывод:** перед будущим independent evidence нужен учёт хотя бы видимой опоры, языковых hints после проверки, перевода, раскрытия примера/решения, редактируемой диктовки и полноты наблюдения. `hint_count=0` допустим только при полном учёте; неизвестное число — `null`, а не ноль. Отсутствие hint в сохранённом summary сейчас не означает отсутствие помощи.

### 1.4. Ограничения автоматической проверки

**Факты об Answer Evaluation:** [load_answer_context / evaluate_answer][A] загружает доступную активную карточку, её primary KI, target language, task/source/context, accepted answers и grading policy. [evaluate_deterministic][AR] сначала проверяет нормализованное равенство, затем узкий безопасный typo path; `exact` отвергает несовпадение. Для controlled/open text при неоднозначности вызывается AI. Даже open text сначала может совпасть с эталонным ответом; название режима не гарантирует вызов AI.

[AnswerEvaluation / GradingPolicy][AC] содержит `confidence`, evaluator, severity, target relevance, corrected answer, hint/explanation. [evaluate_with_ai][AI] требует структурированный результат и evaluator=ai, отсекает confidence <0.85, проверяет часть policy, скрывает полный ответ на retry, ограничивает retries/время. Это защита формата и часть семантических ограничений; фактическую чувствительность/специфичность языковой проверки она не измеряет. Confidence модели не является калиброванной вероятностью правильной оценки.

**Риски диагностики:**

- Exact mismatch может означать допустимую альтернативу. При `semantic_equivalence` корректное перефразирование может, наоборот, обойти целевой навык: «die sehr hell ist» не проверяет предложный Dativ, хотя решает коммуникативную задачу.
- Неверный ответ может ошибаться в другом правиле; `target_relevance` важен для того, какой KI допустимо считать проверенным. Сейчас он теряется перед Attempts.
- Переданный в evaluator `card.context` может содержать объяснение/ответ. Он помогает проверяющему понять задачу, но не является независимым эталоном эксперта и не показывает, что видел ученик.
- При dictation проверяется итоговый редактируемый текст. Без сведений об ASR и правках нельзя приписывать ошибку грамматики произнесённой речи или подтверждать произношение.
- `/ai/evaluate-answer` возвращает результат, но не создаёт подписанный receipt, который текущий Knowledge Sync сверяет с Attempt. Проверка доступа к карточке не удостоверяет неподдельность присланного клиентом verdict.

## 2. Карта существующего потока данных

### 2.1. Обычное обучение

```text
useStudyNavigation.startStudy / startStudyCard
  → prepareDeckKnowledge → GET /api/knowledge/decks/{deck_id}
  → account-scoped Dexie: knowledge_items + card_knowledge_items

StudyCard → ExerciseRenderer → evaluator + reviewKey-owned state
  → onTrainerAnswer(cardId, evidence)
  → StudyView.handleExerciseAnswer → exerciseEvidence в памяти
  → grade → useStudySession.submitGrade
       → POST /study/grade либо /study/duplicates/grade
           online: SRS + review history
           offline adapter: локальные progress + review event
       → только после подтверждения grade: captureStudyKnowledgeAttempt
           → cached primary KI → v1 self_rating / v2 hybrid
           → knowledge_attempt_outbox

App.useKnowledgeSync(user) → orchestrator → knowledgeSyncService
  → POST /api/knowledge/attempts/sync
  → серверная проверка происхождения/доступа/idempotency
  → TMAKnowledgeAttempt + apply_created_attempt в одной транзакции
  → TMAUserKnowledgeState (mastery-v1)
  → diagnostics читает raw + stored/recomputed projections
```

Владельцы: [useStudyNavigation](../app/src/hooks/useStudyNavigation.js), [prepareDeckKnowledge](../app/src/services/knowledgeContentService.js), [StudyView][SV], [useStudySession.submitGrade](../app/src/hooks/useStudySession.js), [offlineApi](../app/src/services/offlineApi.js), [capture][CAP], [sync][KS], [router][KR], [mastery][K], [diagnostics](../api/services/knowledge_diagnostics.py).

**Сохранность:** упражнение само не создаёт Attempt. Если пользователь прервал его до completion, ушёл без grade, Knowledge отключён, нет primary KI/его кэша или enqueue завершился ошибкой, объективная информация может не сохраниться. Grade и Knowledge capture не одна атомарная транзакция: успешный SRS grade возможен без Attempt. Capture выполняется без ожидания со стороны grade flow и не должен блокировать обучение. Повтор уже сохранённого outbox события идемпотентен; повторное создание нового UUID после повторной grade не тождественно сетевому replay.

### 2.2. Assessment

```text
createAssessment → AssessmentView → Trainer / Free Text / Edit
  → первый classified ответ или explicit skip
  → recordAssessmentResult
  → saveAssessment: session + v3 Attempt в одной Dexie transaction
  → тот же knowledge_attempt_outbox → тот же Knowledge Sync
  → raw Attempt → mastery-v1: correct=1 / incorrect=0 / skipped=ignored
```

Источники: [AssessmentView][ASV], [assessment.js][AS], [saveAssessment](../app/src/services/assessmentService.js). Здесь нет выдуманной ручной grade, записи SRS progress или review history. Балл экзамена и `review_routes` относятся к результату попытки; это не новый алгоритм mastery и не карта навыков.

### 2.3. Что фактически означают v1/v2/v3 для Mastery

**Факт:** [explain_knowledge_attempt][K] принимает только конкретные пары version/type:

| Evidence | Текущее поведение mastery-v1 | Диагностический предел |
| --- | --- | --- |
| v1 / `self_rating` | Rating scores: again 0.10, hard 0.40, good 0.75, easy 0.95; `ext_0…ext_7` имеют собственную шкалу; weight=0.5 | Объективных данных нет; сохранение rating не означает проверенную способность |
| v2 / `hybrid` | Требует auto_evaluated=true, completed=true, целочисленный attempt_count≥1, `first_try_correct == (count == 1)` и известный rating. Objective: 1→1.00, 2→0.80, 3→0.65, 4→0.55, 5+→0.45; итог `0.8*objective + 0.2*self`, weight=1 | Не использует top-level correct, mistake_count, hints, evaluator/confidence, skill ability или grading summary для scoring. Незавершённый неверный Free Text игнорируется; accepted AI при completed=true считается objective наравне с rules |
| v3 / `assessment` | Валидный correct/incorrect даёт 1/0, weight=1, без self; skipped игнорируется до scoring correct | v3 не означает independent application или независимую серверную перепроверку ответа |
| Иные/некорректные пары | Contribution отсутствует; raw может существовать | Raw count не равен числу оценённых evidence событий |

`confidence = 1 - exp(-evidence_mass/5)` в mastery-v1 зависит от массы evidence; это **не confidence проверяющего** и не полнота контроля помощи. `proficiency = (1 + positive_evidence)/(2 + evidence_mass)`. Нет измерения retention или decay по прошедшему времени; `last_evidence_at` — дата последнего учитываемого evidence. Все формулы остаются неизменными.

### 2.4. Модели, mappings, sync и изоляция

**Факты:** [api/models.py][MODELS] содержит KI, card↔KI с role/complexity/weight, raw Attempt с user/card/KI/event/time/evaluation_data/review, и единственную KI-state projection на пару `(user_id, knowledge_item_id)`. `rule_code` nullable и не объявлен unique; отдельного `skill_key` и колонки ability нет. Схема Attempt допускает null card_id, но **новый cardless Attempt отвергается действующим API**.

[sync_knowledge_attempts][KR] для каждого нового события проверяет существование KI, активную карточку, эффективный доступ к колоде и точную пару `card_id → primary knowledge_item_id`. Если указан review, он принадлежит этому пользователю и той же карточке. Secondary не даёт права на Attempt. Для assessment дополнительно проверяются v3, status/correct, deck, некоторые структурные поля и `client_event_id=session_id:card_id`, review_id=null. Это не проверка истинности ответа, membership компетенции в паспорте или серверно созданной экзаменационной сессии: часть полей остаётся клиентским заявлением.

История immutable по `(user_id, client_event_id)`: идентичный payload возвращает duplicate, изменённый — event_conflict. Сравнение времени нормализуется до секунд. Идентичный replay принятого события подтверждается **до** повторной проверки текущего доступа/mapping — это сохранение принятой истории после revoke/unmapping, не разрешение нового события. Insert и projection update атомарны; PostgreSQL advisory lock сериализует пару user/KI. Rebuild использует raw историю и тот же scorer.

[getLocalDb](../app/src/services/localDb.js) создаёт отдельную Dexie на user ID. Capture, content loading и sync закрепляют исходный database handle до await, проверяют аккаунт; sync использует `_expectedUserId` в [api interceptor](../app/src/services/api.js). Поздний ответ не должен затронуть новую базу. Закрытая при logout очередь восстанавливается через stale recovery. Это подтверждено существующим [knowledgeFlow test suite](../app/src/services/__tests__/knowledgeFlow.test.js) как покрытие кода; в этом аудите suite с Dexie отдельно не запускался.

Knowledge outbox отделён от entity `/sync/v2`: transport error возвращает пакет в pending; created/duplicate удаляет только отправленные IDs; отказ/conflict помечает failed; отсутствующий результат возвращается в pending. Обновление KI/mappings атомарно заменяет mapping для карточек колоды и не переписывает старый outbox. Событие со старым primary после remapping может быть отвергнуто как новое; автоматически переназначать его другому KI нельзя. Отрицательные временные ID карточек/несуществующий на сервере источник также не обходят проверку происхождения.

### 2.5. Роль Admin

**Факт:** Admin владеет созданием/импортом/переносом контента и compatibility perimeter. Чистые форматы/answer contracts поступают из pinned `lerne-card-core==0.1.3`; runtime не импортирует sibling TMA. Подтверждение: [SHARED_CARD_CORE](../../lerne-admin/docs/SHARED_CARD_CORE.md), [card_core adapter](../../lerne-admin/src/lerne_admin/core/card_core.py), [Admin models](../../lerne-admin/src/lerne_admin/core/api/models.py).

В просмотренном Admin source не найден runtime Knowledge capture, KI mastery engine, Game Mode engine или игровой editor/API. [MATERIAL_TRANSFER](../../lerne-admin/docs/MATERIAL_TRANSFER.md), раздел «Целостность и восстановление», явно исключает learner progress, review history и knowledge attempts/mastery из переноса. Наличие моделей SRS в admin core не означает runtime диагностику знаний.

**Предложение:** в будущем Admin может проверять authored diagnostic rubric и mapping при выпуске контента. Он не должен вычислять второй mastery, переносить чужие Attempts как контент или автоматически менять KI. Изменение общего формата потребует отдельного reviewed выпуска card-core и проверки совместимости обоих проектов; для нынешнего отчёта это не нужно.

## 3. Реальное состояние Game Mode

### 3.1. Рабочая ветка adaptive-knowledge

**Факт:** [DeckGridHeader](../app/src/components/deckgrid/DeckGridHeader.jsx) содержит кнопку `Game Mode · Stadtbibliothek`, вызывающую `setView('game')` после auth gate. В [App.renderView](../app/src/App.jsx) нет `case 'game'` и импорта GameView; неизвестный view попадает в default DeckGrid. В [api/main.py](../api/main.py) нет игрового router. Здесь есть [LerneSignIn](../app/src/components/auth/LerneSignIn.jsx) и [lerne_sso](../api/auth/lerne_sso.py) для передачи подтверждения личности Game Test, но это не игровой учебный engine и не Knowledge-интеграция.

Следовательно, в этой ветке Game Mode **не реализован как работающий учебный flow**, несмотря на видимую кнопку. Это статический вывод; UI этой кнопки в браузере в рамках аудита не запускался.

### 3.2. Отдельная ветка game-mode: прототип существует

Все ссылки `[G…]` ниже закреплены за прочитанным commit другой ветки; они не обозначают файлы текущего checkout.

| Слой | Фактические компоненты/API | Что уже есть |
| --- | --- | --- |
| UI / client | [GameView / GameConversation][GVIEW], [useGameVoice][GVOICE], [gameService][GCLIENT] | Текстовый разговор, история, hint, повтор/TTS, голосовой turn flow, свободный разговор с соседом и экзаменационный B1 planning dialogue; сохранённый attempt ID/настройки. Публичный StartRequest выбирает neighbor/b1_exam; библиотечный сценарий сохранён в engine, но не является этим выбором UI |
| Conversation API | [api/routers/game.py][GROUTER] | `GET /api/game/scene`, `POST /api/game/attempts`, `GET /api/game/attempts/{id}`, `POST /api/game/attempts/{id}/turns`, `GET /api/game/exam-attempts`; actions message/hint/end/review |
| Engine / persistence | [game_service][GSERVICE], [game_scene][GSCENE], [models.TMAGameAttempt][GMODELS] | User-owned attempt, state/history/outcome, hint/clarification/turn counters, versions, inflight reservation, last request ID/hash и replay handling. Библиотека имеет детерминированный переход offered/borrowed и успех по выбранной книге; intent приходит из dialogue processing |
| B1 review | [game_exam.exam_review][GEXAM] | Разбор task completion, grammar/vocabulary с цитатами из retained user history; отбрасывает не найденные в репликах цитаты; `assessment_status=provisional`. Нет записи Knowledge и нет официального экзаменационного балла |
| MVP3 foundation | [integration.begin_capture / capture_turn][GINTEGRATION], [schemas][GSCHEMAS], [catalog][GCATALOG] | Shadow capture committed engine events, источники/версии/request IDs, помощь, task definitions, память NPC. Реальные task IDs и feature flags; не клиентские произвольные skills |
| Foundation reads | [game-foundation router][GFOUNDATION], [LanguageProgressService][GPROGRESS] | Read/delete API events, results, comparison, skills, NPC memory; register_result — backend entry, не клиентский write API |

**Факты и ограничения прототипа:**

1. В [flags.enabled_for][GFLAGS] MVP3 ограничен изолированным непроизводственным режимом и одним явно выбранным положительным account ID. Это не массово включённая функция.
2. [capture_turn][GINTEGRATION] записывает engine interactions; для завершённого библиотечного задания формирует `ServerObservation`. Явно оставляет `modality='unknown'`, `support_tracking_complete=false`, не добавляет skill evidence. Успешно взятая книга **не подтверждает грамматику/самостоятельность**. Neighbor и B1 exam не входят в DEFAULT_CATALOG.tasks и не получают этот library capture.
3. [LanguageProgressService.register_result][GPROGRESS] различает objective engine outcome и неподтверждённый model analysis. Проверяет совместимость task/skill/modality; independent требует полного учёта помощи и нескольких событий. `skills()` строит собственные qualitative states, `compare()` требует сопоставимости. **Это уже отдельный экспериментальный путь результатов/skills, не TMAKnowledgeAttempt/Mastery.**
4. [foundation models][GFOUNDATIONMODELS] содержат CommunicationResult, GameInteraction, GameCapture, NPCMemory. Task results и память мира полезны как доменные данные; их нельзя автоматически трактовать как ещё один показатель владения языком. Не найден bridge в `TMAKnowledgeAttempt`, общий KI mapping или вызов `apply_created_attempt` из этих сервисов.
5. Публичный Game Test в этом commit использует negative visitor ID через `X-User-ID` ([gameService][GCLIENT], [get_game_user_id][GAUTH]); вне game-test backend требует обычную auth, но этот test client сам account Bearer не добавляет. Foundation требует положительный authenticated pilot account. Эти контексты нельзя объединить простым копированием числового ID. Текущая adaptive-knowledge SSO реализация — ещё один, отдельно проверяемый слой, не доказательство готового общего login flow во всех ветках.
6. UI-кнопки repeat/TTS и голосовой режим не дают полного серверного журнала помощи/модальности. Снижение сложности, model clarification и ASR uncertainty не равны установленным ошибкам ученика. `hint_count` — лишь один вид помощи. Вне exam history ограничена; последующий анализ не обязан видеть весь разговор.
7. Наличие `api/game_test.py`, миграционных скриптов и тестов в Git не доказывает, что нужные таблицы, flags, auth и маршруты включены в конкретном deployment. В этом аудите они не запускались.

Дополнительно: [game_conversation.learning_result][GCONVERSATION] уже возвращает итоги свободного разговора, model-observed goals, difficulties и review candidates; model observations помечены `confirmed=false`. Это не grammar KI evidence. [useGameVoice][GVOICE] использует browser SpeechRecognition, собирает финальные/промежуточные гипотезы и при известном низком ASR confidence просит проверить текст. На сервер через обычный message уходит текст, а не этот полный quality trace. Поэтому наличие обработки uncertain в UI ещё не решает диагностическую сохранность модальности.

**Вывод:** неверно как «Game Mode нигде нет», так и «Game Mode уже подключён к Knowledge». Есть отдельный прототип с полезными provenance/transaction boundaries, который необходимо согласовать с текущим Knowledge до интеграции. Переносить всю ветку ради evidence не требуется.

### 3.3. Минимальная будущая интеграция

**Предложение:** сохранить NPC memory, игровые state/history и task completion в роли данных сценария. Единственный языковой результат направлять в `TMAKnowledgeAttempt` и существующий KI/Mastery контур. При будущей интеграции не подключать `LanguageProgressService.skills()` как параллельную шкалу знаний; судьбу старых experimental skill results и их пользовательского отображения решить отдельно, без backfill в KI.

Для первого технического доказательства достаточно одного **реального карточного задания**, показанного внутри игрового контекста, с одним существующим primary KI. Использовать действительную карточку и серверную проверку её доступности; не придумывать card_id для реплики и не создавать SRS review ради игры. Новая выдача card-backed evidence потребует отдельного согласованного типа/валидатора: текущий study capture привязан к grade, а v3 — к assessment, поэтому их нельзя просто переименовать в Game event.

Для свободной реплики минимально необходимы server-owned activity/task instance, версия rubric, одна диагностическая единица → один проверяемый primary KI, подтверждённое наблюдение, support/modality и авторитетный результат проверки. Единую persistence/scoring boundary следует переиспользовать после admission проверки, а не добавлять вторую таблицу mastery.

## 4. Предлагаемый единый логический контракт evidence

### 4.1. Статус контракта и семантика

**Предложение для согласования, не новый wire format:** следующие поля описывают смысл будущего события. Это не утверждённый `schema_version=4`, не новая таблица и не поддерживаемый сейчас HTTP payload. Расширяемый `evaluation_data` позволяет обсуждать контракт без миграции БД, но JSON-вместимость сама по себе не даёт безопасного admission и правильного scoring.

| Логическая группа | Минимум | Инвариант |
| --- | --- | --- |
| Идентичность | event ID, authenticated subject, occurred_at; received_at на сервере | Subject выводится из auth; клиент не выбирает другого user. ID стабилен при сетевом повторе |
| Источник | source `classic_study / game_mode / dialogue`; activity kind/mode, instance ID, diagnostic unit ID, revision | Источник не является способностью. Диалог в Game может иметь source=dialogue и context mode=game_mode без второго события |
| Происхождение | реальный card_id **или** server activity reference, mapping/rubric revision, result receipt/reference | Ссылка проверяется сервером; произвольные source/skill ID в JSON не дают полномочий |
| Цель | один knowledge_item_id на оценочную единицу; optional semantic key из reviewed каталога | Primary определяется разрешённым mapping. Secondary/context не получает contribution |
| Способность | recognition / guided_application / independent_application / unknown; modality | Назначение зависит от rubric и фактической помощи. Нельзя вывести independent из отсутствующего счётчика |
| Возможность наблюдения | opportunity `present / absent / unknown`, reason | Требуется реальный случай применения целевого навыка. Допустимый обход конструкции не является ошибкой этого KI |
| Объективный результат | outcome `correct / incorrect / not_observed / unverified`; completed отдельно | Incorrect допустим при present opportunity и надёжно установленной ошибке именно цели. Unavailable/ASR doubt → unverified; skip/no target use → not_observed с причиной |
| Попытки | check count, mistake check count, optional interaction count, first-check result; unknown=null | Нужна семантика счётчика/версия policy. Не сравнивать один Match interaction с одним полным Check Trainer |
| Помощь | support tracking complete; hint, translation, reveal и other help counts/types | Ноль означает наблюдаемый ноль. Видимые варианты/каркас — опора rubric, даже если hint_count=0 |
| Проверка | exact/rules/AI/human/self; evaluator/rubric version, status verified/provisional/unavailable, confidence или unknown, error relevance/codes | Проверяющий результата и confidence Mastery различны. Доверие не задаётся одним клиентским boolean |
| Самооценка | rating + scale в отдельном optional поле | Self-rating не заполняет objective outcome. Hybrid хранит обе оси, сохраняя legacy scoring |
| Контекст удержания | task variant/equivalence group, observation time; optional followup reference | Вторая проверка через время — отдельное наблюдение; не копирование прошлой оценки и не новый прогресс |

Иллюстрация **логического** события из карточки D14; не отправлять в действующий API:

```json
{
  "event_id": "stable-observation-id",
  "source": "classic_study",
  "activity": { "kind": "assessment", "instance_id": "session-id", "unit_id": "358365" },
  "origin": { "card_id": 358365, "revision": "reviewed-content-revision" },
  "knowledge_item_id": 12,
  "ability": "recognition",
  "modality": "written_choice",
  "opportunity": "present",
  "objective": { "outcome": "correct", "completed": true },
  "checks": { "count": 1, "mistake_count": 0, "first_correct": true },
  "support": { "tracking_complete": false, "hint_count": null, "visible_options": true },
  "verification": { "evaluator": "rules", "status": "verified", "rubric_version": "draft-1" },
  "self_assessment": null,
  "occurred_at": "2026-11-01T10:00:00Z"
}
```

Число 12 здесь взято из архитектурного документа как production пример; LOCAL PK должен разрешаться по проверенному mapping, а не копироваться между базами. `verified` в примере означает принятую проверку конкретного выбора; для реального доверенного server event нужен проверенный результат/receipt. При текущем клиентском v3 это качество нельзя подтвердить одним заявлением клиента.

### 4.2. Отсутствие наблюдения и качество результата

**Предлагаемое правило admission/scoring для будущей диагностики:**

| Ситуация | Диагностический исход | Допустимый вывод |
| --- | --- | --- |
| Ученик выбрал dem в заданной альтернативе | correct + recognition | Выбор формы в этом контексте, не application |
| После hint/примеров построил корректную фразу | correct + guided_application | Успех с помощью; не independent |
| Без готовых форм построил Relativsatz, проверена целевая грамматика, помощь наблюдалась полностью | correct + independent_application в указанном канале | Один подтверждённый случай самостоятельного применения |
| По коммуникативной задаче сказал корректную альтернативу без целевой конструкции | not_observed для отсутствующего целевого навыка | Коммуникативная задача могла быть решена; KI не наблюдался |
| Попытался применить правило, проверена конкретная первичная ошибка | incorrect для этой diagnostic unit/KI | Локальное отрицательное наблюдение, без распространения на secondary/prerequisite |
| Skip, закрытие до ответа | not_observed, reason=skipped/abandoned | Не создавать отрицательный mastery evidence |
| Сервис не ответил, низкая уверенность, сомнительный ASR или неоднозначная рубрика | unverified | Не превращать в ошибку; нужна перепроверка |
| Только «Easy» | self-assessment, objective отсутствует | Субъективная оценка трудности |

Не менять задним числом семантику v1–v3. В частности, текущий v3 хранит `correct=false` для skipped, но новый читатель обязан сначала читать status. Raw отсутствие Attempt вообще не объясняет причину отсутствия: «не учил», «не было KI», «не отправил grade», «capture failed» неразличимы без дополнительного наблюдения.

Если задание явно требует построить Relativsatz, а отправленный ответ не выполняет обязательную инструкцию, rubric может установить task-level `missing_content` и неуспех целевого задания production. Это отличается от свободной коммуникативной задачи, допускающей обход конструкции. Такой неуспех не доказывает отдельную ошибку Dativ/порядка слов, которые в ответе не наблюдались; их отрицательные оценки нельзя выводить автоматически.

### 4.3. Совместимость с существующими версиями и Mastery

| Контур | Что можно честно прочитать сейчас | Как эволюционировать после согласования |
| --- | --- | --- |
| v1 | Только self rating; ability/support/outcome unknown | Сохранить без переписывания payload. Не синтезировать objective correctness |
| v2 | Финал/счётчики/summary и self. evaluator иногда в summary; его отсутствие не означает rules | Аддитивная metadata могла бы хранить новые наблюдения, но **не меняет** mastery-v1. Нельзя добавить `unverified=true` и считать, что scorer перестанет учитывать completed hybrid |
| v3 | Объективный статус заявленного результата, metadata assessment и агрегаты ошибок; самостоятельность unknown | Сохранить старые validation/ID/status. Восстанавливать потерянный confidence/final evaluator из `card_type` нельзя; не использовать v3 как универсальное игровое событие |
| Новые источники/исходы | Сейчас нет согласованного формата | Отдельно утвердить version/type и typed validation. Пока scorer его не поддерживает, новые raw события должны быть явно неоцениваемыми; не маскировать их под completed v2/assessment v3 |
| Primary/secondary | Один primary KI даёт один Attempt; связанные KI не агрегируются автоматически | Для нескольких навыков диалога — отдельные server-defined diagnostic units, каждая с собственным проверенным первичным mapping и event identity. Это отдельное расширение, не несколько KI под одним card_id |
| Состояние навыка | Одна state projection на user/KI, без ability/modality breakdown | В отчётах можно различать raw наблюдения. Для независимых mastery recognition/application нужны отдельно согласованные измеряемые KI, как в архитектурном документе, либо будущее изменение projection. Сейчас ни то ни другое не выполняется |

**Предложение:** guided_application сначала считать характеристикой evidence/условий выполнения. Не создавать автоматически третий KI для каждого понятия и не переносить guided баллы в independent. Согласование будущих recognition/application KI и семантики general KI — отдельный шаг; старые KI 9–16 и их история сохраняют исходный смысл. Источник card/game/dialogue не должен размножать KI для одного и того же измеряемого умения.

Нет оснований обещать одновременно новую scoring семантику и неизменный mastery-v1 только за счёт JSON-полей. Первый этап может дать более честную историю наблюдений; влияние новых типов на единственную Mastery требует отдельного решения и регрессий, не второго алгоритма в UI.

### 4.4. Безопасная проверка происхождения Game/диалогов

**Сохранить текущую card-bound защиту без исключений.** В частности, не добавлять условие «source=game → пропустить card/primary проверку», не использовать fake card_id, не выбирать любой secondary KI и не принимать произвольный `activity_id` как доказательство происхождения.

**Предлагаемый альтернативный admission path:**

1. Сервер создаёт/разрешает activity instance конкретному authenticated account. Server-owned versioned task definition задаёт diagnostic unit, разрешённый primary KI, способность, modality и rubric. Клиент может ссылаться на unit, но не переопределять KI/качество результата.
2. Сервер проверяет owner, namespace/окружение, права на активность, source version, committed turn/request, наличие диагностической возможности и соответствие unit→KI. За основу можно взять `owned_attempt`, engine versions и GameInteraction из прототипа; связь с KI пока нужно спроектировать.
3. Для языкового результата authoritative evaluator создаёт server result/reference. Engine success «получена книга» сам не создаёт grammar evidence; model finding остаётся provisional до принятой проверки. Валидация происхождения и достоверность оценки — две отдельные проверки.
4. Event identity выводится сервером из `(source instance, committed result/turn, diagnostic unit, observation revision)`. Retry с тем же payload — duplicate, другой payload — conflict. Нельзя выдавать новые UUID для одного результата, чтобы повторно увеличивать evidence mass. Повторная независимая проверка — новая activity observation, не replay.
5. Только после admission использовать общую транзакцию raw Attempt + существующий projection scorer, с тем же lock user/KI. Для такого источника `card_id=null`, `review_id=null` могут соответствовать имеющейся модели, но действующий endpoint этого не разрешает. Понадобится отдельно согласованный валидатор/route или discriminated branch; текущий `/attempts/sync` для карточек остаётся строгим.
6. Если Game Test работает в другой БД, integer user ID и visitor header недостаточны. Сначала связать verified issuer identity с локальным authenticated account; сервисный bridge при необходимости должен проверять issuer/audience/namespace и подписанный результат. Не импортировать test visitor history в production KI. SSO подтверждает личность, но не истинность игровых оценок.

**Offline:** для существующих карточек сохранить account-scoped outbox и старые payload. Для нового сценарного источника наиболее простой первый пилот — online authoritative commit; при offline нет подтверждённого server result, значит ещё нет verified KI evidence. В будущем offline activity может использовать заранее выданный подписанный manifest/grant, привязанный к account, activity/task/rubric version и mapping, с проверкой при reconnect и replay protection. Подпись manifest подтверждает разрешённое задание, не правильность клиентского ответа; языковой ответ всё равно требует проверки. Не ставить длинный диалоговый текст в существующий outbox без отдельной политики хранения/размеров.

**Remapping/revocation:** старый уже принятый immutable replay должен подтверждаться; новое событие не должно получать чужой или новый KI автоматически. Для cached activity versions нужно отдельно определить срок/политику admission после смены rubric и отзыва прав. Новые дополнительные поля не дописывать в повтор старого payload: сервер сравнивает JSON целиком.

### 4.5. Проверка сохранения знаний

**Предложение:** две сопоставимые observation через время, с новым task variant, той же проверяемой целью, каналом, difficulty/rubric и явно зарегистрированной помощью. Хранить связь с baseline в evidence, а не отдельную retention mastery/state. Для раннего пилота достаточно ручной повторной проверки через 7–14 дней; это организационный протокол, не новый scheduler и не изменение SRS.

Повтор того же выученного текста слабее переноса на новый пример. Не назначать «знание сохранено» по одному последнему timestamp, большой evidence mass или многим retry в одном занятии. Несопоставимая модальность/иная помощь/неизвестная версия → вывод о retention не установлен.

## 5. Ограничения и архитектурные риски

| Риск, статус | Следствие | Ограничение будущего решения |
| --- | --- | --- |
| **Смешение ability в одном KI — факт модели** | Высокая general mastery может складываться из choice и self rating; independent не выделено | Не переименовывать прошлую историю; обсуждать отдельные измеряемые KI до пилотной разметки |
| **Неполный учёт помощи — факт capture** | First try ошибочно выглядит как самостоятельность | Unknown по умолчанию; фиксировать visible scaffolding и полноту support tracking |
| **Смещение к завершённым ответам — факт E/K** | Незавершённые ошибки исчезают или не участвуют в v2 mastery | Признать предел существующей projection; не менять формулу скрыто |
| **v3 теряет качество проверки — факт AS** | AI answer и exact choice получают одинаковую objective weight | Сначала lossless evidence proposal и эталонный набор, затем отдельное scoring решение |
| **Происхождение ≠ истинность — факт KR/A** | Client-crafted correct при разрешённой карточке не проходит серверную перепроверку ответа | Server result/receipt для новых доверенных источников; не обещать античит для legacy |
| **Другая ветка/старая версия Game API — факт Git** | Простое копирование может вернуть старые auth/sync допущения | Интегрировать узкую границу, сверять с текущими guards; не делать merge всей ветки в рамках диагностики |
| **Существующие experimental game skills — факт GPROGRESS** | Возможны два конкурирующих представления языкового прогресса | Не развивать второй mastery; сохранить отдельно лишь task/world facts, согласовать вывод старого skill UI |
| **Контент/primary меняются — факт transport** | Offline событие старой версии может быть отвергнуто либо не отражать текущую рубрику | Версии, immutable origin, явная политика revoke/remap; не перепривязывать историю |
| **Grade и capture не атомарны — факт session/capture** | Успешная SRS запись без diagnostic Attempt | Измерить потери, затем отдельно улучшать delivery; audit не вводит третью очередь |
| **Локальный duplicate check слабее server check — факт knowledgeDbService** | enqueue сравнивает KI/card/score/result, не весь evaluation_data; переиспользованный ID с иным JSON может локально скрыть конфликт | Канонический immutable payload и проверка конфликта в будущих контрактных тестах; серверная проверка остаётся обязательной |
| **Нет unique semantic key — факт models** | Одинаковые rule_code/разные PK окружений могут быть ошибочно объединены | Reviewed catalogue и явный resolver, без массового переименования |
| **ASR/AI и личные реплики — вывод** | Ложные ошибки, невалидные отрицательные выводы, избыточное хранение текста | Modality/quality/provisional, минимальные references, policy retention/erasure; не сохранять chain-of-thought |
| **Весь ответ приписан одному primary — факт current contract** | Ошибка другого правила может снизить выбранный KI | Target relevance и отдельные проверенные units; secondary без баллов |
| **Быстрая повторная проверка ≠ retention — вывод** | Рост confidence может отражать тренировку одного примера | Разнести по времени и примерам, без автоматического пропуска тем |

Ограничение автоматической диагностики принципиально: приложение наблюдает действия в интерфейсе, но не внешнюю помощь. Даже полная внутренняя telemetry устанавливает «без зарегистрированной помощи в приложении», а не абсолютную независимость человека.

## 6. Минимальный пилот на существующей D14

### 6.1. Проверенные данные и цель

**Факт:** прочитан локальный `local/test-data/lesson-qa/corrected.snapshot.json`, используемый [assessment browser test](../scripts/tests/browser/assessment.spec.cjs) и [assessment unit test](../app/src/utils/__tests__/assessment.test.js). Он содержит D14 `deck_id=7139`, 48 карточек: 46 обязательных и 2 bonus. Это **исправленный локальный снимок/план**, не подтверждение применения всех исправлений к production. [ASSESSMENT.md](ASSESSMENT.md) прямо описывает неприменённый update-plan. Контент не копируется в новый tracked fixture; снимок и mappings не менялись.

Архитектурный документ отдельно сообщает production primary для 358363→KI10, 358365→KI12, 358375→KI13. Локальный snapshot содержит mapping proposals по rule_code; числовые production PK нельзя автоматически назначать LOCAL.

**Предложение:** один локальный пилот «Relativsatz: выбор формы → заполнение → построение», шесть существующих карточек. Цель — доказать, что разная сила evidence описывается честно, и найти ограничения rubric/checker. Не цель — измерить долгосрочное владение темой или внедрить новые recognition/application KI.

### 6.2. Набор и ожидаемые наблюдения

| Карточка D14 | Механика / текущая цель | Диагностическая интерпретация пилота | Ожидаемый результат |
| --- | --- | --- | --- |
| 358363, №1 | Trainer choice der/den/dem; nominative | Recognition, контрольный простой случай | Верный первый выбор → correct recognition; ошибочный первый → incorrect v3, а не последующий успешный retry |
| 358365, №3 | Trainer choice der/den/dem; dative | Recognition Dativ | Правильный dem не подтверждает самостоятельное построение; сопоставить с выводом архитектурного документа |
| 358375, №13 | Trainer input `mit dem` в готовой фразе; prepositions | Guided application управления в заданном каркасе | Точное authored заполнение проверяется rules; альтернативу вне rubric считать спорной для диагностики, не ошибкой другого KI |
| 358385, №23 | Trainer input формы spricht в уже конечном gap; word_order | Guided application формы; **самостоятельное размещение глагола не наблюдается** | Выявить ограничение текущей цели/mapping как вопрос для обсуждения, не переназначать KI |
| 358397, №35 | Ввод целого придаточного по двум исходным предложениям; production | Guided sentence construction с частичной продукцией: matrix clause уже дана | Успех на exact target подтверждает этот вариант построения, не свободный перенос/говорение |
| 358407, №45 | Free Text: полный вопрос с Relativsatz по русской ситуации; production | Кандидат independent written application при отсутствии помощи; Dativ можно описать экспертно, но текущий primary остаётся production | Проверить местоимение, адресата и порядок модального глагола. AI verdict без экспертного подтверждения считать provisional в анализе; не делать второй Attempt в dative KI |

**Контроль неоднозначности:** дополнительно вручную разобрать existing 358406, где accepted alternative «die sehr hell ist» допустима. Она подтверждает production относительного предложения, но не наблюдает предложный Dativ «in der». Это проверка границы rubric, не добавление седьмого оцениваемого навыка.

### 6.3. Как провести после отдельного решения

1. Подготовить disposable LOCAL fixture из разрешённого снимка, сохранить существующие IDs, содержание и mappings внутри изоляции; никаких production writes. Для автоматических тестов использовать синтетические варианты, реальные артефакты — только `local/test-data/`.
2. До ответов эксперт заполняет таблицу card→цель→видимая опора→допустимые альтернативы→условия negative verdict. Не принимать паспортное `support=independent` за наблюдение. Для 358385 явно указать, что позиция уже дана.
3. Использовать существующий first-response assessment protocol в локальной изоляции; для поднабора нужен локальный fixture config с согласованным required_count/bands, поскольку `createAssessment` не принимает произвольное усечение полной D14. Production паспорт не редактировать. Серия правильных/неправильных/skip/unavailable входов проверяет plumbing, но сама не калибрует AI.
4. Отдельно выполнить небольшой экспертный набор ответов: правильные, целевые ошибки, допустимые альтернативы, ошибки другого правила, отсутствие конструкции, accepted minor, unavailable. Первое прохождение не должно раскрывать эталон; retry с hint исследовать отдельно как guided, не повторный независимый baseline.
5. Сопоставить UI result → локальный outbox → изолированный raw Attempt → текущую projection. Таблица аудита/тестовый артефакт не является новой пользовательской системой прогресса. Для новых логических полей пока достаточно проверяемых ожиданий, не внедрения runtime telemetry.
6. После согласования retention protocol вручную повторить через 7–14 дней на новых сопоставимых примерах; не изменять SRS. В текущем аудите такой эксперимент не выполнен.

### 6.4. Критерии успешности

- Все шесть механик/целей экспертно классифицированы; ни один choice, scaffolded gap или Speech follow-up не назван независимой продукцией.
- Для каждого actual outcome указано, какие данные есть raw и какие неизвестны. Неизвестные hints/confidence не заменены нулём/единицей.
- На согласованном небольшом эталонном наборе нет ложного independent и нет отрицательного KI вывода из skip/unavailable/допустимого обхода целевой конструкции. Спорный ответ остаётся unverified. Это gate пилота, не обещание нулевой ошибки будущей AI системы.
- По отдельно аннотированным целевым ошибкам и допустимым вариантам показана таблица TP/FP/FN/TN либо разногласий checker/эксперт; без достаточного объёма не заявлять статистическую точность. Несогласие экспертов сначала означает дефект/неполноту rubric.
- Один подтверждённый ответ → один raw Attempt нужного primary; сетевой replay не увеличивает contribution. Secondary не оценивается. Смена аккаунта/неверный origin отвергается, потерянный ответ sync не удаляет outbox.
- Skipped даёт 0 баллов экзамена и **0 mastery contribution**; исчерпанный неверный v2 сохраняет существующее ignored поведение, а не считается исправленным этим пилотом.
- Mappings, legacy KI 9–16, SRS, mastery-v1 и пользовательское обучение остаются прежними. Высокая general mastery не используется как доказательство independent application.

Ожидаемый артефакт пилота: небольшая сопоставительная таблица экспертной rubric, фактических verdicts, raw payload и известных потерь. Никакой новой шкалы прогресса, карты, автоматического пропуска тем или игрового UI.

## 7. Следующий небольшой технический шаг и этапы

### 7.1. Следующая задача

**Предложение:** после обсуждения утвердить семантические правила и добавить только изолированные контрактные регрессии/fixtures для диагностических границ. Не начинать с Game UI, новой таблицы или изменения Mastery.

Минимальный объём: синтетические примеры recognition/guided/independent/unknown; правильный выбор с видимыми вариантами; помощь при first try; отсутствие целевой конструкции; unavailable; v2 exhausted; v3 skipped; два возможных KI, из которых разрешён только primary; повтор/изменённый payload; чужой account; неподтверждённый game origin. Для ещё не реализованного admission проверять проектируемый контракт отдельно от текущего runtime, не добавлять «зелёный» тест, выдающий неподдерживаемый API за реализованный.

Текущие raw v1/v2/v3 оставить golden fixtures с прежним scoring. Зафиксировать в тестах различие наблюдения и вывода: если текущий payload не содержит данных для independent/quality, ожидается unknown, а не ретроспективное повышение доверия. По результатам выбрать **одно** узкое улучшение сохранности evidence для существующей карточки; его runtime-реализация станет следующей отдельной задачей.

### 7.2. Оценка сложности и последовательность

**Оценка будущей реализации целиком: 7/10.** Общее хранилище, outbox и projection уже существуют; основные сложности — семантическая честность evidence, качество языкового grader, безопасный новый origin и согласование двух веток/identity namespaces. Минимальные контрактные тесты — 2/10; lossless card evidence с поддержкой старого outbox — 4/10; безопасный online game adapter — около 6/10; открытые голосовые диалоги с качественной диагностикой — 8–9/10. Это экспертная оценка объёма/риска, не измеренный срок.

Предлагаемая последовательность небольших этапов, каждый с отдельным review результата:

1. **Семантика и эталоны:** согласовать ability/outcome/help/quality и rubric шести карточек; отдельно решить семантику будущих recognition/application KI. Gate: нет неявного изменения legacy mapping.
2. **Контрактные регрессии:** зафиксировать legacy scoring, unknown/not_observed/unverified и матрицу безопасного origin на синтетических fixtures. Gate: старые payload и account isolation сохраняются.
3. **Одно улучшение card evidence:** сохранить выбранные теряемые атрибуты проверки/помощи без изменения SRS и mastery-v1; отдельно выбрать версию и поведение новых неоцениваемых наблюдений. Gate: mixed-version outbox, retries и content changes проходят изолированно.
4. **Локальный D14 пилот:** сопоставить экспертные labels, реальные verdicts и raw; измерить FP/FN, отдельно проверить помощь и отсутствие наблюдения. Gate: оснований для independent достаточно либо честно unknown. Новые KI/mappings — только отдельное решение.
5. **Один game task adapter:** использовать authoritative committed события и один KI; утвердить admission/receipt и identity binding, без generic dialogues и без развития второй mastery. Gate: fake source/чужой account/replay/conflict/remap/ошибка транзакции покрыты тестами.
6. **Повтор через время:** ручная сопоставимая проверка и анализ retention; автоматический планировщик по-прежнему вне этого этапа.
7. **Новые учебные диалоги:** после доказанной диагностики Game Mode — отдельные units для нескольких навыков, затем текстовые свободные реплики, затем голос с ASR quality. Gate: корректная альтернатива не становится ложной ошибкой; произношение/listening не выводятся из transcript.

**Главные риски:** назвать recognition самостоятельным применением; принять AI confidence за доказанную надёжность; ослабить card→primary guard ради игр; привязать test visitor к чужому account; сохранить параллельную игровую mastery; потерять pending события при версии/смене аккаунта. Эти риски важнее объёма UI-кода.

## 8. Выполненная проверка и её пределы

Проверка 01.11.2026, только локальная изоляция:

- Node: шесть существующих suites `exerciseEvaluation`, `matchQuizEvaluation`, `puzzleEvaluation`, `freeTextEvaluationState`, `assessment`, `speechEvaluation` — **47 passed, 0 failed, 0 skipped**. Запуск из `app`: `node --import ../scripts/tests/no-network.mjs --test-isolation=none --test` с шестью явными путями `src/utils/__tests__/*.test.js` соответствующих suites. Первоначальный стандартный process-isolated запуск остановился до тестов с `spawn EPERM`; повтор без дочерних test processes прошёл с тем же no-network guard. Это не браузерная и не cross-process проверка.
- Backend: `python scripts/test_backend.py tests/test_knowledge_sync.py` — **21 passed**; `python scripts/test_backend.py tests/test_knowledge_mastery.py` — **20 passed**. Runner блокирует сеть, PostgreSQL connect, dotenv/production setup; suites используют in-memory SQLite. Проверены существующие validation/idempotency/scoring сценарии, новые функции не добавлялись.
- Статически прослежены callbacks, payload builders, серверные guards/scorer, account-owned persistence и отдельный game commit; прочитаны D14 local snapshot и архитектурный Google Doc. Проверены ссылки/пути и итоговый diff отчёта.

Не выполнялись: production SELECT/запись, запуск Admin/Game, внешняя AI оценка, browser/voice/mobile QA, новые HTTP/PostgreSQL E2E, полный suite/build/lint, retention эксперимент. Прошедшие unit tests не подтверждают качество языковой модели, readiness игрового deployment или полноту telemetry помощи.

## Ссылки на реализации

В таблицах указаны файлы; ключевые функции названы в тексте. Ссылки на Game закреплены за отдельным Git commit, остальные относительные TMA-ссылки относятся к baseline в разделе 0.

[D]: ../app/src/utils/exerciseDetector.js
[E]: ../app/src/utils/exerciseEvaluation.js
[Q]: ../app/src/components/study/StudyCardQuiz.jsx
[M]: ../app/src/utils/matchEvaluation.js
[T]: ../app/src/components/study/StudyCardTrainer.jsx
[C]: ../app/src/utils/clozeParser.js
[W]: ../app/src/utils/wordBankState.js
[P]: ../app/src/utils/puzzleEvaluation.js
[F]: ../app/src/utils/freeTextEvaluationState.js
[A]: ../api/services/answer_evaluation.py
[AR]: ../api/services/answer_rules.py
[AC]: ../api/card_core/lerne_card_core/answer_contract.py
[AI]: ../api/services/answer_ai.py
[S]: ../app/src/utils/speechEvaluation.js
[L]: ../app/src/store/useLidStore.js
[SV]: ../app/src/components/study/StudyView.jsx
[CAP]: ../app/src/services/knowledgeCaptureService.js
[AS]: ../app/src/utils/assessment.js
[ASV]: ../app/src/components/study/AssessmentView.jsx
[K]: ../api/services/knowledge_mastery.py
[KS]: ../app/src/services/knowledgeSyncService.js
[KR]: ../api/routers/knowledge.py
[MODELS]: ../api/models.py
[GVIEW]: https://github.com/LanguageSage/lerne-tma/blob/15f91227de0c5586b3badfdd370c6cb2dec92035/app/src/components/game/GameView.jsx
[GVOICE]: https://github.com/LanguageSage/lerne-tma/blob/15f91227de0c5586b3badfdd370c6cb2dec92035/app/src/components/game/useGameVoice.js
[GCLIENT]: https://github.com/LanguageSage/lerne-tma/blob/15f91227de0c5586b3badfdd370c6cb2dec92035/app/src/services/gameService.js
[GROUTER]: https://github.com/LanguageSage/lerne-tma/blob/15f91227de0c5586b3badfdd370c6cb2dec92035/api/routers/game.py
[GSERVICE]: https://github.com/LanguageSage/lerne-tma/blob/15f91227de0c5586b3badfdd370c6cb2dec92035/api/services/game_service.py
[GSCENE]: https://github.com/LanguageSage/lerne-tma/blob/15f91227de0c5586b3badfdd370c6cb2dec92035/api/services/game_scene.py
[GMODELS]: https://github.com/LanguageSage/lerne-tma/blob/15f91227de0c5586b3badfdd370c6cb2dec92035/api/models.py
[GEXAM]: https://github.com/LanguageSage/lerne-tma/blob/15f91227de0c5586b3badfdd370c6cb2dec92035/api/services/game_exam.py
[GCONVERSATION]: https://github.com/LanguageSage/lerne-tma/blob/15f91227de0c5586b3badfdd370c6cb2dec92035/api/services/game_conversation.py
[GINTEGRATION]: https://github.com/LanguageSage/lerne-tma/blob/15f91227de0c5586b3badfdd370c6cb2dec92035/api/game_mvp3/integration.py
[GSCHEMAS]: https://github.com/LanguageSage/lerne-tma/blob/15f91227de0c5586b3badfdd370c6cb2dec92035/api/game_mvp3/schemas.py
[GCATALOG]: https://github.com/LanguageSage/lerne-tma/blob/15f91227de0c5586b3badfdd370c6cb2dec92035/api/game_mvp3/catalog.py
[GFOUNDATION]: https://github.com/LanguageSage/lerne-tma/blob/15f91227de0c5586b3badfdd370c6cb2dec92035/api/game_mvp3/router.py
[GPROGRESS]: https://github.com/LanguageSage/lerne-tma/blob/15f91227de0c5586b3badfdd370c6cb2dec92035/api/game_mvp3/progress.py
[GFLAGS]: https://github.com/LanguageSage/lerne-tma/blob/15f91227de0c5586b3badfdd370c6cb2dec92035/api/game_mvp3/flags.py
[GFOUNDATIONMODELS]: https://github.com/LanguageSage/lerne-tma/blob/15f91227de0c5586b3badfdd370c6cb2dec92035/api/game_mvp3/models.py
[GAUTH]: https://github.com/LanguageSage/lerne-tma/blob/15f91227de0c5586b3badfdd370c6cb2dec92035/api/dependencies/auth.py
