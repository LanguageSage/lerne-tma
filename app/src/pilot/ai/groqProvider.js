import { secureHttpsRequest } from '../secretVault.js';

export const GROQ_AI_MODELS = [
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile (Рекомендуется)' },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant (Быстрый)' },
  { id: 'qwen/qwen3-32b', label: 'Qwen 3 32B' },
];

export const groqAiProvider = {
  id: 'groq',
  slot: 'groq',
  label: 'Groq',
  defaultModel: 'llama-3.3-70b-versatile',
  models: GROQ_AI_MODELS,

  async generateChat({ systemPrompt, userMessage, model, temperature = 0.25, maxOutputTokens = 2048, jsonMode = true, signal }) {
    const chosenModel = String(model || this.defaultModel).trim();
    if (!chosenModel) {
      throw new Error('Выберите модель Groq');
    }
    const payload = {
      model: chosenModel,
      temperature,
      max_tokens: maxOutputTokens,
      messages: [
        { role: 'system', content: String(systemPrompt || '') },
        { role: 'user', content: String(userMessage || '') },
      ],
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    };

    const res = await secureHttpsRequest({
      slot: this.slot,
      url: 'https://api.groq.com/openai/v1/chat/completions',
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
      throw new Error(`Groq (${chosenModel}) HTTP ${res.status}: ${String(detail || '').slice(0, 240)}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(res.bodyText);
    } catch {
      throw new Error('Groq вернул некорректный JSON-ответ');
    }

    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Groq не вернул содержимое ответа');
    }
    return content.trim();
  },
};
