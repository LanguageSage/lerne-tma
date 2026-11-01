# Lerne Adaptive: наблюдение помощи Free Text

Дата: 01.11.2026. Ветка: `codex/adaptive-knowledge`.

Этот отчёт фиксирует первый этап Free Text. Следующий этап подключения Trainer,
его ограничения и локальный D14-пилот: [Trainer support evidence](LERNE_ADAPTIVE_TRAINER_SUPPORT_EVIDENCE.md).

Это диагностические факты показа помощи. Они не определяют самостоятельность,
не меняют проверку ответа, Mastery v1, SRS, KI/mappings или `target_relevance`.
Другие упражнения, включая `editable_text`, Game Mode и диалоги не подключены.
Production migrations и деплой не выполняются; новые данные используют
существующий JSON `TMAKnowledgeAttempt.evaluation_data`, без изменения схемы БД.

## Проверенные источники

| Источник / обработчик | Фактическое поведение и наблюдение |
| --- | --- |
| Отдельная кнопка подсказки | В Free Text отсутствует. Новая кнопка не добавлена. |
| `StudyCardFreeText`: feedback после `needs_retry` / `incorrect` | Показ непустого `hint` и/или `explanation` считается одним `hint_count`. Только после commit UI, один раз на classified attempt; rerender, StrictMode, восстановление прежнего feedback не добавляют показ. Это факт предоставления информации, а не доказательство, что ученик прочитал её. |
| Общий текст «попробуйте ещё раз» | Не считается содержательной подсказкой. `unavailable`, ошибка сети и простой факт неправильного ответа не создают помощи. |
| `StudyCardFreeText`: «Показать пример ответа» | Реальный переход hidden → shown увеличивает live `answer_reveal_count`; скрытие не увеличивает, повторное открытие увеличивает. Кнопка доступна только после исчерпания попыток, поэтому это действие уже **после** фиксации результата; frozen evidence остаётся прежним. |
| `StudyCard.onFlip`, кнопка, клавиатура, свайп | Для Free Text переворот заблокирован до accepted/exhausted и во время загрузки. Обратная сторона содержит ответ/context, заметки, AI question composer и аудио. Эти поверхности не подключены к новому владельцу. |
| Перевод | В Free Text нет отдельного открытия перевода перед ответом. Содержимое обратной стороны не классифицируется автоматически как перевод: `back` у `@free` является примером ответа. `translation_view_count=null`; fictitious translate/reveal clicks не создаются. |
| Прочая помощь | Внешние поверхности, аудио/медиа, личные заметки, admin diagnostics, вопрос ИИ на обратной стороне, произвольный текст Markdown не охвачены целиком. `other_help_count=null`, `tracking_complete=false`. Диктовка и редактирование ввода не объявляются помощью решению. |
| `ExerciseInfoBlocks` | `::options`, `::source`, `::example` показываются статически, без раскрытия. Не увеличивают счётчики действий. |

`hint_count` и `answer_reveal_count` описывают подключённые источники Free Text,
а не гарантированный суммарный объём любой помощи во всём приложении.
Пока покрытие неполное, новый Free Text всегда выдаёт `tracking_complete=false`.
Нулевые счётчики не означают самостоятельный ответ.

## Контракт и момент фиксации

Пример фактического v2 evidence после одной информативной подсказки между двумя
попытками (поля находятся внутри `evaluation_data.exercise_evidence`):

```json
{
  "support_evidence": {
    "tracking_complete": false,
    "hint_count": 1,
    "translation_view_count": null,
    "answer_reveal_count": 0,
    "other_help_count": null,
    "capture_point": "exercise_completion",
    "answer_attempt_count": 2
  },
  "task_support": {
    "answer_options_present": false,
    "source_text_present": false,
    "authored_example_present": false,
    "sentence_frame_present": null,
    "source_vocabulary_present": null
  }
}
```

- Number — число зарегистрированных показов/открытий подключённого источника.
  `null` — неизвестная история/нет наблюдения; пропущенное поле старого события
  также остаётся отсутствующим. Missing не дополняется нулями.
- `capture_point=exercise_completion`: v2 фиксирует снимок для завершающей
  проверки (accepted или exhausted), использует существующий capture после grade.
  `completed=false` у exhausted сохраняет прежнюю семантику.
- `capture_point=first_assessment_result`: v3 фиксирует первый classified
  результат, включая неправильный; `answer_attempt_count=1`. `unavailable` не
  расходует попытку, skipped не получает support/target диагностику.
- Счётчики снимаются **при отправке проверяемого ответа, до его feedback**;
  итоговая граница выбирается после classified результата. Подсказка из feedback
  первой ошибки относится к следующему ответу, а не задним числом к первой ошибке.
- Для v3 `support_evidence`/`task_support` находятся непосредственно в
  `evaluation_data`. Сначала копируется результат, затем session + outbox
  записываются прежней транзакцией. Stable event ID и формат v1/v2/v3 сохранены.
- `task_support` отделён от действий. По явным блокам сохраняются варианты,
  source и статические примеры. Наличие каркаса предложения и исходной лексики
  в произвольном тексте надёжно не размечено: оба значения `null`.
  Отсутствие `::source` не доказывает отсутствие лексической опоры в prompt.

## Владение и восстановление

`utils/supportEvidence.js` владеет счётчиками и созданием снимков;
`createFreeTextEvaluationSession` владеет одним экземпляром на reviewKey.
`useFreeTextEvaluation` передаёт реальные UI-события этому экземпляру.
Отдельных счётчиков в компоненте или Assessment нет. UI ref лишь предотвращает
повторный учёт того же уже показанного feedback.

Live состояние входит в существующий `evaluationState.supportState` и
восстанавливается вместе с savedState при возвращении к карточке. Снимок
результата копируется отдельно; последующие открытия примера, изменение live
счётчиков, mutation возвращённого объекта и повторная сериализация его не меняют.
v2 capture копирует support **до первого await**, сохраняя исходную Dexie-базу.

Полный reload незавершённого Assessment не восстанавливает прежний текст/feedback:
этот экран и раньше не сохранял live draft в Dexie. При возобновлении сохранённой
сессии `useStudyNavigation` помечает текущую карточку
`supportHistoryUnknownCardId`, и Free Text начинает её учёт с `null`, а не с
нуля. Следующая ещё не открывавшаяся карточка начинает новое наблюдение.
Старый savedState без support также даёт unknown. Старые завершённые результаты
и outbox не дополняются новыми полями.

Сервер проверяет только новые optional поля: bool полноты, неотрицательные
целые/null, допустимую границу, номер попытки, bool/null статической опоры.
Уже сохранённый payload сравнивается раньше новой валидации: идентичный replay
остаётся duplicate, изменённый support даёт event_conflict. История сохраняется
как raw клиентское заявление, а не серверно доказанная самостоятельность.

## Проверки

- Node: `supportEvidence`, `freeTextEvaluationState`, `assessmentEvidence`,
  `assessment`, `knowledgeCaptureService`, `knowledgeFlow`: **62 PASS**.
  Новые fixtures синтетические. Существующий `assessment.test.js` дополнительно
  использует локальные lesson-qa snapshots; его 8 проверок не автономны без них.
- Backend isolated runner: `test_knowledge_sync.py` **25 PASS**;
  `test_knowledge_mastery.py` **25 PASS**. Проверены raw JSON v2/v3, unknown,
  invalid counts/completeness, duplicate/conflict, другой аккаунт и неизменность
  вклада Mastery при различных счётчиках и статических опорах.
- Chromium: реальные feedback/retry/example/Assessment/restore действия,
  прежние dictation и unavailable сценарии. Финальный целевой прогон — **10 PASS**.
  Более широкий предшествующий прогон — 24 PASS / 1 FAIL: существующий
  `dictation controls wrap...` передаёт `styles` Legacy, тогда как компонент
  использует `designConfig` V2. Ожидает цвет `rgb(254,215,170)`, получает
  `rgb(253,224,71)`. Та же ошибка отдельно воспроизведена на исходном
  HEAD-компоненте в `local/test-data/support-baseline/`; assertions не ослаблялись,
  оформление и этот посторонний дефект не менялись.
  Сняты retry PNG при 320/375/430/768/1280px, проверено отсутствие горизонтального
  overflow. Вручную просмотрены RU retry 375/1280 и EN accepted_minor 375;
  JSX/CSS-разметка и внешний вид контролов патчем не изменены.
- Targeted ESLint и Python compilation: PASS. Vite build: PASS с предупреждениями
  о размере chunks и неэффективных dynamic imports; эти настройки не менялись.
- Настоящий HTTP/Chromium/PostgreSQL 17.11: **PASS**.
  `local/test-data/knowledge-postgres/db34123a30d74d569e9890b11032932a/results.json`
  содержит `status=PASS`, `critical_mocks=false`, `production_access=false`,
  `cluster_stopped_and_removed=true`.
  Проверены реальные UI-клики Free Text → snapshot → capture → IndexedDB →
  HTTP sync → прямой SQL raw Attempt, точное равенство сохранённого JSON,
  null/counters, duplicate и изменение support с тем же ID → event_conflict.
  v3 проверен через реальную evaluation session → Assessment conversion/save →
  offline → закрытие/открытие Dexie → HTTP → SQL; последующий результат не
  заменяет первый. Сами AI verdict синтетические: только `/ai/evaluate-answer`
  замещён в UI-сценарии, платный/внешний AI не вызывается.
  Проверка single-submit компонента Assessment выполнялась отдельно в Chromium;
  полный экран AssessmentView → SQL одним кликом не заявляется.
  Прежние проверки стенда — настоящая смена аккаунта с поздним HTTP-ответом,
  remap/unmap, происхождение/permissions и восемь concurrent requests — также PASS.
  Схема создана из моделей в новом кластере, production lifespan/migrations не
  запускались. Известное сообщение initializer `SUPABASE_DB_URL is not set` не
  меняет привязку Peewee к одноразовому PostgreSQL; это подтверждено SQL-чтением.

Не заявляются проверка внешнего AI, production startup/migrations, Android,
Telegram WebView, несколько вкладок или реальное чтение учеником показанной помощи.

## Подключение других упражнений

Для каждого типа сначала инвентаризировать реальные поверхности и авторскую
статическую опору. Создать один `createSupportSession` у существующего владельца
exercise lifecycle, подключить фактические открытия/показы и определить границу
результата до feedback. Сохранять savedState, unknown prefix и frozen snapshot
через существующий outbox; покрыть retry, reload, смену аккаунта и replay.
Подключение переводов/прочей помощи требует явных callback из соответствующего
контрола, а не предположения по наличию текста или нулевым счётчикам.
`tracking_complete=true` допустимо только после проверки полноты всех источников
в выбранном окне. Новый алгоритм самостоятельности/proficiency для этого не нужен.
