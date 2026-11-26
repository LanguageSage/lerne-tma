import test, { describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) {
        return next(`${specifier}.js`, context);
      }
      throw error;
    }
  },
});

const memStorage = new Map();
globalThis.localStorage = {
  getItem: (key) => (memStorage.has(key) ? memStorage.get(key) : null),
  setItem: (key, val) => memStorage.set(key, String(val)),
  removeItem: (key) => memStorage.delete(key),
  clear: () => memStorage.clear(),
};
globalThis.window = {
  location: { search: '', hostname: 'localhost', port: '', protocol: 'https:', origin: 'https://localhost' },
};
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: false },
  configurable: true,
});
let blobCounter = 0;
globalThis.URL.createObjectURL = () => `blob:piper-test/${++blobCounter}`;
globalThis.URL.revokeObjectURL = () => {};

let nativeEnabled = true;
const pluginCalls = [];
let synthDelayMs = 0;

const fakeAndroidPiperPlugin = {
  async listVoices() {
    pluginCalls.push({ method: 'listVoices' });
    return {
      available: true,
      loadedModelId: 'de_DE-thorsten-high',
      modelsDir: '/data/user/0/com.lerne.offlinepilot/files/lerne-piper/models',
      voices: [
        {
          id: 'de_DE-thorsten-high',
          displayName: 'Thorsten (High, ♂)',
          lang: 'de_DE',
          gender: 'male',
          sampleRate: 22050,
          sizeMb: 108.6,
          bundled: true,
          commercialSafe: true,
        },
        {
          id: 'de_DE-kerstin-medium',
          displayName: 'Kerstin (Medium, ♀)',
          lang: 'de_DE',
          gender: 'female',
          sampleRate: 22050,
          sizeMb: 60.3,
          bundled: true,
          commercialSafe: true,
        },
      ],
    };
  },
  async synthesizeToWav(payload) {
    pluginCalls.push({ method: 'synthesizeToWav', payload });
    if (synthDelayMs > 0) {
      await new Promise((r) => setTimeout(r, synthDelayMs));
    }
    const { wrapPcm16ToWavBytes } = await import('../../pilot/tts/wavUtil.js');
    const pcm = new Uint8Array(400);
    for (let i = 0; i < pcm.length; i += 2) {
      pcm[i] = 24;
      pcm[i + 1] = 2;
    }
    const wav = wrapPcm16ToWavBytes(pcm, 22050, 1);
    const b64 = btoa(String.fromCharCode(...wav));
    return {
      audioBase64: b64,
      mimeType: 'audio/wav',
      ext: '.wav',
      sampleRate: 22050,
      durationMs: 900,
      modelId: payload.voice || 'de_DE-thorsten-high',
    };
  },
  async cancelSynthesis(payload) {
    pluginCalls.push({ method: 'cancelSynthesis', payload });
  },
  async releaseEngine() {
    pluginCalls.push({ method: 'releaseEngine' });
  },
};

mock.module('../../pilot/nativeBridge.js', {
  namedExports: {
    isPlatformAssetUrl: () => false,
    isNativePlatform: () => nativeEnabled,
    isNativePluginAvailable: (name) => nativeEnabled && (name === 'AndroidPiperTts' || name === 'AndroidSystemTts'),
    getNativePlugin: (name) => {
      if (name === 'AndroidPiperTts') return fakeAndroidPiperPlugin;
      throw new Error(`Unexpected plugin ${name}`);
    },
    convertNativeFileSrc: (p) => p,
  },
});

mock.module('../../utils/standaloneMode.js', {
  namedExports: {
    IS_STANDALONE: true,
    STANDALONE_APPLICATION_ID: 'com.lerne.offlinepilot',
    STANDALONE_USER_ID: 900001,
    STANDALONE_SESSION_IDENTITY: 'standalone-offline-pilot',
    STANDALONE_DB_PREFIX: 'LerneStandaloneDB',
    STANDALONE_SEED_DECK_IDS: new Set([9101, 9102, 9103]),
    STANDALONE_PROFILE_NAME_KEY: 'lerne_standalone_profile_name',
    getStandaloneProfileName: () => 'Offline Pilot',
    saveStandaloneProfileName: (n) => n,
    getStandaloneProfile: () => ({ user_id: 900001, is_standalone: true }),
  },
});

mock.module('../apiConfig.js', {
  namedExports: {
    API_BASE_URL: '',
    getApiBaseUrl: () => '',
    mediaURL: (p) => String(p || ''),
  },
});

const { standaloneAiTtsApi } = await import('../../pilot/standaloneAiTtsApi.js');
const { piperTtsProvider } = await import('../../pilot/tts/piperTtsProvider.js');
const {
  getDefaultStandaloneVoice,
  getVoicesForStandaloneProvider,
  listStandaloneTtsProviders,
  parseStandaloneVoiceSpec,
} = await import('../../pilot/tts/registry.js');
const { STANDALONE_SETTINGS_KEYS, readStandaloneTtsProvider } = await import('../../pilot/standaloneSettings.js');
const { clearPreviewAudioCache } = await import('../../pilot/tts/ttsService.js');
const { prepareLocalDb, resetDbForTests } = await import('../../services/localDb.js');

describe('Android Piper Neural TTS Provider Integration', () => {
  beforeEach(async () => {
    memStorage.clear();
    pluginCalls.length = 0;
    synthDelayMs = 0;
    nativeEnabled = true;
    clearPreviewAudioCache();
    await Dexie.delete('LerneStandaloneDB_900001').catch(() => {});
    resetDbForTests?.();
  });

  test('lists Piper alongside Android System, Gemini, and Azure and prevents cross-language German fallback for Russian', async () => {
    assert.equal(readStandaloneTtsProvider(), 'android_system');
    memStorage.set(STANDALONE_SETTINGS_KEYS.ttsProvider, 'piper');
    assert.equal(readStandaloneTtsProvider(), 'piper');
    const providers = listStandaloneTtsProviders().map((p) => p.id);
    assert.deepEqual(providers, ['piper', 'gemini', 'android_system', 'azure']);

    const catalog = await piperTtsProvider.listVoices();
    assert.equal(catalog.available, true);
    assert.equal(catalog.voices.length, 2);
    assert.match(catalog.voices[0].label, /Thorsten.*22\.05 кГц.*108\.6 МБ.*встроен/);

    const deVoices = getVoicesForStandaloneProvider('piper', 'de', [], catalog.voices);
    assert.equal(deVoices[0].value, 'piper::default');
    assert.equal(deVoices[1].value, 'piper:de_DE-thorsten-high');
    assert.equal(deVoices[1].gender, 'm');
    assert.equal(deVoices[2].value, 'piper:de_DE-kerstin-medium');
    assert.equal(deVoices[2].gender, 'f');
    assert.equal(getDefaultStandaloneVoice('piper', 'de', catalog.voices), 'piper:de_DE-thorsten-high');

    // Russian must NOT silently fall back to German de_DE-thorsten-high
    const ruVoices = getVoicesForStandaloneProvider('piper', 'ru', [], catalog.voices);
    assert.deepEqual(ruVoices.map((v) => v.value), ['piper::default']);
    assert.equal(getDefaultStandaloneVoice('piper', 'ru', catalog.voices), 'piper::default');

    assert.deepEqual(parseStandaloneVoiceSpec('piper:de_DE-kerstin-medium'), {
      providerId: 'piper',
      voice: 'de_DE-kerstin-medium',
      model: null,
      engine: null,
    });
  });

  test('synthesizes completely offline into unified SHA-256 media pipeline and supports cancellation + engine release', async () => {
    // Block all network fetch calls to prove 100% offline synthesis
    globalThis.fetch = async () => {
      throw new Error('Network disabled in offline test');
    };

    const db = await prepareLocalDb();
    await db.decks.put({
      id: 501,
      name: 'Offline German',
      target_language: 'de',
      scope: 'personal',
      is_deleted: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await db.cards.put({
      id: 601,
      deck_id: 501,
      position: 0,
      target_language: 'de',
      revision: 1,
      content_v2: {
        schema_version: 2,
        card: { type: 'standard', data: { prompt: 'das Eichhörnchen', answer: 'белка' }, info: [], explanation: '' },
      },
      is_deleted: 0,
    });

    const attachRes = await standaloneAiTtsApi.handle('/media/generate-card-audio', {
      card_id: 601,
      side: 'front',
      lang: 'de',
      voice: 'piper:de_DE-thorsten-high',
      rate: '-15%',
    });
    assert.match(attachRes.data.path, /^\/api\/media\/audio\/archive_[a-f0-9]{64}\.wav$/);
    assert.equal(await db.media.count(), 1);
    const synthCall = pluginCalls.find((c) => c.method === 'synthesizeToWav');
    assert.equal(synthCall.payload.voice, 'de_DE-thorsten-high');
    assert.equal(synthCall.payload.rate, 0.85);

    // AbortController triggers per-request native cancelSynthesis(requestId) and rejects with AbortError
    synthDelayMs = 40;
    const ctrl = new AbortController();
    const pending = piperTtsProvider.synthesize({
      text: 'Abbrechen Test',
      voice: 'piper:de_DE-kerstin-medium',
      signal: ctrl.signal,
    });
    ctrl.abort();
    await assert.rejects(() => pending, (err) => err?.name === 'AbortError');
    const cancelCall = pluginCalls.find((c) => c.method === 'cancelSynthesis');
    assert.ok(cancelCall);

    await piperTtsProvider.releaseEngine();
    assert.equal(pluginCalls.some((c) => c.method === 'releaseEngine'), true);
  });
});
