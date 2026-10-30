import { create } from 'zustand';
import { storage, getUserId } from '../utils/auth.js';
import api, { networkApi } from '../services/api.js';
import { openPersonalDesignRecord, readPersonalDesignRecord, savePersonalDesignRecord, legacyFromRaw,
  reconcilePersonalDesign, editPersonalDesign, acknowledgePersonalDesign, resolveActiveDesign,
  documentFromLegacy } from '../design/personalDesignMigration.js';
import { AUTOPLAY_DEFAULTS, AUTOPLAY_VERSION, normalizeAutoplaySettings } from '../utils/autoplaySequence.js';
import { normalizeDesignConfig, DEFAULT_DESIGN_CONFIG_V2, patchDesignValue } from '../design/designConfig.js';
import { applyPublishedDesignTokens } from '../design/designTokens.js';

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
    }
  } catch { /* quota exceeded — silently ignore */ }
}

const accountCacheKey = key => `${key}:${getUserId() ?? 'guest'}`;
const DESIGN_V2_DRAFT_CACHE_KEY = 'lerne:admin-draft:v2';
const LOCAL_DESIGN_PREVIEW_KEY = 'lerne:local-design-preview';

function loadCachedAdminDraft() {
  try {
    const raw = storage.get(accountCacheKey(DESIGN_V2_DRAFT_CACHE_KEY))
      ?? readPersonalDesignRecord(getUserId())?.backups.local[DESIGN_V2_DRAFT_CACHE_KEY];
    if (!raw) return null;
    return normalizeDesignConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveCachedAdminDraft(config) {
  try {
    if (config) {
      storage.set(accountCacheKey(DESIGN_V2_DRAFT_CACHE_KEY), JSON.stringify(config));
    } else {
      storage.remove(accountCacheKey(DESIGN_V2_DRAFT_CACHE_KEY));
    }
  } catch { /* quota exceeded — silently ignore */ }
}

function loadCachedLocalPreviewState() {
  try {
    return (storage.get(accountCacheKey(LOCAL_DESIGN_PREVIEW_KEY))
      ?? readPersonalDesignRecord(getUserId())?.backups.local[LOCAL_DESIGN_PREVIEW_KEY]) === 'true';
  } catch {
    return false;
  }
}

function saveCachedLocalPreviewState(active) {
  try {
    if (active) {
      storage.set(accountCacheKey(LOCAL_DESIGN_PREVIEW_KEY), 'true');
    } else {
      storage.set(accountCacheKey(LOCAL_DESIGN_PREVIEW_KEY), 'false');
    }
  } catch { /* quota exceeded — silently ignore */ }
}

// Back up V1 before reading defaults or applying any version-dependent initialization.
let initialPersonalRecord = null;
let initialMigrationError = null;
try { initialPersonalRecord = openPersonalDesignRecord(getUserId()); }
catch (error) { initialMigrationError = error.message; }
const initialPublishedDesign = loadCachedPublishedDesign();
const initialAdminDraft = loadCachedAdminDraft();
const initialLocalPreviewActive = loadCachedLocalPreviewState();
const initialActiveDesign = resolveActiveDesign({ personalDesignV2: initialPersonalRecord?.document,
  publishedDesignV2: initialPublishedDesign, adminDraftDesignV2: initialAdminDraft,
  isLocalDesignPreviewActive: initialLocalPreviewActive });
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
  if (state.personalDesignV2) settings.designV2 = state.personalDesignV2;
  const nativeLang = storage.get('native_language');
  if (nativeLang) {
    settings.native_language = nativeLang;
  }
  return settings;
};

let saveTimer = null;
let settingsGeneration = 0;
let settingsWrite = null;
export const debouncedSaveSettings = (get) => {
  if (saveTimer) clearTimeout(saveTimer);
  const account = getUserId(), generation = settingsGeneration;
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

    // --- Design Settings & Setters ---
    personalDesignV2: initialPersonalRecord?.document ?? null,
    designAccountId: getUserId(),
    designMigrationError: initialMigrationError,
    activeDesignConfig: initialActiveDesign,

    activateSettingsAccount: () => {
      const isAdmin = get().designAccountId === getUserId() && get().isAdmin;
      settingsGeneration++;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      try {
        const record = openPersonalDesignRecord(getUserId());
        set({ personalDesignV2: record?.document ?? null,
          designAccountId: getUserId(), designMigrationError: null, isAdmin,
          adminDraftDesignV2: loadCachedAdminDraft(), isLocalDesignPreviewActive: loadCachedLocalPreviewState() });
      } catch (error) {
        set({ personalDesignV2: null,
          designAccountId: getUserId(), designMigrationError: error.message,
          adminDraftDesignV2: null, isLocalDesignPreviewActive: false, isAdmin: false });
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

    restorePersonalDesignFromBackup: async (source = 'local') => {
      const account = getUserId(), generation = settingsGeneration;
      const record = readPersonalDesignRecord(account);
      if (!record) throw new Error('No design backup for this account');
      let flat;
      if (source === 'local') flat = legacyFromRaw(record.backups.local);
      else if (source === 'server') {
        const response = await networkApi.get('/user/settings/design-backup', { _expectedUserId: account });
        if (account !== getUserId() || generation !== settingsGeneration) return false;
        if (typeof response.data?.raw !== 'string') throw new Error('No server design backup');
        flat = JSON.parse(response.data.raw);
      } else throw new Error('Unknown design backup source');
      const restored = documentFromLegacy(flat);
      get().setPersonalDesignV2(restored.config, restored.preset);
      return true;
    },

    syncUserSettingsFromServer: (serverSettings) => {
      if (!serverSettings || typeof serverSettings !== 'object' || Array.isArray(serverSettings)) return;
      if (get().designAccountId !== getUserId()) get().activateSettingsAccount();
      try {
        const record = openPersonalDesignRecord(getUserId());
        if (record) {
          const next = savePersonalDesignRecord(reconcilePersonalDesign(record, serverSettings));
          set({ personalDesignV2: next.document, designMigrationError: null });
          if (next.pending) debouncedSaveSettings(get);
        }
      } catch (error) { set({ designMigrationError: error.message }); }

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
          import('../i18n/locale.js').then(({ setInterfaceLanguage, normalizeInterfaceLanguage }) => {
            const lang = normalizeInterfaceLanguage(serverSettings.native_language);
            if (lang) {
              setInterfaceLanguage(lang);
              storage.set('native_language', lang);
              storage.set('native_language_selected', 'true');
            }
          }).catch(() => {});
        }
      }

      if (Object.keys(updates).length > 0) {
        set(updates);
      }
      if (migrateAutoplay) debouncedSaveSettings(get);
    },

    saveCurrentSettingsToServer: () => {
      const account = getUserId(), generation = settingsGeneration;
      if (settingsWrite?.generation === generation) return settingsWrite.promise;
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
          const result = await networkApi.post('/user/settings', collectUserSettings(get()), { _expectedUserId: account });
          if (!current()) return false;
          if (result.data?.designMigrationVersion !== 1) throw new Error('Server did not confirm safe design migration');
          const latest = readPersonalDesignRecord(account);
          const next = savePersonalDesignRecord(acknowledgePersonalDesign(latest, sent, result.data?.settings?.designV2));
          set({ personalDesignV2: next.document, designMigrationError: null });
          if (next.pending) debouncedSaveSettings(get);
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

    fetchUserSettingsFromServer: async () => {
      const account = getUserId(), generation = settingsGeneration;
      if (!account || saveTimer !== null || settingsWrite?.generation === generation) return null;
      try {
        const res = await networkApi.get('/user/settings', { _expectedUserId: account });
        if (account !== getUserId() || generation !== settingsGeneration) return null;
        get().syncUserSettingsFromServer(res.data);
        return res.data;
      } catch { return null; }
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
    // publishedDesignV2: глобальный дизайн, применяется к app root.
    //   null → дизайн ещё не опубликован → использовать DEFAULT_DESIGN_CONFIG_V2.
    // adminDraftDesignV2: черновик администратора, изолирован внутри preview (или в локальном превью).
    publishedDesignV2: initialPublishedDesign,
    adminDraftDesignV2: initialAdminDraft,
    isLocalDesignPreviewActive: initialLocalPreviewActive,

    /** Применяет опубликованный global design (из /init или /design/global).
     *  Сохраняет в localStorage-кеш и применяет CSS tokens к app root (если не включён локальный черновик). */
    setPublishedDesignV2: (serverDoc) => {
      if (!serverDoc?.config) return;
      const normalized = normalizeDesignConfig(serverDoc.config);
      const doc = { ...serverDoc, config: normalized };
      saveCachedPublishedDesign(doc);
      set({ publishedDesignV2: doc });
    },

    /** Переключает локальный просмотр черновика только в текущем браузере */
    toggleLocalDesignPreview: () => {
      const next = !get().isLocalDesignPreviewActive;
      saveCachedLocalPreviewState(next);
      set({ isLocalDesignPreviewActive: next });
      return next;
    },

    /** Единая точка записи черновика: кеш + store; для администратора первая правка
     *  автоматически включает просмотр «только у меня» на всём приложении. */
    commitAdminDraft: (config, { autoPreview = true } = {}) => {
      saveCachedAdminDraft(config);
      set({ adminDraftDesignV2: config });
      if (autoPreview && get().isAdmin && !get().isLocalDesignPreviewActive) {
        saveCachedLocalPreviewState(true);
        set({ isLocalDesignPreviewActive: true });
      }
    },

    /** Обновляет admin draft целиком. */
    setAdminDraftDesignV2: (config) => get().commitAdminDraft(normalizeDesignConfig(config)),

    /** Патчит одно поле в admin draft по dot-path. */
    patchAdminDraft: (path, value) => {
      const current = get().adminDraftDesignV2 ?? normalizeDesignConfig(get().publishedDesignV2?.config);
      get().commitAdminDraft(normalizeDesignConfig(patchDesignValue(current, path, value)));
    },

    /** Копирует из source только перечисленные разделы; возвращает прежний черновик для отмены. */
    applyDraftSections: (source, sections) => {
      const previous = get().adminDraftDesignV2 ?? normalizeDesignConfig(get().publishedDesignV2?.config);
      const next = structuredClone(previous);
      const incoming = normalizeDesignConfig(source);
      for (const section of sections) {
        if (section in DEFAULT_DESIGN_CONFIG_V2 && section !== 'schemaVersion') next[section] = structuredClone(incoming[section]);
      }
      get().commitAdminDraft(normalizeDesignConfig(next));
      return previous;
    },

    /** Публикует admin draft: отправляет на сервер, при успехе обновляет published. */
    publishAdminDraftToServer: async () => {
      const account = getUserId(), generation = settingsGeneration;
      const draft = get().adminDraftDesignV2;
      if (!draft) return { success: false, error: 'No draft to publish' };
      try {
        const res = await api.post('/admin/design/publish', { config: normalizeDesignConfig(draft) }, { _expectedUserId: account });
        if (account !== getUserId() || generation !== settingsGeneration) return { success: false, error: 'Account changed' };
        if (res.data?.config) {
          saveCachedLocalPreviewState(false);
          set({ isLocalDesignPreviewActive: false });
          get().setPublishedDesignV2(res.data);
          return { success: true, doc: res.data };
        }
        return { success: false, error: 'Invalid server response' };
      } catch (e) {
        console.warn('Failed to publish design:', e);
        return { success: false, error: e?.response?.data?.detail || e.message };
      }
    },

    /** Сохраняет admin draft на сервер (без публикации). */
    saveAdminDraftToServer: async () => {
      const account = getUserId(), generation = settingsGeneration;
      const draft = get().adminDraftDesignV2;
      if (!draft) return { success: false, error: 'No draft to save' };
      try {
        await api.post('/admin/design/draft', { config: normalizeDesignConfig(draft) }, { _expectedUserId: account });
        if (account !== getUserId() || generation !== settingsGeneration) return { success: false, error: 'Account changed' };
        return { success: true };
      } catch (e) {
        console.warn('Failed to save admin draft:', e);
        return { success: false, error: e?.response?.data?.detail || e.message };
      }
    },

    /** Загружает сохранённый на сервере admin draft; возвращает прежний черновик для отмены. */
    loadAdminDraftFromServer: async () => {
      const account = getUserId(), generation = settingsGeneration;
      try {
        const res = await api.get('/admin/design/draft', { _expectedUserId: account });
        if (account !== getUserId() || generation !== settingsGeneration) return { success: false, error: 'Account changed' };
        if (!res.data?.config) return { success: true, found: false };
        const previous = get().adminDraftDesignV2;
        get().commitAdminDraft(normalizeDesignConfig(res.data.config));
        return { success: true, found: true, previous };
      } catch (e) {
        console.warn('Failed to load admin draft:', e);
        return { success: false, error: e?.response?.data?.detail || e.message };
      }
    },

    /** Однократно переносит прежние личные настройки шрифтов/цветов этого браузера в разделы
     *  лицевая/обратная/список черновика; возвращает прежний черновик для отмены. */
    importLegacyPersonalDesign: () => {
      const state = get();
      const config = state.personalDesignV2?.config ?? DEFAULT_DESIGN_CONFIG_V2;
      return state.applyDraftSections(config, ['front', 'back', 'cardList']);
    },

    /** Возвращает draft к текущему published design. */
    revertDraftToPublished: () => {
      const published = get().publishedDesignV2?.config;
      get().commitAdminDraft(published ? normalizeDesignConfig(published) : normalizeDesignConfig(null), { autoPreview: false });
    },

    /** Сбрасывает конкретную секцию в draft до defaults. */
    resetDraftSection: (section) => {
      const current = get().adminDraftDesignV2 ?? normalizeDesignConfig(null);
      if (!(section in DEFAULT_DESIGN_CONFIG_V2)) return;
      get().commitAdminDraft({ ...current, [section]: JSON.parse(JSON.stringify(DEFAULT_DESIGN_CONFIG_V2[section])) });
    },

    /** Инициализирует admin draft из опубликованного дизайна (при открытии редактора). */
    initAdminDraftFromPublished: () => {
      const published = get().publishedDesignV2?.config;
      if (!get().adminDraftDesignV2) {
        const target = published ? normalizeDesignConfig(published) : normalizeDesignConfig(null);
        saveCachedAdminDraft(target);
        set({ adminDraftDesignV2: target });
      }
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
      || state.adminDraftDesignV2 !== previous.adminDraftDesignV2
      || state.isLocalDesignPreviewActive !== previous.isLocalDesignPreviewActive) {
    const activeDesignConfig = resolveActiveDesign(state);
    useSettingsStore.setState({ activeDesignConfig });
    applyPublishedDesignTokens(activeDesignConfig ?? DEFAULT_DESIGN_CONFIG_V2);
  }
});
