import { secureHttpsRequest } from '../secretVault.js';
import { readStandaloneGeminiTtsModel } from '../standaloneSettings.js';
import { decodeBase64ToUint8, wrapPcm16ToWavBytes } from './wavUtil.js';

export const GEMINI_TTS_MODELS = [
  { id: 'gemini-2.5-flash-preview-tts', label: 'Gemini 2.5 Flash TTS' },
  { id: 'gemini-2.5-pro-preview-tts', label: 'Gemini 2.5 Pro TTS' },
];

export const GEMINI_TTS_VOICES = [
  { value: 'gemini:Kore', label: 'Kore (♀️ Чёткий — по умолчанию)' },
  { value: 'gemini:Puck', label: 'Puck (♂️ Бодрый)' },
  { value: 'gemini:Aoede', label: 'Aoede (♀️ Выразительный)' },
  { value: 'gemini:Charon', label: 'Charon (♂️ Спокойный глубокий)' },
  { value: 'gemini:Fenrir', label: 'Fenrir (♂️ Энергичный)' },
  { value: 'gemini:Leda', label: 'Leda (♀️ Мягкий)' },
  { value: 'gemini:Orus', label: 'Orus (♂️ Уверенный)' },
  { value: 'gemini:Zephyr', label: 'Zephyr (♀️ Лёгкий)' },
  { value: 'gemini:Callirrhoe', label: 'Callirrhoe (♀️ Плавный)' },
  { value: 'gemini:Autonoe', label: 'Autonoe (♀️ Тёплый)' },
  { value: 'gemini:Enceladus', label: 'Enceladus (♂️ С придыханием)' },
  { value: 'gemini:Iapetus', label: 'Iapetus (♂️ Разборчивый)' },
  { value: 'gemini:Umbriel', label: 'Umbriel (♂️ Спокойный)' },
  { value: 'gemini:Algieba', label: 'Algieba (♂️ Бархатистый)' },
  { value: 'gemini:Despina', label: 'Despina (♀️ Ровный)' },
  { value: 'gemini:Erinome', label: 'Erinome (♀️ Ясный)' },
  { value: 'gemini:Sulafat', label: 'Sulafat (♀️ Тёплый)' },
  { value: 'gemini:Vindemiatrix', label: 'Vindemiatrix (♀️ Мягкий)' },
];

export const geminiTtsProvider = {
  id: 'gemini',
  slot: 'gemini',
  label: 'Gemini TTS (общий ключ Gemini, WAV)',
  offline: false,
  supportsRate: false,
  models: GEMINI_TTS_MODELS,

  buildSpeechConfig(voiceName, speakers = null) {
    if (Array.isArray(speakers) && speakers.length >= 2) {
      const speakerVoiceConfigs = speakers
        .filter((s) => s?.speaker)
        .map((s) => ({
          speaker: String(s.speaker).trim(),
          voiceConfig: { prebuiltVoiceConfig: { voiceName: String(s.voice || 'Kore').trim() } },
        }));
      if (speakerVoiceConfigs.length >= 2) {
        return { multiSpeakerVoiceConfig: { speakerVoiceConfigs } };
      }
    }
    return {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' },
      },
    };
  },

  async synthesize({ text, voice = 'Kore', model = null, options = null, signal = undefined }) {
    const chosenModel = String(model || readStandaloneGeminiTtsModel()).trim();
    if (!GEMINI_TTS_MODELS.some((m) => m.id === chosenModel)) {
      throw new Error(`Неподдерживаемая модель Gemini TTS: ${chosenModel}`);
    }
    const cleanVoice = String(voice || 'Kore').replace(/^gemini:(?:[^:]+:)?/, '').trim() || 'Kore';
    const promptText = options?.style ? `${String(options.style).trim()}: ${text}` : text;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chosenModel)}:generateContent`;
    const payload = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: this.buildSpeechConfig(cleanVoice, options?.speakers),
      },
    };

    const res = await secureHttpsRequest({
      slot: this.slot,
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      responseType: 'text',
      timeoutMs: 45000,
      signal,
    });

    if (!res.ok) {
      let detail = res.bodyText;
      try {
        detail = JSON.parse(res.bodyText)?.error?.message || detail;
      } catch { /* ignore */ }
      throw new Error(`Gemini TTS (${chosenModel}) HTTP ${res.status}: ${String(detail || '').slice(0, 240)}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(res.bodyText);
    } catch {
      throw new Error('Gemini TTS вернул некорректный JSON');
    }

    const parts = parsed?.candidates?.[0]?.content?.parts || [];
    const inline = parts.find((p) => p?.inlineData?.data)?.inlineData;
    if (!inline?.data) {
      throw new Error('Gemini TTS не вернул аудиопоток');
    }
    const rateMatch = String(inline.mimeType || '').match(/rate=(\d+)/i);
    const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
    const pcmBytes = decodeBase64ToUint8(inline.data);
    const wavBytes = wrapPcm16ToWavBytes(pcmBytes, sampleRate, 1);

    return {
      bytes: wavBytes,
      mime: 'audio/wav',
      ext: '.wav',
      provider: this.id,
      voice: `${chosenModel}:${cleanVoice}`,
    };
  },
};
