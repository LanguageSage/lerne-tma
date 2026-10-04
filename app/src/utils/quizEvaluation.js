import { createExerciseEvaluation } from './exerciseEvaluation.js';

export const quizPartId = id => `option-${id}`;

// The existing Quiz is single-choice; any starred alternative is an accepted answer.
// LiD exam/practice policies live in LidQuestionCard, outside this renderer.
export const evaluateQuizOption = (options, optionId) => {
  const option = options.find(item => item.id === optionId);
  if (!option) return null;
  return createExerciseEvaluation([{ id: quizPartId(option.id), status: option.isCorrect ? 'correct' : 'incorrect',
    errorType: 'word_choice', errorCode: 'exercise.wrong_choice', hint: 'Попробуй другой вариант.' }]);
};
