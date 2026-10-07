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
- Next/Back может показывать кэш сразу; grade и forced selection ожидают серверный результат. TTS создаётся по запросу клиента.

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
- Autoplay/latency: `scripts/tests/autoplay_sequence.mjs`, `scripts/tests/browser/autoplay-ui.spec.cjs`, `scripts/tests/test_study_latency.py`.

## Related docs

- [SRS_SYSTEM](../../project_docs/ARCHITECTURE/SRS_SYSTEM.md), [Cards](cards.md), [Sync](sync.md), [Media](media.md), [Knowledge](knowledge.md).
- Детали feedback: [KI-08.1](../../docs/KI-08.1.md), [KI-08.2](../../docs/KI-08.2.md), [KI-08.3](../../docs/KI-08.3.md).

## Required actions foundation

- Review flow: `app/src/utils/studySteps.js`, `app/src/hooks/useStudyStepFlow.js`; владелец — `StudyView`, отдельно от exercise feedback и session navigation.
- Роли: `app/src/utils/studyCardRoles.js`. Physical side неизменна; reverse меняет bindings ролей.
- Speech API: `app/src/utils/speechEvaluation.js`, `StudyCardSpeech` (`targetText`, `reviewKey`, `onSuccess`).
- [Completion API и будущие pronunciation/dialogue renderers](../../project_docs/ARCHITECTURE/STUDY_STEPS.md).
- Unit tests: `app/src/utils/__tests__/studySteps.test.js`, `studyCardRoles.test.js`, `speechEvaluation.test.js`; browser: `scripts/tests/browser/study-steps.spec.cjs`.
