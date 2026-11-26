import { secureHttpsRequest } from '../secretVault.js';

export const GEMINI_AI_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Рекомендуется)' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (Самый быстрый)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Сложные разборы)' },
];

export const geminiAiProvider = {
  id: 'gemini',
  slot: 'gemini',
  label: 'Google Gemini (общий ключ с Gemini TTS)',
  defaultModel: 'gemini-2.5-flash',
  models: GEMINI_AI_MODELS,

  async generateChat({ systemPrompt, userMessage, model, temperature = 0.25, maxOutputTokens = 2048, jsonMode = true, signal }) {
    const chosenModel = String(model || this.defaultModel).trim();
    if (!chosenModel) {
      throw new Error('Выберите модель Gemini');
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chosenModel)}:generateContent`;
    const payload = {
      systemInstruction: {
        parts: [{ text: String(systemPrompt || '') }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: String(userMessage || '') }],
        },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens,
        ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    };

    const res = await secureHttpsRequest({
      slot: this.slot,
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      responseType: 'text',
      timeoutMs: 60000,
      signal,
    });

    if (!res.ok) {
      let detail = res.bodyText;
      try {
        const parsedErr = JSON.parse(res.bodyText);
        detail = parsedErr?.error?.message || detail;
      } catch { /* ignore */ }
      throw new Error(`Gemini (${chosenModel}) HTTP ${res.status}: ${String(detail || '').slice(0, 240)}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(res.bodyText);
    } catch {
      throw new Error('Gemini вернул некорректный JSON-ответ');
    }

    const parts = parsed?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
    if (!text) {
      const reason = parsed?.candidates?.[0]?.finishReason || parsed?.promptFeedback?.blockReason || 'empty';
      throw new Error(`Gemini не вернул текст (${reason})`);
    }
    return text;
  },
};
