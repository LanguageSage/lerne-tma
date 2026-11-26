import { getNativePlugin, isNativePluginAvailable } from '../nativeBridge.js';
import { readStandaloneAndroidTtsEngine } from '../standaloneSettings.js';
import { decodeBase64ToUint8, rateStringToFloat } from './wavUtil.js';

export const androidSystemTtsProvider = {
  id: 'android_system',
  label: 'Android System TTS (офлайн / движки устройства)',
  offline: true,
  supportsRate: true,

  isSupported() {
    return isNativePluginAvailable('AndroidSystemTts');
  },

  async listEnginesAndVoices(engine = '') {
    if (!this.isSupported()) {
      return { engines: [], voices: [], activeEngine: '' };
    }
    const chosenEngine = String(engine || readStandaloneAndroidTtsEngine()).trim();
    const res = await getNativePlugin('AndroidSystemTts').listEnginesAndVoices({
      engine: chosenEngine,
    });
    return {
      engines: Array.isArray(res?.engines) ? res.engines : [],
      voices: Array.isArray(res?.voices) ? res.voices : [],
      activeEngine: res?.activeEngine || chosenEngine || '',
    };
  },

  async synthesize({ text, voice = '', lang = 'de', rate = '+0%', engine = '', signal = undefined }) {
    if (!this.isSupported()) {
      throw new Error('Android System TTS доступен только в Android-приложении');
    }
    if (signal?.aborted) {
      throw new DOMException('TTS canceled', 'AbortError');
    }
    const plugin = getNativePlugin('AndroidSystemTts');
    const chosenEngine = String(engine || readStandaloneAndroidTtsEngine()).trim();
    const cleanVoice = String(voice || '').replace(/^android_system:(?:[^:]*:)?/, '').trim();
    const rateFloat = rateStringToFloat(rate);

    const onAbort = () => {
      plugin.cancelSynthesis({}).catch(() => {});
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await plugin.synthesizeToWav({
        text,
        engine: chosenEngine,
        voice: cleanVoice,
        lang,
        rate: rateFloat,
      });
      const bytes = decodeBase64ToUint8(res?.audioBase64);
      return {
        bytes,
        mime: 'audio/wav',
        ext: '.wav',
        provider: this.id,
        voice: cleanVoice || lang,
      };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  },
};
