# Study: обучение, SRS и упражнения

## Scope

Учебная сессия, Next/Back, completion, forced review, SRS, autoplay и проверка упражнений.
Исходный синтаксис — [cards](cards.md); free-text verdict — [ai](ai.md); запись Attempts — [knowledge](knowledge.md).

## Primary entry points

| Задача | Файлы от корня репозитория |
| --- | --- |
| Сессия и переходы | `app/src/components/study/StudyView.jsx`, `app/src/hooks/useStudySession.js`, `app/src/hooks/useStudyNavigation.js`, `app/src/store/useSessionStore.js` |
| Завершение / ошибка / возврат | `app/src/components/study/StudyFinished.jsx`, `app/src/components/study/StudyError.jsx`, `app/src/utils/studyFlow.js`, `app/src/utils/navigation.js` |
| Карточка и упражнения | `app/src/components/study/StudyCard.jsx`, `app/src/components/study/ExerciseRenderer.jsx`, `app/src/components/study/StudyCardWordBank.jsx`, `app/src/components/study/StudyCardTrainer.jsx`, `app/src/components/study/StudyCardMatch.jsx`, `app/src/components/study/StudyCardQuiz.jsx`, `app/src/components/study/StudyCardPuzzle.jsx` |
| Feedback session | `app/src/utils/exerciseEvaluation.js`, `app/src/hooks/useExerciseEvaluation.js`; adapters: `app/src/utils/trainerEvaluation.js`, `app/src/utils/matchEvaluation.js`, `app/src/utils/quizEvaluation.js`, `app/src/utils/puzzleEvaluation.js`, `app/src/utils/wordBankState.js` |
| SRS и выбор карточки | `api/routers/study.py`, `api/services/study.py`, `api/services/cards.py`, `api/srs.py`, `app/src/utils/srsEngine.js` |
| Autoplay / controls | `app/src/hooks/useAutoplay.js`, `app/src/utils/autoplaySequence.js`, `app/src/components/study/StudyControlsBlock.jsx`, `app/src/components/study/GradeButtons.jsx`, `app/src/store/useSettingsStore.js` |
| LiD exam/practice | `app/src/components/lid/LidExamView.jsx`, `app/src/components/lid/LidQuestionCard.jsx`, `app/src/store/useLidStore.js`, `api/routers/lid.py` |

## Data flow

1. `useStudyNavigation` запускает сессию; `useStudySession` получает карточки и держит историю в session store.
2. StudyCard → ExerciseRenderer → тип упражнения → feedback session/adapters; сохранение состояния привязано к `reviewKey`.
3. Exercise completion передаёт evidence через `onTrainerAnswer`; `StudyView` завершает шаг answer. Явная цепочка required actions завершается после всех шагов; default сохраняет ручную оценку. Grade сохраняется через `/study/grade` и запускает Knowledge capture.
4. Online SRS: study router → `update_card_progress` → `api/srs.py` → `TMAProgress` / `TMAReviewHistory`.
5. Offline SRS: `offlineApi.js` → `srsEngine.js` → Dexie progress + review event; доставка — [sync](sync.md).
6. StudyFinished предлагает следующий шаг; StudyError представляет отдельный исход ошибки.

## Source of truth

- Состояние сессии — `useSessionStore.js`; сохранённый SRS-прогресс — `TMAProgress`, история — `TMAReviewHistory` в `api/models.py`.
- Online/offline движки должны согласовывать `review_context` и интервалы; параметры находятся в [SRS_SYSTEM](../../project_docs/ARCHITECTURE/SRS_SYSTEM.md).
- Forced review использует порядок `position/id`, exclusions и один проход `forcedSeenIds`, независимо от scheduled queue.
- Offline grade атомарно сохраняет progress и review event; sync переносит итог, не применяя SRS повторно.
- Feedback v1 хранит part IDs и безопасные статусы/подсказки; counters и error history накапливаются до completion.
- `clearCurrentFeedback` очищает текущий feedback до completion, сохраняя учебную историю.
- Puzzle проверяет authored token IDs и направленные соседства; правильная boundary не блокирует перемещение отдельного token.
- Счётчики Match/Quiz/Puzzle имеют разные учебные policies; `interaction_count` не заменяет `attempt_count` для mastery.
- Next/Back и grade показывают локальную карточку сразу (forward history, затем сосед в списке для scheduled). Grade с `return_next: false` только сохраняет SRS; старые клиенты без этого поля по-прежнему получают серверный выбор. Без локального кандидата, включая forced selection, grade ожидает предыдущие pending writes и серверный выбор. TTS создаётся по запросу клиента.
- Pending grades и неподтверждённые ошибки принадлежат session store и переживают reset в памяти, без новой persistent queue. Блокировка привязана к user/card; stale handlers и mouse double-click не оценивают новую карточку. Ошибка остаётся видимой до подтверждения пользователем; автоматического повторения POST нет (сетевой сбой может означать потерю подтверждения уже сохранённой оценки).
- Background refresh используется также при `startStudyCard`: он обновляет только совпадающую карточку/history/cache, сохраняет новые audio fields и отбрасывает ответы после grade, reset, смены deck/view. Grade response после локального перехода не управляет навигацией; fallback response дополнительно инвалидируется при Next/Back.

## Card commands and grade acknowledgement

- `useStudyCardControls.js` is mounted once by `StudyCard`, outside the exercise renderers. Single clicks/taps do not flip. Space toggles the physical side; Left/Right reuse the same navigation callbacks and Previous boundary as `StudyNavigation`. Up/down strokes reveal/return; left/right strokes navigate next/previous. Mouse strokes require the left button; touch uses non-passive native move listeners only for eligible strokes, without globally disabling native touch scrolling.
- Strokes begin on unused card space. Text, controls, editable fields, interactive exercise containers, nested scroll areas and the image resize handle are excluded. Selection, scroll, wheel, dragstart, context menu, multi-touch, touchcancel, blur, review/side/mode changes and overlays cancel or suppress commands. A stroke needs 64px, a dominant axis (1.5:1), and 60–700ms; diagonal, short and held gestures do nothing. Keyboard commands ignore focused controls, selection, modifiers, repeats and IME. Existing Free Text reveal restrictions and autoplay ownership remain in force.
- `useStudySession` emits an ephemeral `gradeConfirmation` only after a successful existing API/offline persistence response with the expected contract, while the user/session/deck/view request scope is current. `GradeConfirmation` shows the graded card number and checkmark for 1.6s; remounting cannot replay an expired confirmation. Errors and pending requests never emit success. Existing user/card locks remain; `GradeButtons` also guards double taps/clicks for 350ms across immediate card transitions and ignores held Enter/Space repeats.
- `audioSynth.js` prepares a reusable audio context during the grading gesture and plays a quiet 170ms tone after acknowledgement. Unsupported/blocked audio has no effect on saving or visual feedback. `gradeSoundEnabled` (default on) lives in `useSettingsStore`, local storage and the existing user-settings sync, with a switch in General settings. It controls this grade tone independently of exercise answer sounds. No SRS, review/progress storage, Knowledge scoring or sync algorithms change.
- Regression: `scripts/tests/browser/study-controls.spec.cjs` (desktop mouse/keyboard and Pixel 7 Chromium native touch emulation, card types, input/selection, gesture guards, acknowledgement races/errors, mute and settings sync). Physical Android/Capacitor/Telegram WebView and subjective speaker volume still require a device check; emulation is not that check.

## Card footer and information

### Editable Text (`@edit`)

`exerciseContentParser` selects the standalone `@edit` block up to the next
structural marker; `detectExerciseType` selects `editable_text` from content,
then `ExerciseRenderer` passes `parseEditableTextData` to `StudyCardFreeText`.
The marker is omitted from the input. The field starts with the full source,
shows a pencil, focus frame, modified status and reset action. Reset restores
only the draft; it never erases evaluation attempts. `StudyCard.exerciseStates`
keeps drafts by review key across card navigation. The existing evaluation
service receives the current full input; the server owns BACK and grading policy.
The interactive surface excludes clicks, keyboard input and gestures from flips.

Regression fixtures: `scripts/tests/browser/fixtures/editable-real-cards.json`
is a read-only snapshot of all 65 active editable cards on 2026-10-23, including
359618 in deck 7164 (B1-16-D05). `editable-corpus.spec.cjs` checks every card
through StudyCard and draft navigation; `editable-text.spec.cjs` checks the
real 359618 text with an isolated evaluation endpoint at 320/375/430/768/1280px.
`free-text-dictation.spec.cjs` covers the shared component's `@free` path.

Release diagnosis on 2026-10-23: public `tma-amber.vercel.app` served
`/assets/index-B4xZgltD.js`; its detector included `@free` followed by `@puzzle`,
with neither `@edit` nor `editable_text` in the loaded bundle/parser. Database
359618 already had valid `::exercise\n@edit` and `card_type=editable_text`.
HEAD ac344a5 had the new renderer but missing commas between the merged Editable
Text and publication translations in both EN/UK JSON files, preventing a build.
Those syntax errors are fixed. Deployment must publish the current source;
changing stored card types or rewriting valid FRONT text does not fix an old UI.

`MarkdownRenderer` (`components/common/`) отображает только сохранённые `back`/`context`: ответ и контекст StudyCard, перевод Puzzle/Trainer, пример Free Text (back либо context) и ответ/контекст TrainerView. В reverse Markdown следует за физическим `back`; физический `front` сохраняет прежнее отображение. Перевод Trainer выводится целым блоком под заданием, чтобы сохранять таблицы, списки и абзацы; разбор и оценка упражнений не меняются. Стили наследуются от существующих контейнеров, прокрутка таблиц ограничена самим полем (включая flex-контейнер перевода Puzzle). Проверки: `scripts/tests/browser/card-markdown.spec.cjs` и существующие feedback suites.

`StudyCard.jsx` renders one non-floating footer after either card side: a static CEFR badge, the existing exercise/flip controls and an accessible ⓘ disclosure. `StudyCardInfo.jsx` renders author, language, deck, CEFR explanation, source and available dates in the page flow. Coauthors remain an explicit UI placeholder pending a card-level attribution contract; do not derive them from deck collaborators. Missing dates/source/author display no-data text. Follow-up API/sync/attribution work is tracked in `project_docs/FUTURE_PLANS.md`. Geometry, disclosure, locales and exercise controls: `scripts/tests/browser/study-card-info.spec.cjs`.

## Common symptoms

| Симптом | Первый участок проверки |
| --- | --- |
| Интервалы расходятся online/offline | Оба SRS-движка, `review_context`, settings и timestamps |
| «Учить ещё» повторяет карточки или неверно возвращает в тему | StudyFinished → studyFlow → forcedSeenIds/exclude_ids |
| После ошибки показана оценка или evidence записан дважды | Exercise completion → onTrainerAnswer → useStudySession |
| После flip/remount теряются ошибки | `exerciseStates[reviewKey]`, savedState и evaluation hook |
| Неправильная проверка Puzzle/Match/Quiz | Adapter evaluator и policy конкретного renderer |
| LiD раскрывает ответ не в том режиме | LidQuestionCard / LidExamView; отдельный поток от ExerciseRenderer |
| Autoplay или сворачивание блоков работает неверно | useAutoplay / autoplaySequence / settings / StudyControlsBlock |

## Search anchors

```sh
rg -n 'review_context|forced|exclude_ids' api/routers/study.py api/services/cards.py app/src/hooks/useStudySession.js
rg -n 'reviewKey|exerciseStates|onTrainerAnswer' app/src/components/study/StudyCard.jsx app/src/components/study/ExerciseRenderer.jsx
rg -n 'clearCurrentFeedback|requiredPartIds|interaction_count' app/src/utils/exerciseEvaluation.js app/src/hooks/useExerciseEvaluation.js
```

## Relevant tests

- SRS/navigation: `app/src/utils/__tests__/srsEngine.test.js`, `app/src/utils/__tests__/studyFlow.test.js`, `scripts/tests/test_forced_study.py`.
- Completion/offline: `scripts/tests/browser/study-finished.spec.cjs`, `scripts/tests/browser/offline.spec.cjs`.
- Feedback: `app/src/utils/__tests__/exerciseEvaluation.test.js`, `app/src/utils/__tests__/puzzleEvaluation.test.js`, `app/src/utils/__tests__/matchQuizEvaluation.test.js`, `app/src/utils/__tests__/trainerEndings.test.js`.
- Browser feedback: `scripts/tests/browser/exercise-feedback.spec.cjs`, `scripts/tests/browser/match-quiz-feedback.spec.cjs`, `scripts/tests/browser/puzzle-feedback.spec.cjs`.
- Autoplay/latency: `scripts/tests/autoplay_sequence.mjs`, `scripts/tests/browser/autoplay-ui.spec.cjs`, `scripts/tests/browser/study-latency.spec.cjs` (instant grade, races, failures, audio, responsive), `scripts/tests/test_study_latency.py` (save-only contract, rollback, permissions).

## Related docs

- [SRS_SYSTEM](../../project_docs/ARCHITECTURE/SRS_SYSTEM.md), [Cards](cards.md), [Sync](sync.md), [Media](media.md), [Knowledge](knowledge.md).
- Детали feedback: [KI-08.1](../../docs/KI-08.1.md), [KI-08.2](../../docs/KI-08.2.md), [KI-08.3](../../docs/KI-08.3.md).

## Required actions foundation

- Review flow: `app/src/utils/studySteps.js`, `app/src/hooks/useStudyStepFlow.js`; владелец — `StudyView`, отдельно от exercise feedback и session navigation.
- Роли: `app/src/utils/studyCardRoles.js`. Physical side неизменна; reverse меняет bindings ролей.
- Speech API: `app/src/utils/speechEvaluation.js`, `StudyCardSpeech` (`targetText`, `reviewKey`, `onSuccess`).
- [Completion API и будущие pronunciation/dialogue renderers](../../project_docs/ARCHITECTURE/STUDY_STEPS.md).
- Unit tests: `app/src/utils/__tests__/studySteps.test.js`, `studyCardRoles.test.js`, `speechEvaluation.test.js`; browser: `scripts/tests/browser/study-steps.spec.cjs`.


## Speech follow-up MVP (opt-in)

- `speechFollowupEnabled` is saved through `useSettingsStore` locally and via user-settings sync; default off.
- StudyView snapshots the toggle per review and enables `['answer', 'speak']` only without explicit requiredActions or autoplay and with a short deterministic target from `speechFollowup.js`.
- Supported authored exercises: single-line `@puzzle`, trainer (`[[...]]`/`{...}`) with one unambiguous answer per gap, and single-line `@wordbank` with a valid answer map. Quiz/free-text/match, synthetic puzzles, ambiguous and multiline targets keep the existing flow.
- `StudyCardSpeech` starts recognition on entering the follow-up; retries use the microphone button. It reuses the word-overlap checker, not a phonetic/accent score. Success completes the speak step; skip completes it with `{skipped:true}` and does not alter exercise evidence/SRS penalties.
- Unsupported browsers, denied access and microphone startup failure show an error and permit skip. Retired recognition handlers are removed on retry, skip and navigation.
- The toggle appears under the mode selector and applies from the next review; autoplay suspends it. Existing explicit flows take precedence; legacy speak mode still starts manually.
- Unit tests: `speechFollowup.test.js`, `studySteps.test.js`, `speechEvaluation.test.js`. Browser tests: `scripts/tests/browser/speech-followup.spec.cjs` (mocked recognition/API, answer-to-speech, retry, skip, navigation, persistence/server settings, autoplay, locales and responsive appearance).

## Free Text: диктовка ответа

Editable Text (`@edit`) предзаполняет поле ошибочным текстом. BACK — полное исправление, `::source` — перевод при необходимости, CONTEXT — объяснение на обороте. Проверка через `evaluate-answer` с `controlled_text` и отключённым зачётом опечаток по умолчанию; `useFreeTextEvaluation` сохраняет попытки и ошибки, а `exerciseStates[reviewKey]` — черновик внутри сессии.

- `useSpeechRecognition` сохраняет прежние defaults для `StudyCardSpeech`: silenceTimeoutMs=1500, autoRestart=false. Free Text передаёт silenceTimeoutMs=null и autoRestart=true; Game Mode не менялся.
- Free Text: «Диктовать» → «Пауза» + «Отправить» → «Продолжить» + «Отправить». Ручной ввод остаётся доступен и отменяет запись/ожидающую отправку, сохраняя исправленный текст. Повторная диктовка после ручной правки дописывается к текущему черновику; лимит 4000 символов.
- Пауза и отправка вызывают `recognition.stop()`, ждут финальные results и onend; 2s fallback сохраняет видимый текст, если движок не завершает сеанс. Отправка заблокирована ref-защёлкой на время flush и существующим evaluation session на время API. Навигация, язык и unmount отменяют запись, таймеры и pending flush; старые события игнорируются.
- При неожиданном browser onend и no-speech хук сохраняет transcript, с задержкой запускает новый сеанс. Results обрабатываются как снимки сеанса, перекрытие двух и более слов на границе удаляется. Не более 5 пустых завершений подряд или 30 восстановлений за одну ручную запись; затем нужна кнопка «Продолжить». Permission/audio-capture/network errors автоматически не перезапускаются.
- Completion, assessment, учебные счётчики, сохранение черновика и SRS остаются у существующих владельцев; технический отказ ИИ не создаёт учебную попытку. Admin-only диагностика запроса отделена от savedState; детали — [AI](ai.md).
- Browser suites: `free-text-dictation.spec.cjs`, `free-text-evaluation.spec.cjs`, `speech-followup.spec.cjs`. Проверки с mock recognition/API покрывают длинную паузу, pause/resume, финальный result, дубли, browser end, предел перезапуска, permissions, navigation, assessment, RU/EN/UK, 320/375/430/768/1280px, обычный и webkit-prefixed API.
- Реальный микрофон/Android/iOS/Telegram WebView и доступ к speech service проверяются вручную. Эмуляция Pixel/iPhone и WebKit не доказывает работу распознавания на физическом устройстве; [протокол проверки](../../docs/FREE_TEXT_RELIABILITY.md).

## Проверенный контракт экзамена и Lesson QA

`pedagogy.assessment` версии 1 включает отдельный AssessmentView через useStudyNavigation и useSessionStore.assessment. Без конфигурации действует Classic. Trainer/Free фиксируют первую проверку, пропуски дают 0, required/bonus считаются отдельно, рекомендации используют authored competency_ids и deck_ids. Сессия и objective Knowledge outbox сохраняются атомарно в существующем Dexie; SRS-оценки и review history не создаются. Resume требует неизменённых заданий/контекста/metadata. Владельцы, API и ограничения — [ASSESSMENT](../../docs/ASSESSMENT.md), тесты assessment.test.js и browser/assessment.spec.cjs. Предыдущий lesson-qa.spec.cjs сохраняет baseline контракта исходного D14 без новой конфигурации.

Session completion accuracy uses actual reviewsCount/correctCount/mistakeCount only. Navigation studyHistory is not correctness evidence; when reviewsCount=0, calculateSessionStats returns null and LessonCompletion shows the no-statistics state. Regression: lessonQa.test.js and the isolated skip-all-D14 browser scenario.


## Единая проверка регрессий (этап 1.1)

Из корня: `npm run check`. Команды, перечень изолированных suites, CI gate,
матрица покрытия и ограничения: [TESTING](../../docs/TESTING.md).
Отдельный backend suite запускайте через `scripts/test_backend.py`, чтобы
сохранить блокировку production-сервисов и загрузки `.env`.
