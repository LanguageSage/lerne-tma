import test, { describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { registerHooks } from 'node:module';
import { createTestSqlitePlugin } from '../../sqlite/__tests__/fakeCapacitorSqlite.js';
import { computeTtsCacheKey } from '../../sqlite/mediaContract.js';
import { sha256BytesHex, sha256Hex } from '../../pilot/sha256.js';

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
let nativeMedia = null;
const { database: nativeDb, plugin: sqlitePlugin } = createTestSqlitePlugin();
mock.module('@capacitor-community/sqlite', { namedExports: { CapacitorSQLite: sqlitePlugin }, cache: true });
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
  async pickAndImportModelZip() {
    pluginCalls.push({ method: 'pickAndImportModelZip' });
    if (fakeAndroidPiperPlugin._cancelNextImport) {
      fakeAndroidPiperPlugin._cancelNextImport = false;
      return { cancelled: true };
    }
    const imported = {
      id: 'de_DE-miro-high',
      displayName: 'Miro (High, ♂)',
      lang: 'de_DE',
      gender: 'male',
      sampleRate: 22050,
      sizeMb: 60.6,
      bundled: false,
      commercialSafe: false,
    };
    return {
      cancelled: false,
      available: true,
      canRestoreBundled: false,
      imported,
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
        imported,
      ],
    };
  },
  async cancelModelImport() {
    pluginCalls.push({ method: 'cancelModelImport' });
    return { cancelled: true };
  },
  async deleteModel(payload) {
    pluginCalls.push({ method: 'deleteModel', payload });
    return {
      deletedModelId: payload.modelId,
      available: true,
      canRestoreBundled: true,
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
      ],
    };
  },
  async restoreBundledModels() {
    pluginCalls.push({ method: 'restoreBundledModels' });
    return {
      restoredCount: 1,
      available: true,
      canRestoreBundled: false,
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
};

mock.module('../../pilot/nativeBridge.js', {
  namedExports: {
    isPlatformAssetUrl: () => false,
    isNativePlatform: () => nativeEnabled,
    isNativePluginAvailable: (name) => nativeEnabled && (
      name === 'AndroidPiperTts' || name === 'AndroidSystemTts' || (name === 'OfflineMaterialArchive' && nativeMedia !== null)
    ),
    getNativePlugin: (name) => {
      if (name === 'AndroidPiperTts') return fakeAndroidPiperPlugin;
      if (name === 'OfflineMaterialArchive') return nativeMedia;
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
  resolveValidStandaloneVoice,
} = await import('../../pilot/tts/registry.js');
const { STANDALONE_SETTINGS_KEYS, readStandaloneTtsProvider } = await import('../../pilot/standaloneSettings.js');
const {
  canUseLocalOfflineTtsForLang,
  clearPreviewAudioCache,
  getStudySpeakableText,
  isTargetLanguageCardSide,
} = await import('../../pilot/tts/ttsService.js');
const { prepareLocalDb, resetAllDatabases } = await import('../../services/localDb.js');
const { clearOfflineMediaCache } = await import('../../pilot/offlineMediaStore.js');
const { openNativeMediaDb } = await import('../../pilot/nativeMediaDb.js');

function mockNativeMedia() {
  const assets = new Map();
  const valid = asset => asset.sha256 === sha256BytesHex(asset.bytes);
  nativeMedia = {
    listMediaAssets: async () => ({ mediaRoot: '/test/media', assets: [...assets.values()].filter(valid), invalid: [] }),
    storeMediaAsset: async ({ dataBase64, repairCorruptAudio, ...asset }) => {
      const existing = assets.get(asset.filename);
      if (existing && !valid(existing) && !repairCorruptAudio) throw new Error('Existing media conflict');
      const bytes = Uint8Array.from(atob(dataBase64), ch => ch.charCodeAt(0));
      assets.set(asset.filename, { ...asset, bytes, mime: 'audio/wav' });
    },
    statMediaAsset: async ({ filename }) => {
      const asset = assets.get(filename);
      return { exists: Boolean(asset), valid: Boolean(asset && valid(asset)), ...asset };
    },
  };
  return assets;
}

describe('Android Piper Neural TTS Provider Integration', () => {
  beforeEach(async () => {
    memStorage.clear();
    pluginCalls.length = 0;
    synthDelayMs = 0;
    nativeEnabled = true;
    nativeMedia = null;
    clearOfflineMediaCache();
    if (nativeDb.prepare("SELECT name FROM sqlite_master WHERE name = 'media_assets'").get()) {
      nativeDb.exec('DELETE FROM media_assets');
    }
    clearPreviewAudioCache();
    piperTtsProvider.clearCatalogCache();
    await resetAllDatabases();
    await Dexie.delete('LerneStandaloneDB_900001').catch(() => {});
  });

  test('lists Piper alongside Android System, Gemini, and Azure and prevents cross-language German fallback for Russian', async () => {
    assert.equal(readStandaloneTtsProvider(), 'piper');
    memStorage.set(STANDALONE_SETTINGS_KEYS.ttsProvider, 'android_system');
    assert.equal(readStandaloneTtsProvider(), 'android_system');
    memStorage.set(STANDALONE_SETTINGS_KEYS.ttsProvider, 'piper');
    assert.equal(readStandaloneTtsProvider(), 'piper');
    const providers = listStandaloneTtsProviders().map((p) => p.id);
    assert.deepEqual(providers, ['piper', 'gemini', 'android_system', 'azure']);

    const [catalog, concurrentCatalog] = await Promise.all([
      piperTtsProvider.listVoices(),
      piperTtsProvider.listVoices(),
    ]);
    assert.deepEqual(concurrentCatalog, catalog);
    assert.equal(pluginCalls.filter((call) => call.method === 'listVoices').length, 1);
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

  test('supports SAF local ZIP model import, cancellation, deletion, and restoring bundled models', async () => {
    fakeAndroidPiperPlugin._cancelNextImport = true;
    const cancelledRes = await piperTtsProvider.importModelFromPicker();
    assert.equal(cancelledRes.cancelled, true);

    const importRes = await piperTtsProvider.importModelFromPicker();
    assert.equal(importRes.cancelled, false);
    assert.equal(importRes.imported.id, 'de_DE-miro-high');
    assert.match(importRes.imported.label, /импортирован.*NC/);
    clearPreviewAudioCache();
    assert.deepEqual(await piperTtsProvider.listVoices(), importRes.catalog);
    assert.equal(pluginCalls.some((call) => call.method === 'listVoices'), false);
    // Commercial-safe Thorsten remains auto-default ahead of NC Miro
    assert.equal(getDefaultStandaloneVoice('piper', 'de', importRes.catalog.voices), 'piper:de_DE-thorsten-high');

    await piperTtsProvider.cancelModelImport();
    assert.equal(pluginCalls.some((c) => c.method === 'cancelModelImport'), true);

    const delRes = await piperTtsProvider.deleteModel('de_DE-kerstin-medium');
    assert.equal(delRes.deletedModelId, 'de_DE-kerstin-medium');
    assert.equal(delRes.catalog.canRestoreBundled, true);

    const restoreRes = await piperTtsProvider.restoreBundledModels();
    assert.equal(restoreRes.restoredCount, 1);
    assert.equal(restoreRes.catalog.canRestoreBundled, false);
    assert.equal(restoreRes.catalog.voices.length, 2);

    // Foreign-provider or uninstalled voice specs never hijack active Piper provider
    assert.equal(
      resolveValidStandaloneVoice('piper', 'de', 'gemini:Puck', [], restoreRes.catalog.voices),
      'piper:de_DE-thorsten-high',
    );
    assert.equal(
      resolveValidStandaloneVoice('piper', 'de', 'piper:de_DE-deleted-model', [], restoreRes.catalog.voices),
      'piper:de_DE-thorsten-high',
    );
  });

  test('stores one Android media and TTS row for concurrent requests, checks and repairs the on-disk digest', async () => {
    memStorage.set(STANDALONE_SETTINGS_KEYS.ttsProvider, 'piper');
    const assets = mockNativeMedia();
    const { voices: [model] } = await piperTtsProvider.listVoices();
    const options = { text: 'Guten Tag', lang: 'de', rate: '+0%', voice: `piper:${model.id}` };
    const getAudio = () => standaloneAiTtsApi.handle('/media/study-local-audio', options);
    const [first, second] = await Promise.all([getAudio(), getAudio()]);
    assert.equal(second.data.path, first.data.path);
    assert.equal(pluginCalls.filter(({ method }) => method === 'synthesizeToWav').length, 1);
    const database = await prepareLocalDb();
    const key = computeTtsCacheKey({ textNorm: options.text, lang: options.lang, rate: options.rate,
      provider: 'piper', voice: model.id, model: model.sha256 || String(model.sizeBytes || '') });
    const getCacheRow = nativeDb.prepare('SELECT * FROM tts_cache WHERE cache_key = ?');
    assert.equal(getCacheRow.get(key).media_sha256, first.data.sha256);
    assert.equal(getCacheRow.get(key).text_norm, options.text);
    assert.equal(await database.syncState.where('key').startsWith('tts_study_cache:').count(), 0);
    assert.equal(await database.syncState.where('key').startsWith('offline-media:').count(), 0);
    nativeDb.exec("UPDATE tts_cache SET last_used_at = '2000-01-01'");
    assert.equal((await getAudio()).data.cached, true);
    assert.notEqual(getCacheRow.get(key).last_used_at, '2000-01-01');

    assets.values().next().value.bytes[20] ^= 1;
    const retried = await getAudio();
    assert.equal(retried.data.cached, false);
    assert.equal(retried.data.sha256, first.data.sha256);
    assert.equal(pluginCalls.filter(({ method }) => method === 'synthesizeToWav').length, 2);
    assert.equal((await getAudio()).data.cached, true);

    assets.clear();
    assert.equal((await getAudio()).data.cached, false);
    assert.equal(nativeDb.prepare('SELECT count(*) AS count FROM media_assets').get().count, 1);
  });

  test('adopts both legacy cache key formats without re-synthesis', async () => {
    mockNativeMedia();
    const database = await prepareLocalDb();
    const { voices: [model] } = await piperTtsProvider.listVoices();
    const modelKey = model.sha256 || String(model.sizeBytes || '');
    for (const text of ['Hallo', 'Guten Tag']) {
      const options = { text, lang: 'de', rate: '+0%', voice: `piper:${model.id}` };
      const getAudio = () => standaloneAiTtsApi.handle('/media/study-local-audio', options);
      const { data: saved } = await getAudio();
      const key = computeTtsCacheKey({ textNorm: text, lang: 'de', rate: '+0%', provider: 'piper', voice: model.id, model: modelKey });
      const legacyHash = text === 'Hallo' ? key : sha256Hex(`lerne-study-tts-v1|piper|${model.id}|${modelKey}|de|+0%|${text}`);
      const legacyKey = `tts_study_cache:${legacyHash}`;
      nativeDb.exec('DELETE FROM media_assets');
      await database.syncState.put({ key: legacyKey, path: saved.path, sha256: saved.sha256 });
      assert.equal((await getAudio()).data.cached, true);
      assert.equal(nativeDb.prepare('SELECT cache_key FROM tts_cache').get().cache_key, key);
      assert.equal(await database.syncState.get(legacyKey), undefined);
    }
    assert.equal(pluginCalls.filter(({ method }) => method === 'synthesizeToWav').length, 2);
  });

  test('rolls back the asset and TTS rows together and reuses the file on retry', async () => {
    const assets = mockNativeMedia();
    await openNativeMediaDb();
    nativeDb.exec(`CREATE TEMP TRIGGER simulate_cache_error BEFORE INSERT ON tts_cache
      BEGIN SELECT RAISE(ABORT, 'cache write failed'); END`);
    const getAudio = () => standaloneAiTtsApi.handle('/media/study-local-audio', { text: 'Hallo', lang: 'de' });
    try {
      await assert.rejects(getAudio, /cache write failed/);
      assert.equal(assets.size, 1);
      assert.equal(nativeDb.prepare('SELECT sha256 FROM media_assets').get(), undefined);
      assert.equal(nativeDb.prepare('SELECT cache_key FROM tts_cache').get(), undefined);
    } finally {
      nativeDb.exec('DROP TRIGGER simulate_cache_error');
    }
    assert.equal((await getAudio()).data.cached, false);
    assert.equal((await getAudio()).data.cached, true);
    assert.equal(assets.size, 1);
  });

  test('bounds the Android TTS index by last use while retaining media files', async () => {
    const assets = mockNativeMedia();
    const getAudio = text => standaloneAiTtsApi.handle('/media/study-local-audio', { text, lang: 'de' });
    const { data } = await getAudio('Hallo');
    nativeDb.prepare(`WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM ids WHERE n < 399)
      INSERT INTO tts_cache (cache_key, media_sha256, provider, voice, lang, text_norm, created_at, last_used_at)
      SELECT printf('%064x', n), ?, 'piper', 'default', 'de', 'Test', '2000-01-01', '2000-01-01' FROM ids`).run(data.sha256);
    await getAudio('Guten Tag');
    assert.equal(nativeDb.prepare('SELECT count(*) AS count FROM tts_cache').get().count, 400);
    assert.equal(nativeDb.prepare('SELECT cache_key FROM tts_cache WHERE cache_key = ?').get('1'.padStart(64, '0')), undefined);
    assert.equal((await getAudio('Hallo')).data.cached, true);
    assert.equal(assets.size, 1);
  });

  test('protects hidden answers across all 9 Native V2 card types and caches on-demand study audio without mutating read-only cards or calling paid APIs', async () => {
    memStorage.set(STANDALONE_SETTINGS_KEYS.ttsProvider, 'piper');

    // 1. Pedagogical speakable text across all 9 Native V2 card types
    assert.equal(
      getStudySpeakableText({ type: 'standard', data: { prompt: '**der Bahnhof**', answer: 'вокзал' } }, 'front'),
      'der Bahnhof',
    );
    assert.equal(
      getStudySpeakableText({ type: 'theory', data: { text: '# Perfekt\nHilfsverb `haben` oder `sein`.', summary: 'Кратко' } }, 'front'),
      'Perfekt Hilfsverb haben oder sein.',
    );
    assert.equal(
      getStudySpeakableText({
        type: 'quiz',
        data: { prompt: 'Welcher Artikel passt zu Haus?', options: [{ text: 'das', correct: true }, { text: 'der', correct: false }] },
      }, 'front'),
      'Welcher Artikel passt zu Haus?',
    );
    assert.equal(
      getStudySpeakableText({ type: 'free_text', data: { prompt: 'Beschreiben Sie Ihren Tag.', sample_answer: 'Ich stehe früh auf.' } }, 'front'),
      'Beschreiben Sie Ihren Tag.',
    );
    assert.equal(
      getStudySpeakableText({ type: 'editable_text', data: { source_text: 'Ich gehen nach Hause.', correct_text: 'Ich gehe nach Hause.' } }, 'front'),
      'Ich gehen nach Hause.',
    );

    const trainerCard = {
      type: 'trainer',
      data: {
        parts: [
          { type: 'text', text: 'Ich ' },
          { type: 'input', answers: ['fahre'] },
          { type: 'text', text: ' nach Berlin.' },
        ],
        back_note: 'Я еду в Берлин.',
      },
    };
    const wordBankCard = {
      type: 'word_bank',
      data: {
        parts: [{ type: 'text', text: 'Wir lernen ' }, { type: 'gap', option: 0 }],
        options: ['Deutsch', 'Englisch'],
      },
    };
    const puzzleCard = {
      type: 'puzzle',
      data: { tokens: ['Heute', 'scheint', 'die', 'Sonne'], translation: 'Сегодня светит солнце' },
    };
    const matchCard = {
      type: 'match',
      data: { pairs: [{ left: 'der Hund', right: 'собака' }] },
    };

    for (const hiddenExercise of [trainerCard, wordBankCard, puzzleCard, matchCard]) {
      assert.equal(
        getStudySpeakableText(hiddenExercise, 'front', { isFlipped: false, answerRevealed: false }),
        '',
        `Unrevealed ${hiddenExercise.type} must never dictate answers prematurely`,
      );
    }

    assert.equal(
      getStudySpeakableText(trainerCard, 'front', { isFlipped: false, answerRevealed: true }),
      'Ich fahre nach Berlin.',
    );
    assert.equal(
      getStudySpeakableText(wordBankCard, 'front', { isFlipped: true, answerRevealed: false }),
      'Wir lernen Deutsch',
    );
    assert.equal(
      getStudySpeakableText(puzzleCard, 'front', { isFlipped: false, answerRevealed: true }),
      'Heute scheint die Sonne',
    );
    assert.equal(
      getStudySpeakableText(matchCard, 'front', { isFlipped: true, answerRevealed: true }),
      'der Hund - собака',
    );
    assert.equal(
      getStudySpeakableText(matchCard, 'front', { isFlipped: true, answerRevealed: true, lang: 'de' }),
      'der Hund',
    );
    const mixedCyrillicTheoryCard = {
      type: 'theory',
      data: {
        text: 'В предложении с модальным глаголом (können, müssen) спрягаемый глагол стоит на 2-м месте. Пример: Ich muss heute einen Brief schreiben.',
        summary: 'Модальные глаголы',
      },
    };
    assert.equal(
      getStudySpeakableText(mixedCyrillicTheoryCard, 'front', { lang: 'de' }),
      'können, müssen. Ich muss heute einen Brief schreiben.',
    );
    assert.equal(
      getStudySpeakableText(
        { type: 'standard', data: { prompt: 'Только русский текст без немецких слов', answer: 'ответ' } },
        'front',
        { lang: 'de' },
      ),
      '',
    );

    // 2. Read-only seed card is NOT mutated by on-demand study playback, and second playback hits cache (0 synthesis)
    const db = await prepareLocalDb();
    await db.cards.put({
      id: 9901,
      deck_id: 9101, // built-in read-only seed deck
      position: 0,
      target_language: 'de',
      revision: 1,
      content_v2: {
        schema_version: 2,
        card: { type: 'standard', data: { prompt: 'Guten Morgen, wie geht es dir?', answer: 'Доброе утро' }, info: [], explanation: '' },
      },
      is_deleted: 0,
    });

    pluginCalls.length = 0;
    const firstPlay = await standaloneAiTtsApi.handle('/media/study-local-audio', {
      text: 'Guten Morgen, wie geht es dir?',
      lang: 'de',
      side: 'front',
      rate: '+0%',
    });
    assert.equal(firstPlay.data.cached, false);
    assert.match(firstPlay.data.path, /^\/api\/media\/audio\/archive_[a-f0-9]{64}\.wav$/);
    const synthCountAfterFirst = pluginCalls.filter((c) => c.method === 'synthesizeToWav').length;
    assert.equal(synthCountAfterFirst, 1);

    const untouchedSeedCard = await db.cards.get(9901);
    assert.equal(untouchedSeedCard.audio_path, undefined);
    assert.equal(untouchedSeedCard.revision, 1);
    assert.equal(untouchedSeedCard.standalone_local_edit, undefined);

    const secondPlay = await standaloneAiTtsApi.handle('/media/study-local-audio', {
      text: 'Guten Morgen, wie geht es dir?',
      lang: 'de',
      side: 'front',
      rate: '+0%',
    });
    assert.equal(secondPlay.data.cached, true);
    assert.equal(secondPlay.data.path, firstPlay.data.path);
    assert.equal(
      pluginCalls.filter((c) => c.method === 'synthesizeToWav').length,
      1,
      'Cached study audio must reuse stored SHA-256 media with 0 re-synthesis calls',
    );

    // Editing text or changing voice invalidates lookup key and synthesizes fresh audio
    const editedPlay = await standaloneAiTtsApi.handle('/media/study-local-audio', {
      text: 'Guten Abend, bis morgen!',
      lang: 'de',
      side: 'front',
      rate: '+0%',
    });
    assert.equal(editedPlay.data.cached, false);
    assert.equal(pluginCalls.filter((c) => c.method === 'synthesizeToWav').length, 2);

    // 3. Target-language back answers (free_text / editable_text) & read-only deck 403 guard
    assert.equal(isTargetLanguageCardSide({ type: 'standard' }, 'back'), false);
    assert.equal(isTargetLanguageCardSide({ type: 'free_text' }, 'back'), true);
    assert.equal(isTargetLanguageCardSide({ type: 'editable_text' }, 'back'), true);

    await db.decks.put({
      id: 9101,
      name: 'Built-in Seed Deck',
      target_language: 'de',
      is_builtin: true,
      is_global_readonly: true,
      is_deleted: 0,
    });
    await assert.rejects(
      () => standaloneAiTtsApi.handle('/media/generate-card-audio', {
        card_id: 9901,
        side: 'front',
        voice: 'piper:de_DE-thorsten-high',
      }),
      (err) => err?.response?.status === 403,
    );

    // 4. Paid/cloud providers (Gemini / Azure) are NEVER auto-triggered for missing study audio
    memStorage.set(STANDALONE_SETTINGS_KEYS.ttsProvider, 'gemini');
    assert.equal(canUseLocalOfflineTtsForLang('de'), false);
    await assert.rejects(
      () => standaloneAiTtsApi.handle('/media/study-local-audio', { text: 'Test', lang: 'de' }),
      /локальных офлайн-провайдеров TTS/,
    );
  });
});
