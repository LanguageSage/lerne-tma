import { getNativePlugin, isNativePluginAvailable } from '../nativeBridge.js';
import { decodeBase64ToUint8, rateStringToFloat } from './wavUtil.js';

let requestCounter = 0;

function nextPiperRequestId() {
  requestCounter += 1;
  return `piper_req_${Date.now()}_${requestCounter}`;
}

function formatVoiceLabel(voice) {
  const title = voice?.displayName || voice?.id || '';
  const srKhz = voice?.sampleRate ? `${Number((voice.sampleRate / 1000).toFixed(2))}` : '';
  const sizeMb = voice?.sizeMb ? `${voice.sizeMb} МБ` : '';
  const badges = [
    srKhz ? `${srKhz} кГц` : '',
    sizeMb,
    voice?.bundled ? 'встроен' : 'импортирован',
    voice?.commercialSafe === false ? 'NC' : '',
  ].filter(Boolean);
  return badges.length ? `${title} (${badges.join(' · ')})` : title;
}

export const piperTtsProvider = {
  id: 'piper',
  label: 'Piper Neural TTS (локально, офлайн, без ключей)',
  offline: true,
  supportsRate: true,

  isSupported() {
    return isNativePluginAvailable('AndroidPiperTts');
  },

  async listVoices() {
    if (!this.isSupported()) {
      return { available: false, loadedModelId: '', modelsDir: '', voices: [] };
    }
    const res = await getNativePlugin('AndroidPiperTts').listVoices({});
    const rawVoices = Array.isArray(res?.voices) ? res.voices : [];
    const voices = rawVoices.map((v) => ({
      ...v,
      label: formatVoiceLabel(v),
    }));
    return {
      available: Boolean(res?.available && voices.length > 0),
      loadedModelId: res?.loadedModelId || '',
      modelsDir: res?.modelsDir || '',
      voices,
    };
  },

  async releaseEngine(modelId = '') {
    if (!this.isSupported()) return;
    try {
      await getNativePlugin('AndroidPiperTts').releaseEngine(modelId ? { modelId } : {});
    } catch {
      // Best-effort memory release when switching providers.
    }
  },

  async synthesize({ text, voice = '', lang = 'de', rate = '+0%', options = null, signal = undefined }) {
    if (!this.isSupported()) {
      throw new Error('Локальный движок Piper TTS недоступен на этой платформе');
    }
    if (signal?.aborted) {
      throw new DOMException('TTS canceled', 'AbortError');
    }
    const plugin = getNativePlugin('AndroidPiperTts');
    const cleanVoice = String(voice || '').replace(/^piper:/, '').replace(/^:/, '').trim();
    const rateFloat = rateStringToFloat(rate);
    const requestId = nextPiperRequestId();

    const onAbort = () => {
      plugin.cancelSynthesis({ requestId }).catch(() => {});
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const payload = {
        requestId,
        text,
        voice: cleanVoice === 'default' ? '' : cleanVoice,
        lang,
        rate: rateFloat,
      };
      if (options && Number.isInteger(options.speaker_id)) {
        payload.speakerId = options.speaker_id;
      }
      const res = await plugin.synthesizeToWav(payload);
      if (signal?.aborted) {
        throw new DOMException('TTS canceled', 'AbortError');
      }
      const bytes = decodeBase64ToUint8(res?.audioBase64);
      return {
        bytes,
        mime: 'audio/wav',
        ext: '.wav',
        provider: this.id,
        voice: res?.modelId || cleanVoice || lang,
      };
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') {
        throw new DOMException('TTS canceled', 'AbortError');
      }
      throw err;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  },
};
