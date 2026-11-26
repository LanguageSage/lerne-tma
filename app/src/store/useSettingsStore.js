import { create } from 'zustand';
import { setInterfaceLanguage, normalizeInterfaceLanguage } from '../i18n/locale.js';
import { storage, getUserId } from '../utils/auth.js';
import api, { networkApi } from '../services/api.js';
import { openPersonalDesignRecord, readPersonalDesignRecord, savePersonalDesignRecord,
  reconcilePersonalDesign, editPersonalDesign, acknowledgePersonalDesign, resolveActiveDesign,
  isPersonalDesignDocument, isPersonalDesignActive } from '../design/personalDesignMigration.js';
import { AUTOPLAY_DEFAULTS, AUTOPLAY_VERSION, normalizeAutoplaySettings } from '../utils/autoplaySequence.js';
import { normalizeDesignConfig, DEFAULT_DESIGN_CONFIG_V2, patchDesignValue } from '../design/designConfig.js';
import { applyPublishedDesignTokens } from '../design/designTokens.js';
import { IS_STANDALONE } from '../utils/standaloneMode.js';
import {
  DEFAULT_STANDALONE_GEMINI_TTS_MODEL,
  STANDALONE_SETTINGS_KEYS,
  readStandaloneAiModels,
  readStandaloneAiProvider,
  readStandaloneAndroidTtsEngine,
  readStandaloneAzureRegion,
  readStandaloneGeminiTtsModel,
  readStandaloneTtsProvider,
} from '../pilot/standaloneSettings.js';

// ─── Design V2 localStorage cache (offline fallback) ──────────────────────────
const DESIGN_V2_CACHE_KEY = 'lerne:published-design:v2';

function loadCachedPublishedDesign() {
  try {
    const raw = storage.get(DESIGN_V2_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.config) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCachedPublishedDesign(doc) {
  try {
    if (doc && doc.config) {
      storage.set(DESIGN_V2_CACHE_KEY, JSON.stringify(doc));
    } else {
      storage.remove(DESIGN_V2_CACHE_KEY);
    }
  } catch { /* quota exceeded — silently ignore */ }
}

// Open the account-scoped V2 document.
let initialPersonalRecord = null;
let initialMigrationError = null;
try { initialPersonalRecord = openPersonalDesignRecord(getUserId()); }
catch (error) { initialMigrationError = error.message; }
const initialPublishedDesign = loadCachedPublishedDesign();
const initialActiveDesign = resolveActiveDesign({ personalDesignV2: initialPersonalRecord?.document,
  publishedDesignV2: initialPublishedDesign, designEditorDraft: null, designPreviewInApp: false });
applyPublishedDesignTokens(initialActiveDesign ?? DEFAULT_DESIGN_CONFIG_V2);

export const AUTOPLAY_STORAGE_MAP = Object.fromEntries(
  Object.keys(AUTOPLAY_DEFAULTS).map(key => [key, `lerne_auto_v2_${key}`]),
);

const getInitialAutoplaySettings = () => {
  const saved = {};
  for (const [key, storageKey] of Object.entries(AUTOPLAY_STORAGE_MAP)) {
    const value = storage.get(storageKey);
    if (value !== null) saved[key] = value;
  }
  const settings = Number(saved.autoplayVersion) === AUTOPLAY_VERSION
    ? normalizeAutoplaySettings(saved) : { ...AUTOPLAY_DEFAULTS };
  for (const [key, value] of Object.entries(settings)) storage.set(AUTOPLAY_STORAGE_MAP[key], value);
  return settings;
};

export const STUDY_STORAGE_MAP = {
  ...AUTOPLAY_STORAGE_MAP,
  autoPlay: 'lerne_autoplay',
  autoShow: 'lerne_autoshow',
  ttsSpeed: 'lerne_tts_speed',
  ttsSpeedRu: 'lerne_tts_speed_ru',
  ttsVoices: 'lerne_tts_voices',
  alwaysRegenerateAudio: 'lerne_always_regenerate_audio',
  autoGenerateCardAudio: 'lerne_auto_generate_card_audio',
  studyMode: 'lerne_study_mode',
  speechMatchThreshold: 'lerne_speech_match_threshold',
  speechFollowupEnabled: 'lerne_speech_followup_enabled',
  gradeSoundEnabled: 'lerne_grade_sound_enabled',
  voiceBack: 'lerne_voice_back',
  randomEnabledModes: 'lerne_random_enabled_modes',
  srsExtendedGrades: 'lerne_srs_extended_grades',
  playerCollapsed: 'lerne_player_collapsed',
  gradingCollapsed: 'lerne_grading_collapsed',
  showLessonCompletion: 'lerne_show_lesson_completion',
  showCompletionCelebration: 'lerne_show_completion_celebration',
};

export const collectUserSettings = (state) => {
  const settings = {};
  Object.keys(STUDY_STORAGE_MAP).forEach((k) => {
    if (state[k] !== undefined) settings[k] = state[k];
  });
  const account = getUserId();
  const record = account != null ? readPersonalDesignRecord(account) : null;
  if (state.personalDesignV2 && (record?.edited || state.personalDesignV2.revision > 0 || state.personalDesignV2.enabled === true)) {
    settings.designV2 = state.personalDesignV2;
  }
  const nativeLang = storage.get('native_language');
  if (nativeLang) {
    settings.native_language = nativeLang;
  }
  return settings;
};

const SETTINGS_RECHECK_MS = 60_000;
let saveTimer = null;
let settingsGeneration = 0;
let settingsWrite = null;
let settingsFetch = null;
let confirmedSettings = null;
let pendingStudyWrite = null;
let studyMutationSeq = 0;

const hasPendingStudyWrite = (account) => Boolean(
  account && pendingStudyWrite?.account === account && pendingStudyWrite?.generation === settingsGeneration
);

const clearPendingStudyWrite = (account, generation, seq = studyMutationSeq) => {
  if (
    pendingStudyWrite?.account === account
    && pendingStudyWrite?.generation === generation
    && studyMutationSeq === seq
  ) {
    pendingStudyWrite = null;
  }
};

const sameSettingValue = (a, b) => {
  if (Object.is(a, b)) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameSettingValue(item, b[index]));
  }
  const keysA = Object.keys(a).filter((key) => a[key] !== undefined);
  const keysB = Object.keys(b).filter((key) => b[key] !== undefined);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && sameSettingValue(a[key], b[key]));
};

const hasUnsavedSettingValues = (payload, serverData, designPending = false) => {
  if (designPending) return true;
  if (!serverData || typeof serverData !== 'object' || Array.isArray(serverData)) return true;
  for (const [key, value] of Object.entries(payload || {})) {
    if (value === undefined) continue;
    if (key === 'designV2') {
      if (!serverData.designV2 && value) return true;
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(serverData, key) || !sameSettingValue(value, serverData[key])) {
      return true;
    }
  }
  return false;
};

export const debouncedSaveSettings = (get, options = {}) => {
  if (IS_STANDALONE) return;
  if (saveTimer) clearTimeout(saveTimer);
  const account = getUserId(), generation = settingsGeneration;
  if (account && options.study !== false) {
    studyMutationSeq++;
    pendingStudyWrite = { account, generation };
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (account !== getUserId() || generation !== settingsGeneration) return;
    get().saveCurrentSettingsToServer();
  }, 1000);
};

const getStoredTtsVoices = () => {
  try {
    const value = storage.get('lerne_tts_voices');
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
};

const getInitialStudyState = () => ({
  ...getInitialAutoplaySettings(),
  autoPlay: storage.get('lerne_autoplay') !== null ? storage.get('lerne_autoplay') === 'true' : false,
  autoShow: storage.get('lerne_autoshow') !== null ? storage.get('lerne_autoshow') === 'true' : false,
  ttsSpeed: storage.get('lerne_tts_speed') !== null ? Number(storage.get('lerne_tts_speed')) : 0,
  ttsSpeedRu: storage.get('lerne_tts_speed_ru') !== null ? Number(storage.get('lerne_tts_speed_ru')) : 0,
  ttsVoices: getStoredTtsVoices(),
  alwaysRegenerateAudio: storage.get('lerne_always_regenerate_audio') === 'true',
  autoGenerateCardAudio: storage.get('lerne_auto_generate_card_audio') !== 'false',
  studyMode: (storage.get('lerne_study_mode') && storage.get('lerne_study_mode') !== 'turbo') ? storage.get('lerne_study_mode') : 'classic',
  speechMatchThreshold: storage.get('lerne_speech_match_threshold') !== null ? Number(storage.get('lerne_speech_match_threshold')) : 75,
  speechFollowupEnabled: storage.get('lerne_speech_followup_enabled') === 'true',
  gradeSoundEnabled: storage.get('lerne_grade_sound_enabled') !== 'false',
  voiceBack: storage.get('lerne_voice_back') || '',
  randomEnabledModes: storage.get('lerne_random_enabled_modes')
    ? JSON.parse(storage.get('lerne_random_enabled_modes')).filter(m => m !== 'turbo')
    : ['classic', 'reverse', 'cloze', 'puzzle', 'speak'],
  srsExtendedGrades: storage.get('lerne_srs_extended_grades') !== null ? storage.get('lerne_srs_extended_grades') === 'true' : false,
  playerCollapsed: storage.get('lerne_player_collapsed') !== 'false',
  gradingCollapsed: storage.get('lerne_grading_collapsed') === 'true',
  showLessonCompletion: storage.get('lerne_show_lesson_completion') !== 'false',
  showCompletionCelebration: storage.get('lerne_show_completion_celebration') !== 'false',
  isAdmin: false,
  standaloneAiProvider: readStandaloneAiProvider(),
  standaloneAiModels: readStandaloneAiModels(),
  standaloneTtsProvider: readStandaloneTtsProvider(),
  standaloneGeminiTtsModel: readStandaloneGeminiTtsModel(),
  standaloneAzureRegion: readStandaloneAzureRegion(),
  standaloneAndroidTtsEngine: readStandaloneAndroidTtsEngine(),
});

export const useSettingsStore = create((set, get) => {
  return {
    // --- Study Settings ---
    ...getInitialStudyState(),
    setGradeSoundEnabled: (value) => {
      const enabled = Boolean(value);
      storage.set('lerne_grade_sound_enabled', enabled);
      set({ gradeSoundEnabled: enabled });
      debouncedSaveSettings(get);
    },
    setPlayerCollapsed: (value) => {
      storage.set('lerne_player_collapsed', value);
      set({ playerCollapsed: value });
      debouncedSaveSettings(get);
    },
    setGradingCollapsed: (value) => {
      storage.set('lerne_grading_collapsed', value);
      set({ gradingCollapsed: value });
      debouncedSaveSettings(get);
    },
    setShowLessonCompletion: (value) => {
      const enabled = Boolean(value);
      storage.set('lerne_show_lesson_completion', String(enabled));
      set({ showLessonCompletion: enabled });
      debouncedSaveSettings(get);
    },
    setShowCompletionCelebration: (value) => {
      const enabled = Boolean(value);
      storage.set('lerne_show_completion_celebration', String(enabled));
      set({ showCompletionCelebration: enabled });
      debouncedSaveSettings(get);
    },
    setSpeechMatchThreshold: (value) => {
      storage.set('lerne_speech_match_threshold', value);
      set({ speechMatchThreshold: Number(value) });
      debouncedSaveSettings(get);
    },
    setSpeechFollowupEnabled: (value) => {
      const enabled = Boolean(value);
      storage.set('lerne_speech_followup_enabled', enabled);
      set({ speechFollowupEnabled: enabled });
      debouncedSaveSettings(get);
    },
    setStudyMode: (value) => {
      storage.set('lerne_study_mode', value);
      set({ studyMode: value });
      debouncedSaveSettings(get);
    },
    setRandomEnabledModes: (modes) => {
      storage.set('lerne_random_enabled_modes', JSON.stringify(modes));
      set({ randomEnabledModes: modes });
      debouncedSaveSettings(get);
    },
    setAutoPlay: (value) => {
      storage.set('lerne_autoplay', value);
      set({ autoPlay: value });
      debouncedSaveSettings(get);
    },
    setAutoShow: (value) => {
      storage.set('lerne_autoshow', value);
      set({ autoShow: value });
      debouncedSaveSettings(get);
    },
    setAutoplaySettings: (patch) => {
      const settings = normalizeAutoplaySettings({ ...get(), ...patch });
      for (const [key, value] of Object.entries(settings)) storage.set(AUTOPLAY_STORAGE_MAP[key], value);
      set(settings);
      debouncedSaveSettings(get);
    },
    setTtsSpeed: (value) => {
      storage.set('lerne_tts_speed', value);
      set({ ttsSpeed: Number(value) });
      debouncedSaveSettings(get);
    },
    setTtsSpeedRu: (value) => {
      storage.set('lerne_tts_speed_ru', value);
      set({ ttsSpeedRu: Number(value) });
      debouncedSaveSettings(get);
    },
    setTtsVoice: (lang, voice) => {
      const code = (lang || 'de').toLowerCase().replace('_', '-').split('-')[0];
      const nextVoices = { ...get().ttsVoices, [code]: voice };
      storage.set('lerne_tts_voices', JSON.stringify(nextVoices));
      set({ ttsVoices: nextVoices });
      debouncedSaveSettings(get);
    },
    setAlwaysRegenerateAudio: (value) => {
      storage.set('lerne_always_regenerate_audio', value);
      set({ alwaysRegenerateAudio: Boolean(value) });
      debouncedSaveSettings(get);
    },
    setAutoGenerateCardAudio: (value) => {
      storage.set('lerne_auto_generate_card_audio', value);
      set({ autoGenerateCardAudio: Boolean(value) });
      debouncedSaveSettings(get);
    },
    setVoiceBack: (value) => {
      storage.set('lerne_voice_back', value);
      set({ voiceBack: value });
      debouncedSaveSettings(get);
    },
    setSrsExtendedGrades: (value) => {
      storage.set('lerne_srs_extended_grades', value);
      set({ srsExtendedGrades: Boolean(value) });
      debouncedSaveSettings(get);
    },
    setStandaloneAiProvider: (provider) => {
      const clean = String(provider || 'gemini').trim().toLowerCase();
      storage.set(STANDALONE_SETTINGS_KEYS.aiProvider, clean);
      set({ standaloneAiProvider: clean });
    },
    setStandaloneAiModel: (provider, model) => {
      const prov = String(provider || 'gemini').trim().toLowerCase();
      const nextModels = { ...get().standaloneAiModels, [prov]: String(model || '').trim() };
      storage.set(STANDALONE_SETTINGS_KEYS.aiModels, JSON.stringify(nextModels));
      set({ standaloneAiModels: nextModels });
    },
    setStandaloneTtsProvider: (provider) => {
      const clean = String(provider || 'gemini').trim().toLowerCase();
      storage.set(STANDALONE_SETTINGS_KEYS.ttsProvider, clean);
      set({ standaloneTtsProvider: clean });
    },
    setStandaloneGeminiTtsModel: (model) => {
      const clean = String(model || DEFAULT_STANDALONE_GEMINI_TTS_MODEL).trim();
      storage.set(STANDALONE_SETTINGS_KEYS.geminiTtsModel, clean);
      set({ standaloneGeminiTtsModel: clean });
    },
    setStandaloneAzureRegion: (region) => {
      const clean = String(region || '').trim().toLowerCase();
      storage.set(STANDALONE_SETTINGS_KEYS.azureRegion, clean);
      set({ standaloneAzureRegion: clean });
    },
    setStandaloneAndroidTtsEngine: (engine) => {
      const clean = String(engine || '').trim();
      storage.set(STANDALONE_SETTINGS_KEYS.androidTtsEngine, clean);
      set({ standaloneAndroidTtsEngine: clean });
    },

    // --- Design Settings & Setters ---
    personalDesignV2: initialPersonalRecord?.document ?? null,
    designAccountId: getUserId(),
    designMigrationError: initialMigrationError,
    activeDesignConfig: initialActiveDesign,

    activateSettingsAccount: () => {
      const isAdmin = get().designAccountId === getUserId() && get().isAdmin;
      settingsGeneration++;
      confirmedSettings = null;
      pendingStudyWrite = null;
      settingsFetch = null;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      try {
        const record = openPersonalDesignRecord(getUserId());
        set({ personalDesignV2: record?.document ?? null,
          designAccountId: getUserId(), designMigrationError: null, isAdmin,
          designEditorDraft: null, designEditorBase: null, designPreviewInApp: false, designPreviewDismissed: false });
      } catch (error) {
        set({ personalDesignV2: null,
          designAccountId: getUserId(), designMigrationError: error.message,
          designEditorDraft: null, designEditorBase: null, designPreviewInApp: false, designPreviewDismissed: false, isAdmin: false });
      }
    },

    setPersonalDesignV2: (config, preset) => {
      if (get().designAccountId !== getUserId()) get().activateSettingsAccount();
      const record = openPersonalDesignRecord(getUserId());
      if (!record) throw new Error('Personal design not initialized');
      const next = savePersonalDesignRecord(editPersonalDesign(record, config, preset));
      set({ personalDesignV2: next.document, designMigrationError: null });
      debouncedSaveSettings(get);
    },

    syncUserSettingsFromServer: (serverSettings) => {
      if (!serverSettings || typeof serverSettings !== 'object' || Array.isArray(serverSettings)) return;
      if (get().designAccountId !== getUserId()) get().activateSettingsAccount();
      const account = getUserId();
      try {
        const record = openPersonalDesignRecord(account);
        if (record) {
          const next = savePersonalDesignRecord(reconcilePersonalDesign(record, serverSettings));
          set({ personalDesignV2: next.document, designMigrationError: null });
          if (next.pending) debouncedSaveSettings(get, { study: false });
        }
      } catch (error) { set({ designMigrationError: error.message }); }
      if (account) {
        confirmedSettings = { account, generation: settingsGeneration, syncedAt: Date.now(), serverData: serverSettings };
      }
      if (hasPendingStudyWrite(account)) {
        debouncedSaveSettings(get);
        return;
      }

      const migrateAutoplay = Number(serverSettings.autoplayVersion) !== AUTOPLAY_VERSION;
      // Old clients/server snapshots must not overwrite the new settings after migration.
      const autoplay = migrateAutoplay
        ? normalizeAutoplaySettings(get()) : normalizeAutoplaySettings(serverSettings);
      serverSettings = { ...serverSettings, ...autoplay };
      const updates = {};

      // Apply study/SRS settings
      Object.entries(STUDY_STORAGE_MAP).forEach(([stateKey, storageKey]) => {
        if (serverSettings[stateKey] !== undefined) {
          const val = serverSettings[stateKey];
          if (typeof val === 'boolean') {
            storage.set(storageKey, String(val));
          } else if (typeof val === 'number') {
            storage.set(storageKey, String(val));
          } else if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
            storage.set(storageKey, JSON.stringify(val));
          } else {
            storage.set(storageKey, val);
          }
          updates[stateKey] = val;
        }
      });

      // Sync native interface language if present and changed
      if (serverSettings.native_language) {
        const currentLang = storage.get('native_language');
        if (currentLang !== serverSettings.native_language) {
          const lang = normalizeInterfaceLanguage(serverSettings.native_language);
          if (lang) {
            setInterfaceLanguage(lang);
            storage.set('native_language', lang);
            storage.set('native_language_selected', 'true');
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        set(updates);
      }
      if (migrateAutoplay) debouncedSaveSettings(get);
    },

    hasPendingSettingsSync: (account = getUserId()) => {
      if (!account) return false;
      if (hasPendingStudyWrite(account)) return true;
      if (saveTimer !== null && account === getUserId()) return true;
      const record = readPersonalDesignRecord(account);
      return Boolean(record?.pending && (record?.serverSeen || record?.edited));
    },

    hasFreshSettings: (maxAgeMs = SETTINGS_RECHECK_MS, account = getUserId()) => {
      if (!account || !(maxAgeMs > 0) || !confirmedSettings) return false;
      return (
        confirmedSettings.account === account
        && confirmedSettings.generation === settingsGeneration
        && (Date.now() - confirmedSettings.syncedAt) < maxAgeMs
      );
    },

    saveCurrentSettingsToServer: () => {
      if (IS_STANDALONE) return Promise.resolve(false);
      const account = getUserId(), generation = settingsGeneration;
      if (settingsWrite?.generation === generation) return settingsWrite.promise;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      const operation = { generation };
      operation.promise = (async () => {
        const current = () => account === getUserId() && generation === settingsGeneration;
        if (!account) return false;
        try {
          // Fetch before first write/retry: server settings retain their existing precedence.
          const response = await networkApi.get('/user/settings', { _expectedUserId: account });
          if (!current()) return false;
          if (response.data?._designMigrationVersion !== 1) throw new Error('Server does not support safe design migration');
          const record = openPersonalDesignRecord(account);
          if (!record) return false;
          const reconciled = savePersonalDesignRecord(reconcilePersonalDesign(record, response.data));
          set({ personalDesignV2: reconciled.document });
          const sent = structuredClone(reconciled.document);
          const seqBeforeEval = studyMutationSeq;
          const payload = collectUserSettings(get());
          if (!hasUnsavedSettingValues(payload, response.data, reconciled.pending)) {
            clearPendingStudyWrite(account, generation, seqBeforeEval);
            confirmedSettings = { account, generation, syncedAt: Date.now(), serverData: response.data };
            set({ designMigrationError: null });
            return true;
          }
          const result = await networkApi.post('/user/settings', payload, { _expectedUserId: account });
          if (!current()) return false;
          if (result.data?.designMigrationVersion !== 1) throw new Error('Server did not confirm safe design migration');
          const latest = readPersonalDesignRecord(account);
          const next = payload.designV2 !== undefined
            ? savePersonalDesignRecord(acknowledgePersonalDesign(latest, sent, result.data?.settings?.designV2))
            : latest;
          clearPendingStudyWrite(account, generation, seqBeforeEval);
          confirmedSettings = {
            account,
            generation,
            syncedAt: Date.now(),
            serverData: result.data?.settings ?? response.data,
          };
          set({ personalDesignV2: next.document, designMigrationError: null });
          if (next.pending) debouncedSaveSettings(get, { study: false });
          return true;
        } catch (error) {
          if (current()) set({ designMigrationError: error.message });
          // A CAS conflict keeps the local record pending. A subsequent read rebases it.
          return false;
        }
      })().finally(() => { if (settingsWrite === operation) settingsWrite = null; });
      settingsWrite = operation;
      return operation.promise;
    },

    fetchUserSettingsFromServer: async ({ force = false, maxAgeMs = 0 } = {}) => {
      if (IS_STANDALONE) return null;
      const account = getUserId(), generation = settingsGeneration;
      if (!account || saveTimer !== null || settingsWrite?.generation === generation) return null;
      if (!force && maxAgeMs > 0 && get().hasFreshSettings(maxAgeMs, account) && !get().hasPendingSettingsSync(account)) {
        return confirmedSettings.serverData;
      }
      if (settingsFetch?.account === account && settingsFetch?.generation === generation) {
        return settingsFetch.promise;
      }
      const operation = { account, generation, promise: null };
      operation.promise = (async () => {
        try {
          const res = await networkApi.get('/user/settings', { _expectedUserId: account });
          if (account !== getUserId() || generation !== settingsGeneration) return null;
          get().syncUserSettingsFromServer(res.data);
          return res.data;
        } catch {
          return null;
        } finally {
          if (settingsFetch === operation) settingsFetch = null;
        }
      })();
      settingsFetch = operation;
      return operation.promise;
    },

    syncUserSettingsIfNeeded: async ({ force = false, maxAgeMs = SETTINGS_RECHECK_MS } = {}) => {
      if (IS_STANDALONE) return null;
      const account = getUserId();
      if (!account) return null;
      if (get().hasPendingSettingsSync(account)) {
        return get().saveCurrentSettingsToServer();
      }
      return get().fetchUserSettingsFromServer({ force, maxAgeMs });
    },

    // --- Admin/API Settings (Fetched from Backend) ---
    adminSettings: {},
    setAdminSettings: (settings) => set({ adminSettings: settings }),
    updateAdminSetting: (key, value) => set((state) => ({ 
      adminSettings: { ...state.adminSettings, [key]: value } 
    })),

    userPrompts: { translation_prompt: '', context_prompt: '' },
    setUserPrompts: (prompts) => set({ userPrompts: prompts }),
    updateUserPrompt: (key, value) => set((state) => ({ 
      userPrompts: { ...state.userPrompts, [key]: value } 
    })),

    // --- Design Config V2 ────────────────────────────────────────────────────
    // publishedDesignV2: глобальный дизайн по умолчанию, применяется если не выбран личный.
    // designEditorDraft / designEditorBase / designPreviewInApp: временное состояние редактора в памяти (не пишется в БД/localStorage до явного сохранения).
    publishedDesignV2: initialPublishedDesign,
    designEditorDraft: null,
    designEditorBase: null,
    designPreviewInApp: false,
    designPreviewDismissed: false,

    /** Применяет опубликованный global design (из /init или /design/global).
     *  Сохраняет в localStorage-кеш и обновляет activeDesignConfig (если не включён личный дизайн). */
    setPublishedDesignV2: (serverDoc) => {
      // An explicit empty server document means no published design. Keep the
      // cache only on network failure, not after a confirmed empty response.
      const doc = serverDoc?.config
        ? { ...serverDoc, config: normalizeDesignConfig(serverDoc.config) } : null;
      saveCachedPublishedDesign(doc);
      set({ publishedDesignV2: doc });
    },

    hasUnsavedDesignChanges: () => {
      const { designEditorDraft, designEditorBase } = get();
      if (!designEditorDraft || !designEditorBase) return false;
      return !sameSettingValue(designEditorDraft, designEditorBase);
    },

    /** Инициализирует временное состояние редактора в памяти при его открытии. */
    initDesignEditor: () => {
      if (get().designEditorDraft) return;
      const personal = get().personalDesignV2;
      const source = isPersonalDesignActive(personal)
        ? personal.config
        : (get().publishedDesignV2?.config ?? null);
      const base = normalizeDesignConfig(source);
      set({
        designEditorBase: base,
        designEditorDraft: structuredClone(base),
        designPreviewInApp: false,
        designPreviewDismissed: false,
      });
    },

    /** Сбрасывает временное состояние редактора и отключает временный предпросмотр. */
    discardDesignEditor: () => {
      set({
        designEditorDraft: null,
        designEditorBase: null,
        designPreviewInApp: false,
        designPreviewDismissed: false,
      });
    },

    /** Переключает временный предпросмотр несохранённого дизайна на всём приложении (только в памяти). */
    toggleDesignPreviewInApp: () => {
      const next = !get().designPreviewInApp;
      set({ designPreviewInApp: next, designPreviewDismissed: !next });
      return next;
    },

    /** Обновляет временный черновик в памяти (без записи в localStorage/БД). */
    commitDesignEditorDraft: (config, { autoPreview = true } = {}) => {
      const normalized = normalizeDesignConfig(config);
      const nextPreview = autoPreview && !get().designPreviewDismissed ? true : get().designPreviewInApp;
      set({ designEditorDraft: normalized, designPreviewInApp: nextPreview });
    },

    /** Обновляет временный дизайн целиком (например, импорт JSON). */
    setDesignEditorDraft: (config, options) => get().commitDesignEditorDraft(config, options),

    /** Патчит одно поле во временном дизайне по dot-path. */
    patchDesignEditorDraft: (path, value) => {
      const current = get().designEditorDraft ?? get().designEditorBase ?? resolveActiveDesign(get());
      get().commitDesignEditorDraft(patchDesignValue(current, path, value));
    },

    /** Копирует из source только перечисленные разделы во временное состояние; возвращает прежнее для отмены. */
    applyDesignEditorSections: (source, sections) => {
      const previous = get().designEditorDraft ?? get().designEditorBase ?? resolveActiveDesign(get());
      const next = structuredClone(previous);
      const incoming = normalizeDesignConfig(source);
      for (const section of sections) {
        if (section in DEFAULT_DESIGN_CONFIG_V2 && section !== 'schemaVersion') next[section] = structuredClone(incoming[section]);
      }
      get().commitDesignEditorDraft(next);
      return previous;
    },

    /** Сбрасывает конкретную секцию во временном состоянии до defaults. */
    resetDesignEditorSection: (section) => {
      const current = get().designEditorDraft ?? get().designEditorBase ?? resolveActiveDesign(get());
      const targetSection = section === 'general' ? 'global' : section;
      if (!(targetSection in DEFAULT_DESIGN_CONFIG_V2) || targetSection === 'schemaVersion') return;
      get().commitDesignEditorDraft({ ...current, [targetSection]: JSON.parse(JSON.stringify(DEFAULT_DESIGN_CONFIG_V2[targetSection])) });
    },

    /** Сбрасывает несохранённые правки до исходного состояния при открытии редактора. */
    revertDesignEditorChanges: () => {
      const base = get().designEditorBase ?? normalizeDesignConfig(get().publishedDesignV2?.config ?? null);
      set({
        designEditorDraft: structuredClone(base),
        designPreviewInApp: false,
        designPreviewDismissed: false,
      });
    },

    /** Единая CAS-операция записи личного дизайна с защитой от гонок и 1 повтором при 409. */
    _commitPersonalDesignUpdate: async (buildCandidate, resolveEditorConfig, defaultError) => {
      const account = getUserId(), generation = settingsGeneration;
      if (!account) return { success: false, error: 'Authentication required' };
      const currentRecord = openPersonalDesignRecord(account);
      if (!currentRecord) return { success: false, error: 'Personal design unavailable' };
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (settingsWrite?.generation === generation) {
        await settingsWrite.promise.catch(() => {});
        if (account !== getUserId() || generation !== settingsGeneration) {
          return { success: false, error: 'Account changed' };
        }
      }

      const attemptWrite = async (docSource) => {
        const candidateDoc = buildCandidate(docSource);
        const seqBeforeEval = studyMutationSeq;
        const payload = { ...collectUserSettings(get()), designV2: candidateDoc };
        const result = await networkApi.post('/user/settings', payload, { _expectedUserId: account });
        if (account !== getUserId() || generation !== settingsGeneration) {
          return { success: false, error: 'Account changed' };
        }
        if (result.data?.designMigrationVersion !== 1 || !isPersonalDesignDocument(result.data?.settings?.designV2)) {
          return { success: false, error: defaultError };
        }
        const confirmed = result.data.settings.designV2;
        const nextRecord = savePersonalDesignRecord({
          ...currentRecord,
          pending: false,
          edited: false,
          serverSeen: true,
          document: structuredClone(confirmed),
          base: structuredClone(confirmed),
        });
        clearPendingStudyWrite(account, generation, seqBeforeEval);
        confirmedSettings = { account, generation, syncedAt: Date.now(), serverData: result.data.settings };
        const editorConfig = resolveEditorConfig(confirmed);
        set({
          personalDesignV2: nextRecord.document,
          designMigrationError: null,
          designEditorBase: editorConfig,
          designEditorDraft: structuredClone(editorConfig),
          designPreviewInApp: false,
          designPreviewDismissed: false,
        });
        return { success: true, doc: confirmed };
      };

      try {
        try {
          return await attemptWrite(openPersonalDesignRecord(account)?.document ?? currentRecord.document);
        } catch (error) {
          if (error?.response?.status !== 409) throw error;
          const fresh = await networkApi.get('/user/settings', { _expectedUserId: account });
          if (account !== getUserId() || generation !== settingsGeneration) {
            return { success: false, error: 'Account changed' };
          }
          if (fresh.data?._designMigrationVersion !== 1 || (fresh.data?.designV2 && !isPersonalDesignDocument(fresh.data.designV2))) {
            throw error;
          }
          return await attemptWrite(fresh.data?.designV2 ?? currentRecord.document);
        }
      } catch (e) {
        return { success: false, error: e?.response?.data?.detail || e.message || defaultError };
      }
    },

    /** Явное ручное сохранение личного дизайна (одна логическая операция с CAS-защитой ревизий).
     *  Не подтверждает успех и не фиксирует состояние до ответа сервера. */
    savePersonalDesignToServer: async (configInput = null, presetInput = undefined) => {
      const config = normalizeDesignConfig(configInput ?? get().designEditorDraft ?? resolveActiveDesign(get()));
      return get()._commitPersonalDesignUpdate(
        (docSource) => ({
          schemaVersion: 2,
          revision: docSource.revision ?? 0,
          config,
          preset: presetInput === undefined
            ? (docSource.preset ?? null)
            : (presetInput === null ? null : normalizeDesignConfig(presetInput)),
          enabled: true,
        }),
        (confirmed) => normalizeDesignConfig(confirmed.config),
        'Server did not confirm personal design',
      );
    },

    /** Переключает использование личного дизайна (true) или возврат к общему (false), сохраняя личный config/preset. */
    setPersonalDesignEnabled: async (enabled) => {
      const targetEnabled = Boolean(enabled);
      return get()._commitPersonalDesignUpdate(
        (docSource) => ({
          schemaVersion: 2,
          revision: docSource.revision ?? 0,
          config: normalizeDesignConfig(docSource.config),
          preset: docSource.preset === null ? null : normalizeDesignConfig(docSource.preset),
          enabled: targetEnabled,
        }),
        (confirmed) => targetEnabled
          ? normalizeDesignConfig(confirmed.config)
          : normalizeDesignConfig(get().publishedDesignV2?.config ?? null),
        'Server did not confirm design mode',
      );
    },

    /** Backend-authoritative setter для isAdmin. Вызывается из /init ответа. */
    setIsAdmin: (value) => {
      const isAdmin = Boolean(value);
      set({ isAdmin });
    },

    customBackgrounds: [],
    setCustomBackgrounds: (bgs) => set({ customBackgrounds: bgs }),


    // --- Bot Reminder Settings ---
    reminderSettings: {
      enabled: false,
      times: ['10:00', '19:00'],
      frequency: 'twice_daily',
      timezone: 'Europe/Berlin',
      timezone_offset: 3,
    },
    reminderDiagnostics: null,
    reminderLoading: false,
    reminderAccountId: null,

    fetchReminderSettings: async () => {
      const account = getUserId();
      try {
        set({ reminderLoading: true, reminderAccountId: null });
        const res = await api.get('/user/reminder-settings');
        if (res.data && getUserId() === account) {
          set({ reminderSettings: res.data, reminderAccountId: account });
        }
      } catch (err) {
        console.error('Fetch Reminder Settings Error:', err);
      } finally {
        if (getUserId() === account) set({ reminderLoading: false });
      }
    },

    fetchReminderDiagnostics: async () => {
      const account = getUserId();
      set({ reminderDiagnostics: null });
      try {
        const res = await api.get('/bot/reminder-diagnostics');
        if (res.data && getUserId() === account) {
          set({ reminderDiagnostics: res.data });
        }
        return res.data;
      } catch (err) {
        console.error('Fetch Reminder Diagnostics Error:', err);
        return null;
      }
    },

    saveReminderSettings: async (newSettings) => {
      const account = getUserId();
      if (!account || get().reminderAccountId !== account) throw new Error('Reminder settings not loaded for this account');
      try {
        const res = await api.post('/user/reminder-settings', newSettings);
        if (res.data?.settings && getUserId() === account) {
          set({ reminderSettings: res.data.settings });
        }
        return getUserId() === account;
      } catch (err) {
        console.error('Save Reminder Settings Error:', err);
        throw err;
      }
    },

    sendTestReminder: async () => {
      try {
        const res = await api.post('/bot/test-reminder');
        return res.data;
      } catch (err) {
        console.error('Send Test Reminder Error:', err);
        throw err;
      }
    },
  };
});


// Shared runtime selection is also the source of root CSS tokens.
useSettingsStore.subscribe((state, previous) => {
  if (state.personalDesignV2 !== previous.personalDesignV2 || state.publishedDesignV2 !== previous.publishedDesignV2
      || state.designEditorDraft !== previous.designEditorDraft
      || state.designPreviewInApp !== previous.designPreviewInApp) {
    const activeDesignConfig = resolveActiveDesign(state);
    useSettingsStore.setState({ activeDesignConfig });
    applyPublishedDesignTokens(activeDesignConfig ?? DEFAULT_DESIGN_CONFIG_V2);
  }
});
