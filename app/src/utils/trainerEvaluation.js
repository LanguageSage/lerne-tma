import { normalizeAnswer } from './text.js';
import { createExerciseEvaluation } from './exerciseEvaluation.js';

export const evaluateTrainerGaps = (gaps = [], values = {}) => createExerciseEvaluation(
  gaps.map(gap => {
    const choice = gap.mode === 'choice';
    const value = values[gap.id] || '';
    const answers = gap.answers ?? (gap.correctAnswer || '').split('|');
    const correct = gap.answers && choice ? answers.includes(value)
      : answers.map(normalizeAnswer).includes(normalizeAnswer(value));
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
