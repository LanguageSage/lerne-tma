import { generateBatchStandardCards, generateCardAction } from './ai/cardAiService.js';
import {
  generateAndAttachCardAudio,
  synthesizeOrGetCachedStudyAudio,
  synthesizeStandaloneAudio,
} from './tts/ttsService.js';

export const STANDALONE_AI_TTS_ENDPOINTS = new Set([
  '/cards/ai-generate',
  '/cards/ai-generate-batch',
  '/ai/generate-batch',
  '/media/generate-audio',
  '/media/generate-card-audio',
  '/media/study-local-audio',
]);

export const standaloneAiTtsApi = {
  supports(method, rawUrl) {
    if (String(method || '').toLowerCase() !== 'post') return false;
    const path = String(rawUrl || '').split('?')[0].replace(/\/$/, '') || '/';
    return STANDALONE_AI_TTS_ENDPOINTS.has(path);
  },

  async handle(rawUrl, body = {}, config = {}) {
    const path = String(rawUrl || '').split('?')[0].replace(/\/$/, '') || '/';
    const signal = config?.signal;

    if (path === '/cards/ai-generate') {
      const data = await generateCardAction({
        phrase: body?.phrase || '',
        contentV2: body?.content_v2 || null,
        targetLanguage: body?.target_language || 'de',
        nativeLanguage: body?.native_language || 'ru',
        actionType: body?.action_type || 'full_card',
        userRequest: body?.user_request || '',
        signal,
      });
      return { data, status: 200 };
    }

    if (path === '/cards/ai-generate-batch' || path === '/ai/generate-batch') {
      const data = await generateBatchStandardCards({
        text: body?.text || '',
        deckId: body?.deck_id ?? null,
        targetLanguage: body?.target_language || 'de',
        nativeLanguage: body?.native_language || 'ru',
        signal,
      });
      return { data, status: 200 };
    }

    if (path === '/media/generate-audio') {
      const data = await synthesizeStandaloneAudio({
        text: body?.text || '',
        lang: body?.lang || 'de',
        voice: body?.voice || '',
        rate: body?.rate || '+0%',
        persist: body?.persist === true,
        options: body?.options || null,
        signal,
      });
      return { data, status: 200 };
    }

    if (path === '/media/generate-card-audio') {
      const data = await generateAndAttachCardAudio({
        cardId: body?.card_id,
        side: body?.side || 'front',
        text: body?.text || null,
        lang: body?.lang || null,
        voice: body?.voice || '',
        rate: body?.rate || null,
        signal,
      });
      return { data, status: 200 };
    }

    if (path === '/media/study-local-audio') {
      const data = await synthesizeOrGetCachedStudyAudio({
        text: body?.text || '',
        lang: body?.lang || 'de',
        side: body?.side || 'front',
        voice: body?.voice || '',
        rate: body?.rate || null,
        signal,
      });
      return { data, status: 200 };
    }

    throw new Error(`Unsupported standalone AI/TTS endpoint: ${path}`);
  },
};
