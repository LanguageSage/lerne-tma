# Lerne Adaptive: наблюдение помощи в Trainer

Дата: 01.11.2026. Ветка `codex/adaptive-knowledge`.
Продолжение [Free Text supportEvidence](LERNE_ADAPTIVE_SUPPORT_EVIDENCE.md).

Trainer choice/input подключён к существующим `createSupportSession` и
`captureSupportEvidence`. Проверка ответов, SRS, Mastery v1, KI/mappings,
`target_relevance`, Game Mode и остальные типы карточек не изменялись.
Schema versions и stable event IDs сохранены; production, деплой и migrations
не запускались. Тестовые mapping-строки создавались только в одноразовом PG.

## Что наблюдается

| Поверхность | Сохранение факта / ограничение |
| --- | --- |
| Dropdown choice | Его открытие/выбор не добавляют hint. Наличие предоставляемых вариантов — `task_support.answer_options_present=true`, включая автоматически сгенерированные parser варианты. Это характеристика механики, а не утверждение, что все варианты были прочитаны. |
| Input | Ввод, редактирование, Enter не объявляются помощью. Они используют прежний checker и attempt policy. |
| Кнопка «Показать перевод» | Реальное открытие скрытого `back/back_text` увеличивает `translation_view_count` на один. Закрытие не увеличивает; повторное открытие увеличивает. Restore открытого перевода не считается новым открытием. Содержимое `back` сохраняет существующее название UI; смысл текста не классифицируется автоматически. |
| Inline feedback | Каждый непустой `part.hint`, выведенный рядом с пропуском после новой проверки, увеличивает `hint_count` один раз. Несколько неверных пропусков дают несколько показов. Повторная проверка даёт новый показ по каждому hint; rerender, StrictMode, editing и remount старого feedback не увеличивают счётчик. |
| Содержание hints | Существующие «Проверь окончание/вариант/введённую форму» указывают проверяемое место. Это не грамматическое объяснение, готовая коррекция или доказательство чтения подсказки. Новые hints не добавлялись. |
| Правильные части | Прежние correct-status, галочки и блокировка подтверждённых пропусков сохранены. Отдельный количественный учёт этой информационной поддержки не реализован; `other_help_count=null`. |
| Объяснение / раскрытие решения | Отдельных кнопок hint/explanation/solution у Trainer нет. Коррекция правильным текстом после ошибки не показывается. В обычном Study внешний переворот доступен до завершения; back/context, заметки, AI question composer, аудио и другие внешние поверхности не охвачены. `answer_reveal_count=null`, `other_help_count=null`. Отсутствие наблюдения не заменяется нулём. |
| Assessment | Кнопка перевода отсутствует, после первой проверки всё заблокировано. Свежая полностью наблюдаемая история самой кнопки даёт `translation_view_count=0`; неизвестная история после resume — `null`. Это не заявление об отсутствии любой переводческой помощи. |
| Статические блоки | `::options`, `::source`, `::example` не увеличивают action counters. Они учитываются в `task_support` вместе с заданными позициями и видимыми фрагментами предложения. |

У всех новых Trainer snapshots `tracking_complete=false`: внешние источники и
вся информационная поддержка не покрыты. Нулевые счётчики не означают
самостоятельность.

## Контракт, границы и владение

Пример v2 после двух неверных пропусков, одного открытия перевода и успешной
второй проверки. Поля находятся в `evaluation_data.exercise_evidence`:

```json
{
  "support_evidence": {
    "tracking_complete": false,
    "hint_count": 2,
    "translation_view_count": 1,
    "answer_reveal_count": null,
    "other_help_count": null,
    "capture_point": "exercise_completion",
    "answer_attempt_count": 2
  },
  "task_support": {
    "answer_options_present": true,
    "source_text_present": false,
    "authored_example_present": false,
    "sentence_frame_present": true,
    "source_vocabulary_present": true
  }
}
```

В v3 те же поля лежат непосредственно в `evaluation_data`;
`capture_point=first_assessment_result`, `answer_attempt_count=1`.
У первой неверной проверки hint_count ещё 0; показанный **после** неё feedback
не меняет снимок условий этой проверки. v2 фиксируется перед feedback
завершающей проверки; hints от предыдущих проверок уже входят в него.
Перевод, открытый после завершения, меняет live history, но не frozen result.

`createExerciseEvaluationSession(initial, options)` содержит один экземпляр
прежнего support session и отдельный скопированный result snapshot. Opt-in
`trackSupport` включается только в `StudyCardTrainer`; остальные потребители
`useExerciseEvaluation` сохраняют прежнюю форму evidence.
`assessmentTrainerEvidence` переносит прежние exam correctness/counters и
копирует support; правила проверки и выставления результата не меняются.
`recordAssessmentResult` сохраняет прежнюю защиту первого результата.

Live counters хранятся в `evaluationState.supportState`, frozen snapshot —
в `evaluationState.answerSupportEvidence`. Возврат через существующий savedState
сохраняет оба. Старый savedState без support даёт unknown, старые завершённые
события не обогащаются. При полном reload незавершённого Assessment прежний
live draft не восстанавливается: существующий `supportHistoryUnknownCardId`
теперь передаётся и Trainer, поэтому потерянная история даёт `null`.
Браузерный тест saved-state reload использует sessionStorage **только в harness**;
нового production draft storage не добавлено.

Передаваемые наружу snapshots копируются; edits, feedback, поздние открытия,
повторное сохранение и mutation возвращённого объекта не меняют frozen payload.
Прежний v2 capture и атомарный v3 session/outbox commit переиспользованы.
Серверная optional support validation из первого этапа подходит без изменений.

`task_support` описывает данную опору, не наблюдаемые мыслительные операции:

- `answer_options_present`: `::options` или реальные choice gaps с choices.
- `sentence_frame_present`: parser уже задал `___GAP_n___` в maskedText, то есть
  место заполнения дано. Даже упражнение только из gaps задаёт фиксированные слоты.
- `source_vocabulary_present`: есть явный source или видимые буквенные/числовые
  фрагменты masked exercise вне gaps. Это узкий структурный факт, не оценка
  полноты лексической опоры и не анализ лексических KI.
- `source_text_present` и `authored_example_present`: явные статические блоки.

## D14: проверенные ограничения

Источник — существующий локальный
`local/test-data/lesson-qa/corrected.snapshot.json`. Учебный материал не копировался
в tracked fixtures, оригинальные карточки и mappings не редактировались.

| Source ID | Реальная механика | Статические поля | Допустимый вывод |
| --- | --- | --- | --- |
| 358365 | Choice относительного местоимения | options=true, frame=true, vocabulary=true, source=false | Наблюдается выбор варианта в заданной конструкции. |
| 358375 | Input в готовой фразе | options=false, frame=true, vocabulary=true, source=false | Наблюдается заполнение заданного слота. |
| 358385 | Input формы глагола в уже конечной позиции, source с инфинитивом | options=false, frame=true, vocabulary=true, source=true | Правильное `spricht` подтверждает совпадение формы с checker; самостоятельное размещение глагола **не наблюдается**. |

Существующее mapping карточки 358385 на word_order не переназначалось. Mastery v1
продолжает прежний расчёт; он пока не интерпретирует новые структурные поля.
Правильный raw Attempt этой карточки нельзя использовать как новое доказательство
самостоятельного владения порядком слов только из-за correctness или нулей помощи.

## Проверки и воспроизведение

- Полный `app npm test` с `LERNE_D14_SUPPORT=1`: **605 PASS**, 0 skipped.
  Включает все утилиты/сервисы, Trainer, Free Text и остальные exercise sessions.
  Лог: `local/test-data/trainer-support-node.log`.
- Новые Node checks: static scaffolding, no-help/translation/hints, повторные
  попытки, missing/partial history, saved restore, глубокая неизменность,
  первый incorrect v3, старые события, локальный D14.
- Dexie integration: v2/v3 offline → reopen → conflict; поздний duplicate A
  при переключении в B с тем же event ID оставляет B payload pending и неизменным.
  Повторное сохранение первого Assessment результата не переписывает outbox.
- Backend isolated runner: `test_knowledge_sync.py` **25 PASS**,
  `test_knowledge_mastery.py` **26 PASS**, включая новые Trainer scaffolding cases.
  Нулевые/положительные/unknown counters и заданная позиция не меняют scorer.
- Полный D14 экран + exercise-feedback: **6 PASS**. Все 48 результатов проходят
  прежний экран Assessment; для трёх целевых карточек явно проверены новые raw
  поля и первая incorrect проверка, score, skip, reload, rollback/retry.
- Финальный Trainer UI suite: **7 PASS** — перевод, per-gap feedback, повторные
  checks, frozen completion, saved-state reload, unknown после resume, первый
  incorrect Assessment и три реальные локальные D14 карточки.
  PNG и traces: `local/test-data/trainer-support-browser/`. Retry проверен при
  320/375/430/768/1280px без горизонтального overflow; вручную просмотрены retry
  320/1280 и correct D14 358365/358385 при 375px. Layout/CSS не менялись.
- Targeted ESLint и Python compilation: PASS. Vite build: PASS с прежними
  предупреждениями о размере chunks и неэффективных dynamic imports.

Запуск локального D14 Node/UI:

```powershell
$env:LERNE_D14_SUPPORT='1'
npm --prefix app test
npx --no-install playwright test --project=extended scripts/tests/browser/trainer-support.spec.cjs --output local/test-data/trainer-support-browser
```

Opt-in HTTP/PostgreSQL:

```powershell
python scripts/tests/run_knowledge_http_postgres.py --bin-dir C:/121/Lerne_projekt/tools/pgsql/bin --d14-support
```

**PASS**, PostgreSQL 17.11. Evidence:
`local/test-data/knowledge-postgres/88475337ee5d49b6b1bd2bea2268fe03/results.json`:
`status=PASS`, `critical_mocks=false`, `production_access=false`,
`cluster_stopped_and_removed=true`.

Выполнены реальные Trainer UI clicks → исходный deterministic checker →
support snapshot → Dexie/capture либо Assessment save → offline/reopen →
настоящий HTTP → SQL raw `TMAKnowledgeAttempt`. JSON сверялся целиком.
Replay дал duplicate, изменённый support — event_conflict, чужой пользователь —
rejected, raw и projection после этих запросов не изменились.
Наблюдаемый вклад двух синтетических Trainer attempts сохранил прежние значения:
positive +0.79, negative +1.21, events +2, SRS reviews без изменений;
diagnostics соответствует rebuild.

`--d14-support` создаёт отдельную колоду и копии трёх локальных карточек только
в новом disposable cluster, с synthetic KI mapping для проверки транспорта.
Production PK/primary mappings не переносятся и не калибруются. Для каждой
карточки проверены правильное заполнение UI → frozen v3 → HTTP → raw SQL,
static scaffold fields, replay и account isolation. Никакой внешний AI в этих
Trainer сценариях не подменяется и не вызывается. Прежние Free Text scenarios
в этом же стенде по-прежнему используют синтетический AI verdict.
Production startup/lifespan и migration chain не запускались; известное сообщение
initializer о missing SUPABASE_DB_URL не меняет подтверждённую SQL привязку
к новому локальному кластеру.

## Оформление диктовки и посторонние failures

В этом этапе не менялись `StudyCardFreeText.jsx`, его CSS, темы и тесты диктовки.
В текущем checkout уже есть V2 fixtures, отличающиеся от прежнего ошибочного
Legacy-only fixture. Проверены **4 PASS**: omitted/null designConfig игнорируют
retired Legacy styles, published V2 roles имеют приоритет над ними/draft,
dictation controls wrap/localize. Исправление прежнего Legacy/V2 дефекта в этот
патч не включалось, новое fallback-поведение не добавлялось.

Отдельно прежний `trainer-endings: endings stay compact...` упал на ожидании
Legacy orange вместо текущего `rgba(255,255,255,0.5)`. Та же ошибка воспроизведена
с исходным HEAD `StudyCardTrainer` через копию в
`local/test-data/trainer-support-baseline/`. Assertions не ослаблялись,
layout/colors не менялись; это не failure нового счётчика.
Первая попытка нового UI harness также была неуспешной из-за закрытия WebSocket
и рекурсивных ошибок Vite; исправлена только тестовая блокировка socket,
успешный прогон выполнен после исправления.

## Готовность к локальному пилоту

Готово для ограниченного локального сбора raw фактов choice/input и экспертного
разбора D14. В пилоте нужно отдельно смотреть scaffold поля и rubric карточки,
особенно 358385. Полнота помощи не доказана: внешние reveal/notes/audio/AI и
correct-part feedback не сведены в полные action counters. Состояния с потерянной
историей остаются unknown. Несколько вкладок, native/WebView и длительное
закрытие приложения не проверялись.

Этот этап не даёт основания для автоматического решения independent/not
independent, изменения proficiency или переноса успеха `spricht` на самостоятельный
порядок слов. Для расширения наблюдения нужны реальные callbacks от оставшихся
поверхностей и сохранение их общей истории до той же границы ответа.
