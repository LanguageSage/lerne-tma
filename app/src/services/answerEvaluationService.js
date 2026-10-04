import api from './api.js';
import { getUserId } from '../utils/auth.js';
import { getInterfaceLanguage } from '../i18n/locale.js';

const pending = new Map();

export async function evaluateFreeTextAnswer(cardId, answer) {
  const language = getInterfaceLanguage();
  const key = JSON.stringify([getUserId(), cardId, answer, language]);
  if (pending.has(key)) return pending.get(key);
  const request = api.post('/ai/evaluate-answer', {
    card_id: cardId, answer, feedback_language: language,
  }).then(({ data }) => {
    if (!['correct', 'accepted_minor', 'needs_retry', 'incorrect', 'unavailable'].includes(data?.result?.verdict)
      || data.result.accepted !== ['correct', 'accepted_minor'].includes(data.result.verdict)) {
      throw new Error('Invalid answer evaluation response');
    }
    return data;
  }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
