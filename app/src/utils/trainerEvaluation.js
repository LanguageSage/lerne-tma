import { normalizeAnswer } from './clozeParser.js';
import { createExerciseEvaluation } from './exerciseEvaluation.js';

export const evaluateTrainerGaps = (gaps = [], values = {}) => createExerciseEvaluation(
  gaps.map(gap => {
    const correct = (gap.correctAnswer || '').split('|').map(normalizeAnswer)
      .includes(normalizeAnswer(values[gap.id] || ''));
    const choice = gap.mode === 'choice';
    return {
      id: gap.id, status: correct ? 'correct' : 'incorrect',
      errorType: gap.isAffix ? 'other' : choice ? 'word_choice' : 'other',
      errorCode: gap.isAffix ? 'exercise.affix_mismatch'
        : choice ? 'exercise.wrong_choice' : 'exercise.input_mismatch',
      hint: gap.isAffix ? 'Проверь окончание.'
        : choice ? 'Проверь этот вариант.' : 'Проверь введённую форму в этом месте.',
    };
  })
);
