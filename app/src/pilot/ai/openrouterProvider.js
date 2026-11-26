import { secureHttpsRequest } from '../secretVault.js';

export const OPENROUTER_AI_MODELS = [
  { id: 'google/gemini-2.5-flash', label: 'Google: Gemini 2.5 Flash' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct (Free)' },
  { id: 'deepseek/deepseek-chat-v3-0324:free', label: 'DeepSeek V3 0324 (Free)' },
  { id: 'qwen/qwen-2.5-72b-instruct:free', label: 'Qwen 2.5 72B Instruct (Free)' },
];

export const openrouterAiProvider = {
  id: 'openrouter',
  slot: 'openrouter',
  label: 'OpenRouter',
  defaultModel: 'google/gemini-2.5-flash',
  models: OPENROUTER_AI_MODELS,

  async generateChat({ systemPrompt, userMessage, model, temperature = 0.25, maxOutputTokens = 2048, jsonMode = true, signal }) {
    const chosenModel = String(model || this.defaultModel).trim();
    if (!chosenModel) {
      throw new Error('Выберите модель OpenRouter');
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
      url: 'https://openrouter.ai/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Title': 'Lerne Offline Pilot',
      },
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
      throw new Error(`OpenRouter (${chosenModel}) HTTP ${res.status}: ${String(detail || '').slice(0, 240)}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(res.bodyText);
    } catch {
      throw new Error('OpenRouter вернул некорректный JSON-ответ');
    }

    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('OpenRouter не вернул содержимое ответа');
    }
    return content.trim();
  },
};
