import { tr } from '../../i18n/locale.js';
import { getNativePlugin, isNativePluginAvailable } from '../nativeBridge.js';
import { decodeBase64ToUint8, rateStringToFloat } from './wavUtil.js';

let requestCounter = 0;
const CATALOG_CACHE_TTL_MS = 3000;
let inFlightCatalogPromise = null;
let cachedCatalog = null;
let cachedCatalogAt = 0;

function nextPiperRequestId() {
  requestCounter += 1;
  return `piper_req_${Date.now()}_${requestCounter}`;
}

function formatVoiceLabel(voice) {
  const title = voice?.displayName || voice?.id || '';
  const srKhz = voice?.sampleRate ? `${Number((voice.sampleRate / 1000).toFixed(2))}` : '';
  const sizeMb = voice?.sizeMb ? `${voice.sizeMb} ${tr('МБ')}` : '';
  const sourceBadge = voice?.bundled
    ? tr('встроен')
    : tr('импортирован');
  const badges = [
    srKhz ? `${srKhz} ${tr('кГц')}` : '',
    sizeMb,
    sourceBadge,
    voice?.commercialSafe === false ? 'NC' : '',
  ].filter(Boolean);
  return badges.length ? `${title} (${badges.join(' · ')})` : title;
}

function normalizeCatalogPayload(res) {
  const rawVoices = Array.isArray(res?.voices) ? res.voices : [];
  const voices = rawVoices.map((v) => ({
    ...v,
    label: formatVoiceLabel(v),
  }));
  return {
    available: Boolean(res?.available && voices.length > 0),
    loadedModelId: res?.loadedModelId || '',
    modelsDir: res?.modelsDir || '',
    canRestoreBundled: Boolean(res?.canRestoreBundled),
    voices,
  };
}

function emptyCatalogPayload() {
  return {
    available: false,
    loadedModelId: '',
    modelsDir: '',
    canRestoreBundled: false,
    voices: [],
  };
}

export const piperTtsProvider = {
  id: 'piper',
  label: 'Piper Neural TTS (локально, офлайн, без ключей)',
  offline: true,
  supportsRate: true,

  clearCatalogCache() {
    inFlightCatalogPromise = null;
    cachedCatalog = null;
    cachedCatalogAt = 0;
  },

  isSupported() {
    return isNativePluginAvailable('AndroidPiperTts');
  },

  async listVoices({ forceRefresh = false } = {}) {
    if (!this.isSupported()) return emptyCatalogPayload();
    if (
      !forceRefresh
      && cachedCatalog
      && (Date.now() - cachedCatalogAt) < CATALOG_CACHE_TTL_MS
    ) {
      return cachedCatalog;
    }
    if (!forceRefresh && inFlightCatalogPromise) {
      return inFlightCatalogPromise;
    }

    const promise = getNativePlugin('AndroidPiperTts').listVoices({}).then(normalizeCatalogPayload);
    inFlightCatalogPromise = promise;
    try {
      const catalog = await promise;
      if (inFlightCatalogPromise === promise) {
        cachedCatalog = catalog;
        cachedCatalogAt = Date.now();
      }
      return catalog;
    } finally {
      if (inFlightCatalogPromise === promise) {
        inFlightCatalogPromise = null;
      }
    }
  },

  async importModelFromPicker() {
    if (!this.isSupported()) {
      throw new Error('Импорт пакетов голосовых моделей доступен в приложении Lerne Android');
    }
    const res = await getNativePlugin('AndroidPiperTts').pickAndImportModelZip({});
    if (res?.cancelled) {
      return { cancelled: true, imported: null, catalog: null };
    }
    const catalog = normalizeCatalogPayload(res);
    this.clearCatalogCache();
    cachedCatalog = catalog;
    cachedCatalogAt = Date.now();
    const imported = res?.imported
      ? {
          ...res.imported,
          label: formatVoiceLabel(res.imported),
        }
      : null;
    return { cancelled: false, imported, catalog };
  },

  async cancelModelImport() {
    if (!this.isSupported()) return;
    try {
      await getNativePlugin('AndroidPiperTts').cancelModelImport({});
    } catch {
      // Best-effort cancel.
    }
  },

  async deleteModel(modelId) {
    if (!this.isSupported()) {
      throw new Error('Удаление голосовых моделей доступно в приложении Lerne Android');
    }
    const cleanId = String(modelId || '').trim();
    if (!cleanId) {
      throw new Error('Не указан идентификатор голосовой модели');
    }
    const res = await getNativePlugin('AndroidPiperTts').deleteModel({ modelId: cleanId });
    const catalog = normalizeCatalogPayload(res);
    this.clearCatalogCache();
    cachedCatalog = catalog;
    cachedCatalogAt = Date.now();
    return {
      deletedModelId: res?.deletedModelId || cleanId,
      catalog,
    };
  },

  async restoreBundledModels() {
    if (!this.isSupported()) {
      throw new Error('Восстановление встроенных моделей доступно в приложении Lerne Android');
    }
    const res = await getNativePlugin('AndroidPiperTts').restoreBundledModels({});
    const catalog = normalizeCatalogPayload(res);
    this.clearCatalogCache();
    cachedCatalog = catalog;
    cachedCatalogAt = Date.now();
    return {
      restoredCount: Number(res?.restoredCount || 0),
      catalog,
    };
  },

  async releaseEngine(modelId = '') {
    if (!isNativePluginAvailable('AndroidPiperTts')) return;
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

    const cleanVoice = String(voice || '').replace(/^piper:/, '').replace(/^:/, '').trim();
    const rateFloat = rateStringToFloat(rate);

    const plugin = getNativePlugin('AndroidPiperTts');
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
