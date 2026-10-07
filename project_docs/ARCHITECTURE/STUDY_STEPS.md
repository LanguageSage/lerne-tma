# Study Steps: внутренний foundation

Study Step — обязательное действие внутри review. Тип упражнения по-прежнему
определяет `detectExerciseType`/`ExerciseRenderer`; аудио и цепочка действий
живут отдельно. DB, import syntax, SRS и Knowledge contracts не меняются.

## Flow и completion

- `app/src/utils/studySteps.js`: pure нормализация, completion, reset.
- `app/src/hooks/useStudyStepFlow.js`: локальное состояние review в `StudyView`.
- Default — `['answer']`; finish — терминальное состояние, не отдельное действие.
- Внутренняя конфигурация: prop `StudyView.requiredActions` или временное
  `card.requiredActions`. Это не сохраняемое поле схемы и не команда импорта.
- API: `currentStep`, `isFinished`, `blockedAction`, `completedSteps`,
  `completeStep(evidence)`. Вызывать completion только после успешного действия.
- Callback захватывает review key и ID шага: повторный или устаревший вызов
  не завершит следующий шаг/новый review. Ключ содержит session revision,
  card ID, history index, режим и конфигурацию. Их смена сбрасывает flow
  синхронно; flip сохраняет его. Восстановления flow по history пока нет.
- Неизвестный action блокируется, некорректная/пустая конфигурация даёт TypeError.

Прежний `onTrainerAnswer` сохраняет evidence для grade/capture и завершает
только answer при `isCorrect === true` (или legacy true). Исчерпанные попытки
free-text с `isCorrect: false` не завершают успешный шаг. Явная цепочка разрешает
grade/exercise-next после всех шагов. Default сохраняет ручную оценку как
self-assessment. Ручные Next/Back остаются навигацией. Autoplay имеет отдельную
очередь и не подтверждает Study Steps. Session store остаётся владельцем навигации.

## Стороны, роли и аудио

`app/src/utils/studyCardRoles.js` разделяет physicalSide (`front|back`),
pedagogicalRole (цель контента) и audioRole (цель записи).
В classic prompt → front, answer → back; reverse меняет bindings местами,
но не значения физических сторон. Translation → back — только legacy mapping.
Example/dialogue не получают автоматически front audio.

`resolveStudyAudio(card, role, {studyMode, roleBindings})` возвращает
`{audioRole, physicalSide, source}`. Bindings допускают legacy `{physicalSide}`
и независимый `{url, path}`, например `dialogue: {url: recordingUrl}`.
URL/path fallback сохранён; source пропускается через `getAudioUrl`.
Будущий listen renderer подтверждает шаг только после успешного окончания:
`playAudio(url, ended => { if (ended) completeStep(); })`, не при остановке/ошибке.

## Pronunciation после answer

Задать `requiredActions: ['answer', 'speak']` и передать в StudyView
`renderRequiredAction({card, stepFlow, audioControls, styles})`.
Render prop заменяет область упражнения на front для следующих действий:

```jsx
<StudyCardSpeech
  key={`${stepFlow.reviewKey}:${stepFlow.currentStep.id}`}
  reviewKey={stepFlow.reviewKey}
  card={card} targetText={correctPhrase} styles={styles}
  stopAudio={audioControls.stopAudio}
  onSuccess={stepFlow.completeStep} onFlip={showAnswer}
/>
```

Correct phrase выбирает адаптер: quiz front содержит вопрос/варианты и не является
автоматически целью произношения. `speechEvaluation.js` сохраняет прежний
word-overlap evaluator. Speech сообщает success один раз. Renderer speech-after-answer
не включён в продукт; unsupported/permission/retry UI прежнего speech сохранён.

## Dialogue/listening

Descriptors с уникальными ID и контекстом дают цепочки повторных question/answer:
`[{id:'audio', action:'listen', audioRole:'dialogue'},
{id:'q1', action:'question', questionId:1},
{id:'a1', action:'answer', questionId:1}, {id:'f1', action:'feedback'}, ...]`.
Их UI/обработчики добавляются через тот же renderer. Для нового action явно
расширить STUDY_ACTION, renderer и тесты. Хранение authored flows и агрегация
dialogue evidence для SRS/Knowledge — будущая работа.

Тесты: `app/src/utils/__tests__/studySteps.test.js`, `studyCardRoles.test.js`,
`speechEvaluation.test.js`; browser: `scripts/tests/browser/study-steps.spec.cjs`.
