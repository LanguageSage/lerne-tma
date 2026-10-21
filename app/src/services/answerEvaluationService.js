import api from './api.js';
import { getUserId } from '../utils/auth.js';
import { getInterfaceLanguage } from '../i18n/locale.js';
import { isValidAnswerEvaluationResult } from '../utils/freeTextEvaluationState.js';

const pending = new Map();

export async function evaluateFreeTextAnswer(cardId, answer, { diagnostics = false } = {}) {
  const language = getInterfaceLanguage();
  const key = JSON.stringify([getUserId(), cardId, answer, language, diagnostics]);
  if (pending.has(key)) return pending.get(key);
  const request = api.post('/ai/evaluate-answer', {
    card_id: cardId, answer, feedback_language: language,
    ...(diagnostics ? { diagnostics: true } : {}),
  }, { timeout: 65000 }).then(({ data }) => {
    if (!isValidAnswerEvaluationResult(data?.result)) {
      throw new Error('Invalid answer evaluation response');
    }
    return data;
  }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
