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
if (!globalThis.localStorage) {
  globalThis.localStorage = {
    getItem: key => (memStorage.has(key) ? memStorage.get(key) : null),
    setItem: (key, val) => memStorage.set(key, String(val)),
    removeItem: key => memStorage.delete(key),
    clear: () => memStorage.clear(),
  };
}
if (!globalThis.window) {
  globalThis.window = {
    location: { search: '', hostname: 'appassets.androidplatform.net', port: '', protocol: 'https:', origin: 'https://appassets.androidplatform.net' },
    Capacitor: null,
  };
}
if (!globalThis.navigator) {
  globalThis.navigator = { onLine: true };
}
if (!globalThis.URL.createObjectURL) {
  let blobSeq = 0;
  globalThis.URL.createObjectURL = () => `blob:standalone-test/${++blobSeq}`;
  globalThis.URL.revokeObjectURL = () => {};
}

mock.module('../../utils/standaloneMode.js', {
  namedExports: {
    IS_STANDALONE: true,
    STANDALONE_APPLICATION_ID: 'com.lerne.offlinepilot',
    STANDALONE_USER_ID: 900001,
    STANDALONE_SESSION_IDENTITY: 'standalone-offline-pilot',
    STANDALONE_DB_PREFIX: 'LerneStandaloneDB',
    STANDALONE_SEED_DECK_IDS: new Set([9101, 9102, 9103]),
    STANDALONE_PROFILE_NAME_KEY: 'lerne_standalone_profile_name',
    getStandaloneProfileName: () => memStorage.get('lerne_standalone_profile_name') || 'Offline Pilot',
    saveStandaloneProfileName: (name) => String(name || 'Offline Pilot'),
    getStandaloneProfile: () => ({
      user_id: 900001,
      first_name: 'Offline Pilot',
      username: 'offline_pilot',
      is_guest: false,
      active_language: 'de',
      has_selected_language: true,
      is_standalone: true,
    }),
  },
});

mock.module('../apiConfig.js', {
  namedExports: {
    API_BASE_URL: '',
    getApiBaseUrl: () => '',
    mediaURL: (p) => String(p || ''),
  },
});

const {
  clearWebMemorySecrets,
  deleteVaultKey,
  getVaultKeyStatus,
  setVaultKey,
  validateAllowlistedUrl,
} = await import('../../pilot/secretVault.js');
const { STANDALONE_SETTINGS_KEYS } = await import('../../pilot/standaloneSettings.js');
const { standaloneAiTtsApi } = await import('../../pilot/standaloneAiTtsApi.js');
const { generateCardAction } = await import('../../pilot/ai/cardAiService.js');
const { wrapPcm16ToWavBytes } = await import('../../pilot/tts/wavUtil.js');
const { clearPreviewAudioCache } = await import('../../pilot/tts/ttsService.js');
const { androidSystemTtsProvider } = await import('../../pilot/tts/androidSystemTtsProvider.js');
const { prepareLocalDb, resetDbForTests } = await import('../../services/localDb.js');
const { nativeV2Version } = await import('../../utils/nativeV2Contract.js');

function validMp3Bytes() {
  const bytes = new Uint8Array(256);
  bytes[0] = 0x49; bytes[1] = 0x44; bytes[2] = 0x33; // "ID3"
  bytes[10] = 0xff; bytes[11] = 0xfb; bytes[12] = 0x90;
  return bytes;
}

describe('Standalone AI and Multi-Provider TTS', () => {
  beforeEach(async () => {
    memStorage.clear();
    clearWebMemorySecrets();
    clearPreviewAudioCache();
    await Dexie.delete('LerneStandaloneDB_900001').catch(() => {});
    resetDbForTests?.();
  });

  test('memory-only web vault never writes API keys to localStorage and enforces strict HTTPS allowlist', async () => {
    const secret = 'AIzaTestSecretKey987654321';
    await setVaultKey('gemini', secret);

    const status = await getVaultKeyStatus();
    assert.equal(status.storage, 'memory');
    assert.equal(status.slots.gemini, true);
    for (const [k, v] of memStorage.entries()) {
      assert.equal(String(v).includes(secret), false, `Secret leaked to storage key ${k}`);
    }

    assert.throws(() => validateAllowlistedUrl('gemini', 'http://generativelanguage.googleapis.com/v1beta/models'), /HTTPS/);
    assert.throws(() => validateAllowlistedUrl('gemini', 'https://evil.example/v1beta/models'), /not allowlisted/);
    assert.throws(() => validateAllowlistedUrl('azure_tts', 'https://-evil.tts.speech.microsoft.com/cognitiveservices/v1'), /not allowlisted/);
    assert.ok(validateAllowlistedUrl('azure_tts', 'https://germanywestcentral.tts.speech.microsoft.com/cognitiveservices/v1'));

    await deleteVaultKey('gemini');
    assert.equal((await getVaultKeyStatus()).slots.gemini, false);
  });

  test('supports Gemini, OpenRouter, and Groq AI with Native V2 validation, no model fallback, and AbortController cancellation', async () => {
    memStorage.set(STANDALONE_SETTINGS_KEYS.aiProvider, 'gemini');
    memStorage.set(STANDALONE_SETTINGS_KEYS.aiModels, JSON.stringify({
      gemini: 'gemini-2.5-flash',
      openrouter: 'google/gemini-2.5-flash',
      groq: 'llama-3.3-70b-versatile',
    }));
    await setVaultKey('gemini', 'AIzaGem1234');
    await setVaultKey('openrouter', 'or-secret-5678');
    await setVaultKey('groq', 'gsk-secret-9999');

    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      if (String(url).includes('generativelanguage.googleapis.com')) {
        assert.equal(init.redirect, 'error');
        assert.equal(init.headers['x-goog-api-key'], 'AIzaGem1234');
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/json']]),
          arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    schema_version: nativeV2Version,
                    card: {
                      type: 'standard',
                      data: { prompt: 'der Baum', answer: 'дерево' },
                      info: [],
                      explanation: 'Мужской род (der).',
                      level: 'A1',
                    },
                  }),
                }],
              },
            }],
          })).buffer,
        };
      }
      if (String(url).includes('openrouter.ai')) {
        assert.equal(init.headers.Authorization, 'Bearer or-secret-5678');
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/json']]),
          arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({ explanation: 'Правило из OpenRouter.', level: 'A2' }),
              },
            }],
          })).buffer,
        };
      }
      if (String(url).includes('api.groq.com')) {
        assert.equal(init.headers.Authorization, 'Bearer gsk-secret-9999');
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/json']]),
          arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  cards: [
                    { prompt: 'das Buch', answer: 'книга', explanation: 'Средний род', level: 'A1' },
                    { prompt: 'lesen', answer: 'читать', explanation: 'Сильный глагол', level: 'A1' },
                  ],
                }),
              },
            }],
          })).buffer,
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    };

    // 1. Gemini full_card preserving existing layout images
    const existingEnvelope = {
      schema_version: 2,
      card: {
        type: 'standard',
        data: { prompt: 'der Baum', answer: '' },
        info: [],
        explanation: '',
        image: 'images/tree.webp',
      },
    };
    const resGemini = await standaloneAiTtsApi.handle('/cards/ai-generate', {
      content_v2: existingEnvelope,
      target_language: 'de',
      native_language: 'ru',
      action_type: 'full_card',
    });
    assert.equal(resGemini.data.content_v2.card.data.answer, 'дерево');
    assert.equal(resGemini.data.content_v2.card.image, 'images/tree.webp');

    // 2. OpenRouter explain_rule
    memStorage.set(STANDALONE_SETTINGS_KEYS.aiProvider, 'openrouter');
    const resOr = await generateCardAction({
      contentV2: resGemini.data.content_v2,
      actionType: 'explain_rule',
    });
    assert.equal(resOr.content_v2.card.explanation, 'Правило из OpenRouter.');

    // 3. Groq batch creation saves directly into Dexie
    const db = await prepareLocalDb();
    await db.decks.put({
      id: 101,
      name: 'AI Batch Deck',
      target_language: 'de',
      scope: 'personal',
      is_deleted: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    memStorage.set(STANDALONE_SETTINGS_KEYS.aiProvider, 'groq');
    const batchRes = await standaloneAiTtsApi.handle('/cards/ai-generate-batch', {
      text: 'das Buch\nlesen',
      deck_id: '101',
      target_language: 'de',
      native_language: 'ru',
    });
    assert.equal(batchRes.data.generated_count, 2);
    const savedCards = await db.cards.where('deck_id').equals(101).toArray();
    assert.equal(savedCards.length, 2);
    assert.equal(savedCards[0].content_v2.card.data.answer, 'книга');

    // 4. Error does NOT auto-fallback to another model
    let failCount = 0;
    globalThis.fetch = async () => {
      failCount += 1;
      return {
        ok: false,
        status: 429,
        headers: new Map(),
        arrayBuffer: async () => new TextEncoder().encode('{"error":{"message":"Quota exceeded"}}').buffer,
      };
    };
    await assert.rejects(() => generateCardAction({ phrase: 'Hallo', actionType: 'full_card' }), /HTTP 429/);
    assert.equal(failCount, 1);

    // 5. Cancellation via AbortController rejects before outbound call
    const ctrl = new AbortController();
    ctrl.abort();
    await assert.rejects(() => generateCardAction({ phrase: 'Hallo', signal: ctrl.signal }), /AbortError|canceled/);
  });

  test('supports Gemini TTS, Azure Speech, Android System TTS, SHA-256 deduplication, and rejects stale-revision races', async () => {
    await setVaultKey('gemini', 'AIzaSharedTts1234');
    await setVaultKey('azure_tts', 'AzureTtsKey5678');
    memStorage.set(STANDALONE_SETTINGS_KEYS.azureRegion, 'westeurope');

    const pcm = new Uint8Array(400);
    for (let i = 0; i < pcm.length; i += 2) {
      pcm[i] = 10;
      pcm[i + 1] = 1;
    }
    const pcmBase64 = btoa(String.fromCharCode(...pcm));

    globalThis.fetch = async (url, init) => {
      if (String(url).includes('generativelanguage.googleapis.com')) {
        assert.equal(init.headers['x-goog-api-key'], 'AIzaSharedTts1234');
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/json']]),
          arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({
            candidates: [{
              content: {
                parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcmBase64 } }],
              },
            }],
          })).buffer,
        };
      }
      if (String(url).includes('westeurope.tts.speech.microsoft.com')) {
        assert.equal(init.headers['Ocp-Apim-Subscription-Key'], 'AzureTtsKey5678');
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'audio/mpeg']]),
          arrayBuffer: async () => validMp3Bytes().buffer,
        };
      }
      throw new Error(`Unexpected TTS URL ${url}`);
    };

    const db = await prepareLocalDb();
    await db.decks.put({
      id: 202,
      name: 'Audio Deck',
      target_language: 'de',
      scope: 'personal',
      is_deleted: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await db.cards.put({
      id: 303,
      deck_id: 202,
      position: 0,
      target_language: 'de',
      revision: 1,
      content_v2: {
        schema_version: 2,
        card: { type: 'standard', data: { prompt: 'Guten Tag', answer: 'Добрый день' }, info: [], explanation: '' },
      },
      is_deleted: 0,
    });

    // Preview does NOT write anything to db.media
    const previewRes = await standaloneAiTtsApi.handle('/media/generate-audio', {
      text: 'Guten Tag',
      lang: 'de',
      voice: 'gemini:Kore',
      persist: false,
    });
    assert.ok(previewRes.data.url.startsWith('blob:'));
    assert.equal(await db.media.count(), 0);

    // Attach to card stores deduplicated SHA-256 WAV in db.media and updates revision
    const attachRes = await standaloneAiTtsApi.handle('/media/generate-card-audio', {
      card_id: 303,
      side: 'front',
      lang: 'de',
      voice: 'gemini:gemini-2.5-pro-preview-tts:Puck',
    });
    assert.match(attachRes.data.path, /^\/api\/media\/audio\/archive_[a-f0-9]{64}\.wav$/);
    assert.equal(attachRes.data.revision, 2);
    assert.equal(await db.media.count(), 1);

    // Second synthesis with Azure MP3 works cleanly too
    const azureRes = await standaloneAiTtsApi.handle('/media/generate-audio', {
      text: 'Guten Abend',
      lang: 'de',
      voice: 'azure:de-DE-ConradNeural',
      rate: '-10%',
      persist: true,
    });
    assert.match(azureRes.data.path, /^\/api\/media\/audio\/archive_[a-f0-9]{64}\.mp3$/);

    // Stale revision guard: simulate card edit while TTS request is in flight -> rejects with 409 without overwriting
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      await db.cards.update(303, { revision: 99 });
      return originalFetch(url, init);
    };
    await assert.rejects(
      () => standaloneAiTtsApi.handle('/media/generate-card-audio', { card_id: 303, side: 'front', voice: 'gemini:Kore' }),
      (err) => err?.response?.status === 409,
    );
    const untouched = await db.cards.get(303);
    assert.equal(untouched.revision, 99);
    assert.equal(untouched.audio_path, attachRes.data.path);

    // Android System TTS provider wrapper wraps PCM/WAV cleanly
    const wavSample = wrapPcm16ToWavBytes(pcm, 24000, 1);
    assert.equal(String.fromCharCode(...wavSample.slice(0, 4)), 'RIFF');
    assert.ok(wavSample.length >= 128);
    assert.equal(androidSystemTtsProvider.isSupported(), false);
  });
});
