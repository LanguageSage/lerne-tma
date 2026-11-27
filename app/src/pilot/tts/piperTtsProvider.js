import { tr } from '../../i18n/locale.js';
import { getNativePlugin, isNativePluginAvailable } from '../nativeBridge.js';
import { isWindowsStandaloneLoopback } from '../standaloneSettings.js';
import { decodeBase64ToUint8, rateStringToFloat } from './wavUtil.js';

let requestCounter = 0;
const CATALOG_CACHE_TTL_MS = 3000;
let inFlightCatalogPromise = null;
let inFlightCatalogKey = '';
let cachedCatalog = null;
let cachedCatalogKey = '';
let cachedCatalogAt = 0;

function currentCatalogEnvKey() {
  const nativeFlag = isNativePluginAvailable('AndroidPiperTts') ? 'native' : 'web';
  const locOrigin = typeof window !== 'undefined' ? String(window.location?.origin || '') : '';
  return `${nativeFlag}:${locOrigin}`;
}

function nextPiperRequestId() {
  requestCounter += 1;
  return `piper_req_${Date.now()}_${requestCounter}`;
}

function formatVoiceLabel(voice, { isNative = true } = {}) {
  const title = voice?.displayName || voice?.id || '';
  const srKhz = voice?.sampleRate ? `${Number((voice.sampleRate / 1000).toFixed(2))}` : '';
  const sizeMb = voice?.sizeMb ? `${voice.sizeMb} ${tr('МБ')}` : '';
  const sourceBadge = voice?.bundled
    ? tr('встроен')
    : (isNative ? tr('импортирован') : tr('локальный'));
  const badges = [
    srKhz ? `${srKhz} ${tr('кГц')}` : '',
    sizeMb,
    sourceBadge,
    voice?.commercialSafe === false ? 'NC' : '',
  ].filter(Boolean);
  return badges.length ? `${title} (${badges.join(' · ')})` : title;
}

function normalizeCatalogPayload(res, { isNative = true } = {}) {
  const rawVoices = Array.isArray(res?.voices) ? res.voices : [];
  const voices = rawVoices.map((v) => ({
    ...v,
    label: formatVoiceLabel(v, { isNative }),
  }));
  return {
    available: Boolean(res?.available && voices.length > 0),
    runnerAvailable: isNative ? true : Boolean(res?.runnerAvailable ?? res?.available),
    loadedModelId: res?.loadedModelId || '',
    modelsDir: res?.modelsDir || '',
    canRestoreBundled: Boolean(isNative && res?.canRestoreBundled),
    voices,
  };
}

function emptyCatalogPayload() {
  return {
    available: false,
    runnerAvailable: false,
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
    inFlightCatalogKey = '';
    cachedCatalog = null;
    cachedCatalogKey = '';
    cachedCatalogAt = 0;
  },

  isSupported() {
    return isNativePluginAvailable('AndroidPiperTts') || isWindowsStandaloneLoopback();
  },

  canManageModels() {
    return isNativePluginAvailable('AndroidPiperTts');
  },

  async listVoices({ forceRefresh = false } = {}) {
    const envKey = currentCatalogEnvKey();
    if (
      !forceRefresh
      && cachedCatalog
      && cachedCatalogKey === envKey
      && (Date.now() - cachedCatalogAt) < CATALOG_CACHE_TTL_MS
    ) {
      return cachedCatalog;
    }
    if (!forceRefresh && inFlightCatalogPromise && inFlightCatalogKey === envKey) {
      return inFlightCatalogPromise;
    }

    const loadCatalog = async () => {
      if (isNativePluginAvailable('AndroidPiperTts')) {
        const res = await getNativePlugin('AndroidPiperTts').listVoices({});
        return normalizeCatalogPayload(res, { isNative: true });
      }
      if (isWindowsStandaloneLoopback()) {
        const resp = await fetch('/__standalone_local_piper/voices', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          redirect: 'error',
        });
        if (resp.status === 404) {
          return emptyCatalogPayload();
        }
        const contentType = resp.headers?.get ? String(resp.headers.get('content-type') || '').toLowerCase() : 'application/json';
        if (resp.headers?.get && !contentType.includes('application/json')) {
          return emptyCatalogPayload();
        }
        const json = await resp.json().catch(() => null);
        if (!resp.ok || !json || json.ok !== true) {
          throw new Error(json?.error || `Ошибка загрузки локального каталога Piper (${resp.status})`);
        }
        return normalizeCatalogPayload(json, { isNative: false });
      }
      return emptyCatalogPayload();
    };

    const promise = loadCatalog();
    inFlightCatalogPromise = promise;
    inFlightCatalogKey = envKey;
    try {
      const catalog = await promise;
      if (inFlightCatalogPromise === promise) {
        cachedCatalog = catalog;
        cachedCatalogKey = envKey;
        cachedCatalogAt = Date.now();
      }
      return catalog;
    } finally {
      if (inFlightCatalogPromise === promise) {
        inFlightCatalogPromise = null;
        inFlightCatalogKey = '';
      }
    }
  },

  async importModelFromPicker() {
    if (!this.canManageModels()) {
      throw new Error('Импорт пакетов голосовых моделей доступен в приложении Lerne Android');
    }
    const res = await getNativePlugin('AndroidPiperTts').pickAndImportModelZip({});
    if (res?.cancelled) {
      return { cancelled: true, imported: null, catalog: null };
    }
    const catalog = normalizeCatalogPayload(res, { isNative: true });
    this.clearCatalogCache();
    cachedCatalog = catalog;
    cachedCatalogKey = currentCatalogEnvKey();
    cachedCatalogAt = Date.now();
    const imported = res?.imported
      ? {
          ...res.imported,
          label: formatVoiceLabel(res.imported, { isNative: true }),
        }
      : null;
    return { cancelled: false, imported, catalog };
  },

  async cancelModelImport() {
    if (!this.canManageModels()) return;
    try {
      await getNativePlugin('AndroidPiperTts').cancelModelImport({});
    } catch {
      // Best-effort cancel.
    }
  },

  async deleteModel(modelId) {
    if (!this.canManageModels()) {
      throw new Error('Удаление голосовых моделей доступно в приложении Lerne Android');
    }
    const cleanId = String(modelId || '').trim();
    if (!cleanId) {
      throw new Error('Не указан идентификатор голосовой модели');
    }
    const res = await getNativePlugin('AndroidPiperTts').deleteModel({ modelId: cleanId });
    const catalog = normalizeCatalogPayload(res, { isNative: true });
    this.clearCatalogCache();
    cachedCatalog = catalog;
    cachedCatalogKey = currentCatalogEnvKey();
    cachedCatalogAt = Date.now();
    return {
      deletedModelId: res?.deletedModelId || cleanId,
      catalog,
    };
  },

  async restoreBundledModels() {
    if (!this.canManageModels()) {
      throw new Error('Восстановление встроенных моделей доступно в приложении Lerne Android');
    }
    const res = await getNativePlugin('AndroidPiperTts').restoreBundledModels({});
    const catalog = normalizeCatalogPayload(res, { isNative: true });
    this.clearCatalogCache();
    cachedCatalog = catalog;
    cachedCatalogKey = currentCatalogEnvKey();
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

    if (isNativePluginAvailable('AndroidPiperTts')) {
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
    }

    // Windows Standalone loopback mode (run_standalone.bat -> /__standalone_local_piper/synthesize)
    const body = {
      text,
      voice: cleanVoice === 'default' ? '' : cleanVoice,
      lang,
      rate: rateFloat,
    };
    if (options && Number.isInteger(options.speaker_id)) {
      body.speakerId = options.speaker_id;
    }

    try {
      const resp = await fetch('/__standalone_local_piper/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal,
      });
      const contentType = resp.headers?.get ? String(resp.headers.get('content-type') || '').toLowerCase() : 'application/json';
      if (resp.headers?.get && !contentType.includes('application/json')) {
        throw new Error('Локальный сервер Piper недоступен (запустите Lerne через run_standalone.bat)');
      }
      const json = await resp.json().catch(() => null);
      if (signal?.aborted) {
        throw new DOMException('TTS canceled', 'AbortError');
      }
      if (!resp.ok || !json || json.ok !== true || typeof json.audioBase64 !== 'string' || !json.audioBase64) {
        throw new Error(json?.error || `Ошибка синтеза Piper (${resp.status})`);
      }
      const bytes = decodeBase64ToUint8(json.audioBase64);
      return {
        bytes,
        mime: 'audio/wav',
        ext: '.wav',
        provider: this.id,
        voice: json.modelId || cleanVoice || lang,
      };
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') {
        throw new DOMException('TTS canceled', 'AbortError');
      }
      throw err;
    }
  },
};
